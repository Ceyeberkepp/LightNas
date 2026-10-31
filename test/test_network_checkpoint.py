"""Isolated validation of the complete NetworkManager checkpoint lifecycle."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("checkpoint_test", ROOT / "scripts" / "network_checkpoint.py")
checkpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checkpoint)


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.calls = []
        self.current = 1700000000
        self.fail_rollback = False
        self.cp = checkpoint.NetworkCheckpoint(
            journal=Path(self.temp.name) / "network-pending.json",
            call=self.fake_bus,
            now=lambda: self.current,
            timeout=120
        )
        self.backups = []
        self.restores = []
        self.cp._backup_profiles = lambda transaction_id: self.backups.append(transaction_id) or self.temp.name
        self.cp._restore_profiles = lambda record: self.restores.append(record["id"])
        self.cp._remove_backup = lambda record: None

    def fake_bus(self, method, signature, *args):
        self.calls.append((method, signature, args))
        if method == "CheckpointCreate":
            return 'o "/org/freedesktop/NetworkManager/Checkpoint/7"'
        if method == "CheckpointRollback" and self.fail_rollback:
            raise RuntimeError("NetworkManager unavailable")
        return ""

    def test_create_applies_only_after_checkpoint_and_journal_are_durable(self):
        def apply():
            self.assertEqual(self.calls[0], ("CheckpointCreate", "aouu", (0,120,2)))
            self.assertTrue(self.cp.journal.is_file())
            return {"activated": True}
        pending = self.cp.begin("connection-update", apply)
        self.assertTrue(pending["pendingConfirmation"])
        self.assertEqual(pending["result"], {"activated": True})
        self.assertEqual(pending["secondsToConfirm"], 120)
        self.assertEqual(self.cp.journal.stat().st_mode & 0o777, 0o600)
        with self.assertRaisesRegex(RuntimeError,"awaiting confirmation"):
            self.cp.begin("route-update", lambda: None)
        self.assertFalse(self.cp.status()["action"] is None)

    def test_confirm_valid_token_commits_and_removes_journal(self):
        pending=self.cp.begin("connection-update", lambda: {"ok":True})
        result=self.cp.resolve({
            "transactionId":pending["transactionId"],
            "confirmationToken":pending["confirmationToken"]
        },commit=True)
        self.assertTrue(result["confirmed"])
        self.assertFalse(self.cp.journal.exists())
        self.assertTrue(any(call[0]=="CheckpointDestroy" for call in self.calls))
        self.assertFalse(any(call[0]=="CheckpointRollback" for call in self.calls))

    def test_invalid_token_and_expired_confirmation_fail_closed(self):
        pending=self.cp.begin("connection-update", lambda: {})
        with self.assertRaises(PermissionError):
            self.cp.resolve({"transactionId":pending["transactionId"],"confirmationToken":"0"*64},commit=True)
        self.assertTrue(self.cp.journal.exists())
        self.current+=120
        with self.assertRaisesRegex(RuntimeError,"expired"):
            self.cp.resolve({"transactionId":pending["transactionId"],
                             "confirmationToken":pending["confirmationToken"]},commit=True)
        self.assertFalse(any(call[0]=="CheckpointDestroy" for call in self.calls))
        result=self.cp.resolve({"transactionId":pending["transactionId"],
                               "confirmationToken":pending["confirmationToken"]},commit=False)
        self.assertTrue(result["rolledBack"])

    def test_apply_failure_rolls_back_and_restores_saved_profiles(self):
        def fail():
            raise RuntimeError("network modify failed")
        with self.assertRaisesRegex(RuntimeError,"network modify failed"):
            self.cp.begin("connection-update",fail)
        self.assertEqual(len(self.restores),1)
        self.assertFalse(self.cp.journal.exists())
        self.assertTrue(any(call[0]=="CheckpointRollback" for call in self.calls))

    def test_rollback_failure_keeps_recovery_journal_for_next_boot(self):
        self.fail_rollback=True
        with self.assertRaisesRegex(RuntimeError,"rollback could not be confirmed"):
            self.cp.begin("connection-update",lambda: (_ for _ in ()).throw(ValueError("bad gateway")))
        self.assertTrue(self.cp.journal.exists())
        self.fail_rollback=False
        result=self.cp.recover_pending()
        self.assertTrue(result["recovered"])
        self.assertEqual(len(self.restores),1)
        self.assertFalse(self.cp.journal.exists())

    def test_restart_recovery_restores_pending_changes_without_confirmation(self):
        pending=self.cp.begin("connection-update",lambda: {"ok":True})
        self.assertTrue(pending["pendingConfirmation"])
        result=self.cp.recover_pending()
        self.assertTrue(result["recovered"])
        self.assertEqual(self.restores,[pending["transactionId"]])
        self.assertFalse(self.cp.journal.exists())

    def test_real_backup_and_boot_recovery_restore_previous_profile_bytes(self):
        network_dir = Path(self.temp.name) / "config" / "system-connections"
        network_dir.mkdir(parents=True)
        profile = network_dir / "managed.nmconnection"
        profile.write_text("[connection]\\nid=safe\\n")
        self.cp.profile_root = network_dir
        self.cp._backup_profiles = checkpoint.NetworkCheckpoint._backup_profiles.__get__(self.cp)
        self.cp._restore_profiles = checkpoint.NetworkCheckpoint._restore_profiles.__get__(self.cp)
        self.cp._remove_backup = checkpoint.NetworkCheckpoint._remove_backup.__get__(self.cp)
        pending = self.cp.begin("connection-update", lambda: profile.write_text("[connection]\\nid=unsafe\\n"))
        self.assertTrue(pending["pendingConfirmation"])
        self.assertEqual(profile.read_text(), "[connection]\\nid=unsafe\\n")
        self.cp.recover_pending()
        self.assertEqual(profile.read_text(), "[connection]\\nid=safe\\n")
        self.assertFalse(self.cp.journal.exists())

    def test_profile_symlinks_fail_closed_before_checkpoint_create(self):
        network_dir = Path(self.temp.name) / "config" / "system-connections"
        network_dir.mkdir(parents=True)
        (network_dir / "external").symlink_to("/etc/hosts")
        self.cp.profile_root = network_dir
        self.cp._backup_profiles = checkpoint.NetworkCheckpoint._backup_profiles.__get__(self.cp)
        with self.assertRaisesRegex(RuntimeError,"symlinks"):
            self.cp.begin("connection-update", lambda: None)
        self.assertEqual(self.calls, [], "No checkpoint or network action may run on unsafe profiles")

    def test_no_management_writes_in_source_api_without_checkpoint(self):
        source=(ROOT/"scripts"/"lightnas-host-agent.py").read_text()
        self.assertIn("NETWORK_CHECKPOINT.begin(action, lambda: network_action(data, _checkpointed=True))",source)
        self.assertIn('if action in UNPROTECTED_MUTATIONS:',source)
        self.assertIn('if action in {"network-confirm", "network-rollback"}:',source)
        server=(ROOT/"src"/"server.mjs").read_text()
        self.assertNotIn("result = await networkAction(input);",server)
        ui=(ROOT/"public"/"dialog-controls.js").read_text()
        self.assertIn("body.pendingConfirmation",ui)
        self.assertIn("network-confirm",ui)
        self.assertIn("network-rollback",ui)
        installer=(ROOT/"install.sh").read_text()
        self.assertIn("lightnas-network-recovery.service",installer)
        self.assertIn("RequiredBy=NetworkManager.service",installer)


if __name__ == "__main__":
    unittest.main()
