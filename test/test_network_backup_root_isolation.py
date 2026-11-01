"""Reject redirected recovery snapshots without touching external directories.

All tests use disposable temporary files and a mocked NetworkManager bus.
No appliance disks, network configuration, or real service are modified.
"""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "network_backup_root_isolation_test", ROOT / "scripts" / "network_checkpoint.py"
)
checkpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checkpoint)


class BackupRootIsolationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.profiles = self.home / "etc" / "system-connections"
        self.profiles.mkdir(parents=True)
        self.profile = self.profiles / "uplink.nmconnection"
        self.profile.write_text("known-good")
        self.profile.chmod(0o600)
        self.calls = []

        def fake_bus(method, signature="", *args):
            self.calls.append(method)
            if method == "CheckpointCreate":
                return 'o "/org/freedesktop/NetworkManager/Checkpoint/7"'
            return ""

        self.cp = checkpoint.NetworkCheckpoint(
            journal=self.home / "network-pending.json",
            profile_root=self.profiles,
            call=fake_bus,
            now=lambda: 1700000000,
        )
        self.root = self.home / "network-backups"

    def begin(self):
        return self.cp.begin(
            "connection-update", lambda: self.profile.write_text("changed")
        )

    def test_symlinked_backup_root_blocks_network_change_without_writing_outside(self):
        outside = self.home / "outside"
        outside.mkdir()
        sentinel = outside / "sentinel"
        sentinel.write_text("untouched")
        self.root.symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "Unsafe NetworkManager recovery backup root"):
            self.begin()
        self.assertEqual(self.calls, [], "No checkpoint may start without a safe snapshot")
        self.assertEqual(self.profile.read_text(), "known-good")
        self.assertEqual(sentinel.read_text(), "untouched")
        self.assertFalse(self.cp.journal.exists())

    def test_group_readable_backup_root_blocks_checkpoint(self):
        self.root.mkdir(mode=0o700)
        self.root.chmod(0o750)
        with self.assertRaisesRegex(RuntimeError, "Unsafe NetworkManager recovery backup root"):
            self.begin()
        self.assertEqual(self.calls, [])
        self.assertEqual(self.profile.read_text(), "known-good")

    def test_replaced_transaction_directory_blocks_restore_and_preserves_journal(self):
        pending = self.begin()
        transaction = self.root / pending["transactionId"]
        parked = self.home / "parked-backup"
        transaction.rename(parked)
        transaction.symlink_to(parked, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "Unsafe NetworkManager recovery transaction directory"):
            self.cp.recover_pending()
        self.assertTrue(self.cp.journal.exists(), "Never lose recovery journal on unsafe backup")
        self.assertEqual(self.profile.read_text(), "changed")
        self.assertTrue((parked / "profiles" / self.profile.name).exists())
        transaction.unlink()
        parked.rename(transaction)
        self.assertTrue(self.cp.recover_pending()["recovered"])
        self.assertEqual(self.profile.read_text(), "known-good")
        self.assertFalse(self.cp.journal.exists())

    def test_replaced_backup_root_blocks_recovery_and_allows_safe_retry(self):
        self.begin()
        parked = self.home / "parked-root"
        self.root.rename(parked)
        self.root.symlink_to(parked, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "Unsafe NetworkManager recovery backup root"):
            self.cp.recover_pending()
        self.assertTrue(self.cp.journal.exists())
        self.assertEqual(self.profile.read_text(), "changed")
        self.root.unlink()
        parked.rename(self.root)
        self.assertTrue(self.cp.recover_pending()["recovered"])
        self.assertEqual(self.profile.read_text(), "known-good")

    def test_cleanup_rejects_redirected_transaction_directory(self):
        pending = self.begin()
        transaction = self.root / pending["transactionId"]
        parked = self.home / "parked-cleanup"
        transaction.rename(parked)
        sentinel = parked / "sentinel"
        sentinel.write_text("untouched")
        transaction.symlink_to(parked, target_is_directory=True)
        record = json.loads(self.cp.journal.read_text())
        with self.assertRaisesRegex(RuntimeError, "Unsafe NetworkManager recovery transaction directory"):
            self.cp._remove_backup(record)
        self.assertEqual(sentinel.read_text(), "untouched")
        self.assertTrue(self.cp.journal.exists())


if __name__ == "__main__":
    unittest.main()
