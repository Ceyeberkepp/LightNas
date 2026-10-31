"""Fail-safe NetworkManager checkpoint transactions for privileged LightNAS API.

NetworkManager owns the rollback deadline, independently of the browser and
LightNAS host-agent process. A saved journal makes outstanding changes visible
after a host-agent restart. Only a positively confirmed transaction commits.
"""
from __future__ import annotations

import hmac
import hashlib
import json
import os
import re
import secrets
import subprocess
import threading
import time
from pathlib import Path

NM_SERVICE = "org.freedesktop.NetworkManager"
NM_PATH = "/org/freedesktop/NetworkManager"
NM_INTERFACE = "org.freedesktop.NetworkManager"
CHECKPOINT_RE = re.compile(r'^o "(/org/freedesktop/NetworkManager/Checkpoint/[0-9]+)"\s*$')
TOKEN_RE = re.compile(r"^[0-9a-f]{64}$")


class NetworkCheckpoint:
    def __init__(self, journal=Path("/var/lib/lightnas/network-pending.json"),
                 call=None, now=None, timeout=120):
        self.journal = Path(journal)
        self.call = call or self._busctl
        self.now = now or time.time
        self.timeout = timeout
        self.lock = threading.RLock()

    @staticmethod
    def _busctl(method, signature="", *args):
        cmd = ["busctl", "--system", "call", NM_SERVICE, NM_PATH, NM_INTERFACE, method]
        if signature:
            cmd.extend([signature, *[str(arg) for arg in args]])
        result = subprocess.run(cmd, text=True, capture_output=True, timeout=15, check=True)
        return result.stdout.strip()

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

    def begin(self, action, execute):
        with self.lock:
            if self._read() is not None:
                raise RuntimeError("Another network change is awaiting confirmation or recovery")
            transaction_id = secrets.token_hex(16)
            secret = secrets.token_hex(32)
            checkpoint = self._create()
            record = {
                "id": transaction_id,
                "hash": hashlib.sha256(secret.encode()).hexdigest(),
                "checkpoint": checkpoint,
                "deadline": self.now() + self.timeout,
                "action": action
            }
            try:
                self._write(record)
            except Exception:
                self._rollback(checkpoint)
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
                    self._clear()
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
                self._rollback(record["checkpoint"])
            self._clear()
            return {"action": "network-confirm" if commit else "network-rollback",
                    "confirmed": bool(commit), "rolledBack": not commit}

    def status(self):
        record = self._read()
        return {"pending": bool(record),
                "deadline": record["deadline"] if record else None,
                "action": record["action"] if record else None}

