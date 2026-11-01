"""Fail-safe NetworkManager checkpoint transactions for privileged LightNAS API.

NetworkManager owns the rollback deadline, independently of the browser and
LightNAS host-agent process. A saved journal makes outstanding changes visible
after a host-agent restart. Only a positively confirmed transaction commits.
"""
from __future__ import annotations

import fcntl
import hmac
import hashlib
import filecmp
import json
import os
import re
import shutil
import secrets
import stat
import subprocess
import threading
import time
from contextlib import contextmanager
from functools import wraps
from pathlib import Path

NM_SERVICE = "org.freedesktop.NetworkManager"
NM_PATH = "/org/freedesktop/NetworkManager"
NM_INTERFACE = "org.freedesktop.NetworkManager"
CHECKPOINT_RE = re.compile(r'^o "(/org/freedesktop/NetworkManager/Checkpoint/[0-9]+)"\s*$')
TOKEN_RE = re.compile(r"^[0-9a-f]{64}$")


def transaction_locked(method):
    """Serialize network transactions across threads and host-agent processes."""
    @wraps(method)
    def guarded(self, *args, **kwargs):
        with self._transaction_lock():
            return method(self, *args, **kwargs)
    return guarded


class NetworkCheckpoint:
    def __init__(self, journal=Path("/var/lib/lightnas/network-pending.json"),
                 call=None, now=None, timeout=120,
                 profile_root=Path("/etc/NetworkManager/system-connections")):
        self.journal = Path(journal)
        self.profile_root = Path(profile_root)
        self.call = call or self._busctl
        self.now = now or time.time
        self.timeout = timeout
        self.lock = threading.RLock()
        self._process_lock_depth = 0

    @contextmanager
    def _transaction_lock(self):
        # An RLock alone cannot prevent a separate host-agent or boot-recovery
        # process from replacing another transaction's recovery journal.
        # Keep the lockfile inode stable: never unlink it after releasing flock.
        with self.lock:
            if self._process_lock_depth:
                self._process_lock_depth += 1
                try:
                    yield
                finally:
                    self._process_lock_depth -= 1
                return
            parent = self.journal.parent
            parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if parent.is_symlink():
                raise RuntimeError("Unsafe network transaction lock directory")
            lockfile = parent / "network-checkpoint.lock"
            if lockfile.is_symlink():
                raise RuntimeError("Unsafe network transaction lock file")
            flags = (os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
                     | getattr(os, "O_CLOEXEC", 0))
            fd = os.open(lockfile, flags, 0o600)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise RuntimeError("Unsafe network transaction lock file")
                fcntl.flock(fd, fcntl.LOCK_EX)
                self._process_lock_depth = 1
                try:
                    yield
                finally:
                    self._process_lock_depth = 0
            finally:
                os.close(fd)

    @staticmethod
    def _busctl(method, signature="", *args):
        cmd = ["busctl", "--system", "call", NM_SERVICE, NM_PATH, NM_INTERFACE, method]
        if signature:
            cmd.extend([signature, *[str(arg) for arg in args]])
        result = subprocess.run(cmd, text=True, capture_output=True, timeout=15, check=True)
        return result.stdout.strip()

    @staticmethod
    def _fsync_directory(path):
        """Make directory-entry changes durable before dropping recovery state."""
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    @classmethod
    def _fsync_tree(cls, root):
        """Flush every copied profile and directory before creating a checkpoint.

        A durable journal is useless after a power loss if its recovery files
        were still only in the page cache. Reject non-regular files and symlinks.
        """
        if Path(root).is_symlink() or not Path(root).is_dir():
            raise RuntimeError("NetworkManager recovery backup tree is unavailable")
        def fail_walk(error):
            raise error
        for directory, dirs, files in os.walk(root, topdown=False, followlinks=False,
                                              onerror=fail_walk):
            for name in files:
                path = Path(directory) / name
                fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                try:
                    if not stat.S_ISREG(os.fstat(fd).st_mode):
                        raise RuntimeError("Unsafe NetworkManager recovery backup entry")
                    os.fsync(fd)
                finally:
                    os.close(fd)
            for name in dirs:
                if (Path(directory) / name).is_symlink():
                    raise RuntimeError("Unsafe NetworkManager recovery backup symlink")
            cls._fsync_directory(directory)

    def _backup_profiles(self, transaction_id):
        # Protect persistent NetworkManager profiles if the manager or machine
        # restarts before its D-Bus checkpoint timeout can take effect.
        source = self.profile_root
        if source.is_symlink() or not source.is_dir():
            raise RuntimeError("A local NetworkManager keyfile directory is required for safe rollback")
        if any(path.is_symlink() for path in source.rglob("*")):
            raise RuntimeError("NetworkManager configuration symlinks cannot be checkpointed safely")
        backup = self.journal.parent / "network-backups" / transaction_id
        backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        backup.mkdir(mode=0o700)
        try:
            shutil.copytree(source, backup / "profiles", copy_function=shutil.copy2)
            self._fsync_tree(backup / "profiles")
            # A completed copy is not necessarily a faithful recovery image:
            # interrupted/racing writes and silent copy corruption must be
            # detected before creating a checkpoint or changing the network.
            # Check bytes, entry types, ownership and permissions against the
            # source after the copied files have been synchronized.
            if not self._same_profile_tree(source, backup / "profiles"):
                raise RuntimeError("NetworkManager recovery snapshot differs from live profiles")
            self._fsync_directory(backup)
            self._fsync_directory(backup.parent)
        except Exception:
            shutil.rmtree(backup, ignore_errors=True)
            raise
        return str(backup)

    def _remove_backup(self, record):
        if not re.fullmatch(r"[0-9a-f]{32}", str(record.get("id", ""))):
            raise RuntimeError("Invalid network recovery transaction ID")
        backup = self.journal.parent / "network-backups" / record["id"]
        if backup.is_dir() and not backup.is_symlink():
            shutil.rmtree(backup)
            self._fsync_directory(backup.parent)

    @staticmethod
    def _same_profile_tree(expected, actual):
        """Verify a completed recovery swap before discarding the old tree."""
        if any(root.is_symlink() or not root.is_dir() for root in (expected, actual)):
            return False
        def same_metadata(left_path, right_path):
            # Keyfiles contain credentials. A byte-identical restore with
            # broader permissions or changed ownership is not a safe restore.
            left_info = left_path.lstat()
            right_info = right_path.lstat()
            if not (stat.S_ISREG(left_info.st_mode) or stat.S_ISDIR(left_info.st_mode)):
                return False
            return (
                stat.S_IFMT(left_info.st_mode),
                stat.S_IMODE(left_info.st_mode),
                left_info.st_uid,
                left_info.st_gid,
            ) == (
                stat.S_IFMT(right_info.st_mode),
                stat.S_IMODE(right_info.st_mode),
                right_info.st_uid,
                right_info.st_gid,
            )

        if not same_metadata(expected, actual):
            return False
        left = {str(p.relative_to(expected)): p for p in expected.rglob("*")}
        right = {str(p.relative_to(actual)): p for p in actual.rglob("*")}
        if left.keys() != right.keys():
            return False
        for rel, path in left.items():
            other = right[rel]
            if not same_metadata(path, other):
                return False
            if path.is_file() and not filecmp.cmp(path, other, shallow=False):
                return False
        return True

    def _restore_profiles(self, record):
        if not re.fullmatch(r"[0-9a-f]{32}", str(record.get("id", ""))):
            raise RuntimeError("Invalid network recovery transaction ID")
        backup = self.journal.parent / "network-backups" / record["id"] / "profiles"
        dest = self.profile_root
        if backup.is_symlink() or dest.is_symlink() or not backup.is_dir():
            raise RuntimeError("Missing or unsafe NetworkManager recovery backup")
        if any(path.is_symlink() for path in backup.rglob("*")):
            raise RuntimeError("NetworkManager recovery backup contains symlinks")
        staged = dest.parent / (".lightnas-recovered-" + record["id"])
        previous = dest.parent / (".lightnas-pending-" + record["id"])
        if staged.is_symlink() or previous.is_symlink():
            raise RuntimeError("Unsafe NetworkManager recovery staging directory")
        if previous.exists():
            # A prior recovery may have been interrupted after moving the
            # live profiles aside. Resume from the durable backup rather than
            # permanently blocking every subsequent boot on a stale rename.
            if not previous.is_dir():
                raise RuntimeError("Unsafe NetworkManager previous-profile directory")
            if dest.exists():
                if not self._same_profile_tree(backup, dest):
                    raise RuntimeError("Recovered NetworkManager profiles differ from saved backup")
                if staged.exists():
                    raise RuntimeError("Unexpected NetworkManager recovery staging conflict")
                shutil.rmtree(previous)
                self._fsync_directory(previous.parent)
                return
            if staged.exists():
                if not staged.is_dir():
                    raise RuntimeError("Unsafe NetworkManager recovery staging directory")
                shutil.rmtree(staged)
            shutil.copytree(backup, staged, copy_function=shutil.copy2)
            self._fsync_tree(staged)
            if not self._same_profile_tree(backup, staged):
                raise RuntimeError("Staged NetworkManager recovery profiles differ from saved backup")
            self._fsync_directory(staged.parent)
            staged.rename(dest)
            self._fsync_directory(dest.parent)
            if not self._same_profile_tree(backup, dest):
                raise RuntimeError("Recovered NetworkManager profiles differ from saved backup")
            shutil.rmtree(previous)
            self._fsync_directory(previous.parent)
            return
        if staged.exists():
            # The live tree has not yet been renamed. Discard an incomplete
            # staging copy and rebuild it from the immutable backup.
            if not staged.is_dir():
                raise RuntimeError("Unsafe NetworkManager recovery staging directory")
            shutil.rmtree(staged)
        shutil.copytree(backup, staged, copy_function=shutil.copy2)
        self._fsync_tree(staged)
        if not self._same_profile_tree(backup, staged):
            raise RuntimeError("Staged NetworkManager recovery profiles differ from saved backup")
        self._fsync_directory(staged.parent)
        try:
            if dest.exists():
                dest.rename(previous)
            staged.rename(dest)
            self._fsync_directory(dest.parent)
            if not self._same_profile_tree(backup, dest):
                raise RuntimeError("Recovered NetworkManager profiles differ from saved backup")
        except Exception:
            if previous.exists() and not dest.exists():
                previous.rename(dest)
            raise
        if previous.exists():
            shutil.rmtree(previous)
            self._fsync_directory(previous.parent)

    @transaction_locked
    def recover_pending(self):
        # Called before NetworkManager starts on reboot, and on host-agent
        # restart. Never commit an unconfirmed change.
        with self.lock:
            record = self._read()
            if not record:
                return {"recovered": False}
            try:
                self._rollback(record["checkpoint"])
            except Exception:
                # Manager restart can destroy its in-memory checkpoint. Fall
                # back to the saved on-disk profiles before the service starts.
                pass
            self._restore_profiles(record)
            self._clear()
            self._remove_backup(record)
            return {"recovered": True}

    def _create(self):
        # The empty device array snapshots all NetworkManager-managed devices.
        # Flag 2 also rolls back newly added connection profiles.
        output = self.call("CheckpointCreate", "aouu", 0, self.timeout, 2)
        match = CHECKPOINT_RE.fullmatch(output)
        if not match:
            raise RuntimeError("NetworkManager did not return a valid checkpoint path")
        return match.group(1)

    def _destroy(self, path):
        return self.call("CheckpointDestroy", "o", path)

    def _rollback(self, path):
        return self.call("CheckpointRollback", "o", path)

    def _read(self):
        try:
            if self.journal.is_symlink():
                raise RuntimeError("Unsafe network transaction journal")
            return json.loads(self.journal.read_text(encoding="utf8"))
        except FileNotFoundError:
            return None

    def _write(self, data):
        self.journal.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.journal.parent.is_symlink() or self.journal.is_symlink():
            raise RuntimeError("Unsafe network transaction journal")
        payload = json.dumps(data, separators=(",", ":"), sort_keys=True).encode()
        tmp = self.journal.with_name(self.journal.name + "." + secrets.token_hex(8) + ".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, self.journal)
            # Persist the journal directory rename for crash recovery.
            dirfd = os.open(self.journal.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(dirfd)
            finally:
                os.close(dirfd)
        finally:
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass

    def _clear(self):
        self.journal.unlink(missing_ok=True)
        # Persist the journal deletion *before* removing the only recovery
        # snapshot. Otherwise a power loss may resurrect a journal whose
        # backup directory was already deleted.
        self._fsync_directory(self.journal.parent)

    @transaction_locked
    def begin(self, action, execute):
        with self.lock:
            previous = self._read()
            if previous and self.now() >= previous["deadline"]:
                # The NM checkpoint timer already expired. Never assume its
                # in-memory rollback also restored persistent keyfiles.
                self.recover_pending()
                previous = self._read()
            if previous is not None:
                raise RuntimeError("Another network change is awaiting confirmation or recovery")
            transaction_id = secrets.token_hex(16)
            secret = secrets.token_hex(32)
            backup = self._backup_profiles(transaction_id)
            try:
                checkpoint = self._create()
            except Exception:
                shutil.rmtree(backup, ignore_errors=True)
                raise
            record = {
                "id": transaction_id,
                "hash": hashlib.sha256(secret.encode()).hexdigest(),
                "checkpoint": checkpoint,
                "deadline": self.now() + self.timeout,
                "action": action,
                "backup": backup
            }
            try:
                self._write(record)
            except Exception as write_error:
                # _write can fail *after* os.replace, e.g. while fsyncing the
                # journal directory. At that point the journal may survive a
                # reboot, so deleting its only recovery snapshot would make
                # boot-time rollback impossible. Never discard a snapshot while
                # its recovery journal still exists.
                try:
                    self._rollback(checkpoint)
                except Exception as rollback_error:
                    # The NM timeout may still roll back in-memory changes.
                    # Retain the snapshot for console recovery; if a journal
                    # was installed, boot recovery can also use it.
                    raise RuntimeError(
                        "Network checkpoint journal persistence failed and "
                        "NetworkManager rollback could not be confirmed; "
                        "inspect the host console before further changes."
                    ) from rollback_error
                if not self.journal.exists() and not self.journal.is_symlink():
                    shutil.rmtree(backup, ignore_errors=True)
                raise
            try:
                result = execute()
            except Exception as original:
                try:
                    self._rollback(checkpoint)
                except Exception as rollback:
                    raise RuntimeError(
                        "Network operation failed and rollback could not be confirmed. "
                        "NetworkManager's timeout must recover it; inspect the host console."
                    ) from rollback
                else:
                    self._restore_profiles(record)
                    self._clear()
                    self._remove_backup(record)
                    raise original
            return {
                "action": action,
                "pendingConfirmation": True,
                "transactionId": transaction_id,
                "confirmationToken": secret,
                "secondsToConfirm": self.timeout,
                "deadline": record["deadline"],
                "result": result
            }

    @transaction_locked
    def resolve(self, data, commit=False):
        with self.lock:
            record = self._read()
            if not record:
                raise ValueError("No pending network checkpoint to resolve")
            token = data.get("confirmationToken")
            transaction_id = data.get("transactionId")
            if (not isinstance(token, str) or not TOKEN_RE.fullmatch(token) or
                not isinstance(transaction_id, str) or
                not hmac.compare_digest(record["id"], transaction_id) or
                not hmac.compare_digest(record["hash"], hashlib.sha256(token.encode()).hexdigest())):
                raise PermissionError("Network checkpoint confirmation token is invalid")
            # Never commit after NetworkManager's rollback timeout, even if
            # the client reaches us through a stale connection.
            if commit and self.now() >= record["deadline"]:
                raise RuntimeError("Network checkpoint confirmation expired; change must be retried")
            if commit:
                self._destroy(record["checkpoint"])
            else:
                if self.now() >= record["deadline"]:
                    # The NetworkManager timer may already have destroyed its
                    # checkpoint. Recover the durable profile snapshot even
                    # when the in-memory checkpoint no longer exists.
                    self.recover_pending()
                    return {"action": "network-rollback", "confirmed": False, "rolledBack": True}
                self._rollback(record["checkpoint"])
                # NM checkpoint rollback alone does not prove that keyfiles
                # changed by nmcli have their original persistent bytes.
                # Keep the journal and snapshot if this restore fails.
                self._restore_profiles(record)
            self._clear()
            self._remove_backup(record)
            return {"action": "network-confirm" if commit else "network-rollback",
                    "confirmed": bool(commit), "rolledBack": not commit}

    @transaction_locked
    def status(self):
        record = self._read()
        return {"pending": bool(record),
                "expired": self.now() >= record["deadline"] if record else False,
                "deadline": record["deadline"] if record else None,
                "action": record["action"] if record else None}

if __name__ == "__main__":
    import sys
    if sys.argv[1:] != ["--recover-pending"]:
        raise SystemExit("Usage: network_checkpoint.py --recover-pending")
    NetworkCheckpoint().recover_pending()

