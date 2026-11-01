"""Failure-injection checks for the durable NetworkManager recovery snapshot.

These tests only use temporary files and a mocked D-Bus transport. No real
NetworkManager service, appliance network, or host storage is modified.
"""
import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "network_checkpoint_snapshot_test", ROOT / "scripts" / "network_checkpoint.py"
)
checkpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checkpoint)


class NetworkSnapshotIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.profile_root = base / "etc" / "NetworkManager" / "system-connections"
        self.profile_root.mkdir(parents=True)
        self.profile_root.chmod(0o700)
        self.profile = self.profile_root / "uplink.nmconnection"
        self.profile.write_text("[connection]\nid=working-uplink\n")
        self.profile.chmod(0o600)
        self.calls = []

        def fake_bus(method, signature="", *args):
            self.calls.append(method)
            if method == "CheckpointCreate":
                return 'o "/org/freedesktop/NetworkManager/Checkpoint/7"'
            return ""

        self.cp = checkpoint.NetworkCheckpoint(
            journal=base / "state" / "network-pending.json",
            profile_root=self.profile_root,
            call=fake_bus,
            now=lambda: 1700000000,
            timeout=120,
        )

    def assert_rejected_before_checkpoint(self, error):
        with self.assertRaisesRegex(RuntimeError, error):
            self.cp.begin("connection-update", lambda: self.fail("must not apply"))
        self.assertEqual(self.calls, [], "Never create checkpoint or change network with bad backup")
        self.assertFalse(self.cp.journal.exists())
        backup_dir = self.cp.journal.parent / "network-backups"
        self.assertEqual(list(backup_dir.iterdir()), [], "Discard invalid backup snapshot")

    def test_corrupt_backup_bytes_fail_before_checkpoint(self):
        original_copytree = shutil.copytree

        def corrupt_copy(source, target, **kwargs):
            result = original_copytree(source, target, **kwargs)
            (Path(target) / "uplink.nmconnection").write_text("silent corruption")
            return result

        with patch.object(checkpoint.shutil, "copytree", side_effect=corrupt_copy):
            self.assert_rejected_before_checkpoint("snapshot differs from live profiles")
        self.assertIn("working-uplink", self.profile.read_text())

    def test_broadened_backup_keyfile_permissions_fail_before_checkpoint(self):
        original_copytree = shutil.copytree

        def insecure_copy(source, target, **kwargs):
            result = original_copytree(source, target, **kwargs)
            (Path(target) / "uplink.nmconnection").chmod(0o644)
            return result

        with patch.object(checkpoint.shutil, "copytree", side_effect=insecure_copy):
            self.assert_rejected_before_checkpoint("snapshot differs from live profiles")
        self.assertEqual(self.profile.stat().st_mode & 0o777, 0o600)

    def test_source_changed_during_copy_fails_before_checkpoint(self):
        original_copytree = shutil.copytree

        def concurrent_change(source, target, **kwargs):
            result = original_copytree(source, target, **kwargs)
            self.profile.write_text("[connection]\nid=concurrently-changed\n")
            return result

        with patch.object(checkpoint.shutil, "copytree", side_effect=concurrent_change):
            self.assert_rejected_before_checkpoint("snapshot differs from live profiles")

    def test_valid_snapshot_allows_checkpoint_and_cancel_restores_profile(self):
        pending = self.cp.begin(
            "connection-update",
            lambda: self.profile.write_text("[connection]\nid=unsafe\n"),
        )
        self.assertTrue(pending["pendingConfirmation"])
        self.assertEqual(self.calls[0], "CheckpointCreate")
        self.assertTrue(self.cp.journal.exists())
        result = self.cp.resolve(
            {
                "transactionId": pending["transactionId"],
                "confirmationToken": pending["confirmationToken"],
            },
            commit=False,
        )
        self.assertTrue(result["rolledBack"])
        self.assertIn("working-uplink", self.profile.read_text())
        self.assertEqual(self.profile.stat().st_mode & 0o777, 0o600)
        self.assertFalse(self.cp.journal.exists())


if __name__ == "__main__":
    unittest.main()
