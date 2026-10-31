"""Isolated validation of the complete NetworkManager checkpoint lifecycle."""
import importlib.util
import json
import shutil
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

    def test_explicit_cancel_restores_actual_persistent_profile_bytes(self):
        # Simulate an nmcli profile edit: the mocked D-Bus rollback does not
        # rewrite keyfiles, so cancellation must restore the saved snapshot.
        network_dir = Path(self.temp.name) / "config" / "system-connections"
        network_dir.mkdir(parents=True)
        profile = network_dir / "uplink.nmconnection"
        profile.write_text("[connection]\\nid=working-uplink\\n")
        self.cp.profile_root = network_dir
        self.cp._backup_profiles = checkpoint.NetworkCheckpoint._backup_profiles.__get__(self.cp)
        self.cp._restore_profiles = checkpoint.NetworkCheckpoint._restore_profiles.__get__(self.cp)
        self.cp._remove_backup = checkpoint.NetworkCheckpoint._remove_backup.__get__(self.cp)
        pending = self.cp.begin("connection-update", lambda: profile.write_text("[connection]\\nid=bad-uplink\\n"))
        self.assertEqual(profile.read_text(), "[connection]\\nid=bad-uplink\\n")
        result = self.cp.resolve({"transactionId": pending["transactionId"],
                                  "confirmationToken": pending["confirmationToken"]}, commit=False)
        self.assertTrue(result["rolledBack"])
        self.assertEqual(profile.read_text(), "[connection]\\nid=working-uplink\\n")
        self.assertFalse(self.cp.journal.exists())
        self.assertFalse((self.cp.journal.parent / "network-backups" / pending["transactionId"]).exists())

    def test_cancel_restore_failure_preserves_journal_for_recovery(self):
        pending = self.cp.begin("connection-update", lambda: {"changed": True})
        def failed_restore(record):
            raise OSError("injected profile restore failure")
        self.cp._restore_profiles = failed_restore
        with self.assertRaisesRegex(OSError, "injected profile restore failure"):
            self.cp.resolve({"transactionId": pending["transactionId"],
                             "confirmationToken": pending["confirmationToken"]}, commit=False)
        self.assertTrue(self.cp.journal.exists(), "Must retain recovery state when profile restore fails")
        self.cp._restore_profiles = lambda record: self.restores.append(record["id"])
        recovered = self.cp.recover_pending()
        self.assertTrue(recovered["recovered"])
        self.assertEqual(self.restores, [pending["transactionId"]])
        self.assertFalse(self.cp.journal.exists())

    def test_expired_cancel_recovers_when_nm_checkpoint_has_disappeared(self):
        pending = self.cp.begin("connection-update", lambda: {"changed": True})
        self.current += 121
        self.fail_rollback = True
        result = self.cp.resolve({"transactionId": pending["transactionId"],
                                  "confirmationToken": pending["confirmationToken"]}, commit=False)
        self.assertTrue(result["rolledBack"])
        self.assertEqual(self.restores, [pending["transactionId"]])
        self.assertFalse(self.cp.journal.exists())

    def test_boot_recovery_resumes_crash_after_moving_live_profiles_aside(self):
        network_dir = Path(self.temp.name) / "config" / "system-connections"
        network_dir.mkdir(parents=True)
        profile = network_dir / "uplink.nmconnection"
        profile.write_text("working")
        self.cp.profile_root = network_dir
        self.cp._backup_profiles = checkpoint.NetworkCheckpoint._backup_profiles.__get__(self.cp)
        self.cp._restore_profiles = checkpoint.NetworkCheckpoint._restore_profiles.__get__(self.cp)
        self.cp._remove_backup = checkpoint.NetworkCheckpoint._remove_backup.__get__(self.cp)
        pending = self.cp.begin("connection-update", lambda: profile.write_text("bad"))
        previous = network_dir.parent / (".lightnas-pending-" + pending["transactionId"])
        network_dir.rename(previous)  # Inject crash between the two directory renames.
        self.assertFalse(network_dir.exists())
        self.cp.recover_pending()
        self.assertEqual(profile.read_text(), "working")
        self.assertFalse(previous.exists())
        self.assertFalse(self.cp.journal.exists())

    def test_boot_recovery_finishes_crash_after_restored_tree_rename(self):
        network_dir = Path(self.temp.name) / "config" / "system-connections"
        network_dir.mkdir(parents=True)
        profile = network_dir / "uplink.nmconnection"
        profile.write_text("working")
        self.cp.profile_root = network_dir
        self.cp._backup_profiles = checkpoint.NetworkCheckpoint._backup_profiles.__get__(self.cp)
        self.cp._restore_profiles = checkpoint.NetworkCheckpoint._restore_profiles.__get__(self.cp)
        self.cp._remove_backup = checkpoint.NetworkCheckpoint._remove_backup.__get__(self.cp)
        pending = self.cp.begin("connection-update", lambda: profile.write_text("bad"))
        backup = self.cp.journal.parent / "network-backups" / pending["transactionId"] / "profiles"
        staged = network_dir.parent / (".lightnas-recovered-" + pending["transactionId"])
        previous = network_dir.parent / (".lightnas-pending-" + pending["transactionId"])
        shutil.copytree(backup, staged, copy_function=shutil.copy2)
        network_dir.rename(previous)
        staged.rename(network_dir)  # Inject crash before deleting old profiles.
        self.cp.recover_pending()
        self.assertEqual(profile.read_text(), "working")
        self.assertFalse(previous.exists())
        self.assertFalse(self.cp.journal.exists())

    def test_recovery_preserves_journal_if_post_swap_tree_is_unexpected(self):
        network_dir = Path(self.temp.name) / "config" / "system-connections"
        network_dir.mkdir(parents=True)
        profile = network_dir / "uplink.nmconnection"
        profile.write_text("working")
        self.cp.profile_root = network_dir
        self.cp._backup_profiles = checkpoint.NetworkCheckpoint._backup_profiles.__get__(self.cp)
        self.cp._restore_profiles = checkpoint.NetworkCheckpoint._restore_profiles.__get__(self.cp)
        pending = self.cp.begin("connection-update", lambda: profile.write_text("bad"))
        previous = network_dir.parent / (".lightnas-pending-" + pending["transactionId"])
        network_dir.rename(previous)
        network_dir.mkdir()
        profile.write_text("unexpected")
        with self.assertRaisesRegex(RuntimeError, "differ from saved backup"):
            self.cp.recover_pending()
        self.assertTrue(self.cp.journal.exists(), "Do not discard recovery state on mismatch")
        self.assertTrue(previous.exists(), "Do not discard previous profiles on mismatch")

    def test_profile_symlinks_fail_closed_before_checkpoint_create(self):
        network_dir = Path(self.temp.name) / "config" / "system-connections"
        network_dir.mkdir(parents=True)
        (network_dir / "external").symlink_to("/etc/hosts")
        self.cp.profile_root = network_dir
        self.cp._backup_profiles = checkpoint.NetworkCheckpoint._backup_profiles.__get__(self.cp)
        with self.assertRaisesRegex(RuntimeError,"symlinks"):
            self.cp.begin("connection-update", lambda: None)
        self.assertEqual(self.calls, [], "No checkpoint or network action may run on unsafe profiles")

    def test_new_bond_bridge_vlan_profiles_are_checkpointed_and_recovered_on_failure(self):
        # All three operations write persistent NetworkManager profiles and
        # may change the management uplink after a hotplug or reboot. A failure
        # must never leave a partially created profile outside a checkpoint.
        host_spec = importlib.util.spec_from_file_location(
            "lightnas_host_agent_checkpoint_test", ROOT / "scripts" / "lightnas-host-agent.py"
        )
        host = importlib.util.module_from_spec(host_spec)
        host_spec.loader.exec_module(host)
        host.NETWORK_CHECKPOINT = self.cp
        cases = (
            ("bond-create", {"name": "bond0", "members": ["eth1"]}, 2),
            ("bridge-create", {"name": "br0", "uplink": "eth1"}, 2),
            ("vlan-create", {"name": "vlan42", "parent": "eth1", "vlanId": 42}, 1),
        )
        for action, options, fail_at in cases:
            with self.subTest(action=action):
                self.calls.clear()
                self.restores.clear()
                added = [0]

                def fail_run(args, timeout=30, check=True):
                    self.assertTrue(self.cp.journal.is_file(), "Network profile changed before durable checkpoint")
                    self.assertEqual(self.calls[0][0], "CheckpointCreate")
                    if args[:3] == ["nmcli", "connection", "add"]:
                        added[0] += 1
                        if added[0] == fail_at:
                            raise RuntimeError("injected NetworkManager profile failure")
                    return ""

                host.run = fail_run
                with self.assertRaisesRegex(RuntimeError, "injected NetworkManager profile failure"):
                    host.network_action({"action": action, **options})
                self.assertEqual(added[0], fail_at)
                self.assertTrue(any(call[0] == "CheckpointRollback" for call in self.calls))
                self.assertEqual(len(self.restores), 1, "Persistent profiles must be restored")
                self.assertFalse(self.cp.journal.exists(), "Recovered failure must clear the pending journal")

    def _use_real_profile_snapshot(self):
        network_dir = Path(self.temp.name) / "config" / "system-connections"
        network_dir.mkdir(parents=True)
        profile = network_dir / "uplink.nmconnection"
        profile.write_text("[connection]\\nid=known-good\\n")
        self.cp.profile_root = network_dir
        self.cp._backup_profiles = checkpoint.NetworkCheckpoint._backup_profiles.__get__(self.cp)
        self.cp._restore_profiles = checkpoint.NetworkCheckpoint._restore_profiles.__get__(self.cp)
        self.cp._remove_backup = checkpoint.NetworkCheckpoint._remove_backup.__get__(self.cp)
        return profile

    def test_profile_backup_is_synced_before_checkpoint_and_network_write(self):
        profile = self._use_real_profile_snapshot()
        flushed = []
        original_sync = self.cp._fsync_tree

        def recorded_sync(path):
            original_sync(path)
            flushed.append(str(path))

        self.cp._fsync_tree = recorded_sync
        original_bus = self.cp.call

        def checkpoint_after_sync(method, signature="", *args):
            if method == "CheckpointCreate":
                self.assertTrue(flushed, "A checkpoint must not precede durable recovery files")
                self.assertEqual(profile.read_text(), "[connection]\\nid=known-good\\n")
            return original_bus(method, signature, *args)

        self.cp.call = checkpoint_after_sync
        self.cp.begin("connection-update", lambda: profile.write_text("changed"))
        self.assertTrue(flushed)
        self.assertEqual(profile.read_text(), "changed")

    def test_backup_sync_failure_prevents_checkpoint_and_network_mutation(self):
        profile = self._use_real_profile_snapshot()
        self.cp._fsync_tree = lambda path: (_ for _ in ()).throw(OSError("injected disk sync failure"))
        changed = []
        with self.assertRaisesRegex(OSError, "injected disk sync failure"):
            self.cp.begin("connection-update", lambda: changed.append(True))
        self.assertFalse(changed, "Never modify a network without a durable rollback copy")
        self.assertEqual(self.calls, [], "NetworkManager checkpoint must not be created")
        self.assertFalse(self.cp.journal.exists())
        backup_root = self.cp.journal.parent / "network-backups"
        self.assertEqual(list(backup_root.iterdir()), [], "Discard incomplete backup")

    def test_restore_sync_failure_keeps_journal_and_retries_from_backup(self):
        profile = self._use_real_profile_snapshot()
        pending = self.cp.begin("connection-update", lambda: profile.write_text("bad-profile"))
        original_sync = self.cp._fsync_tree

        def failed_stage_sync(path):
            if Path(path).name.startswith(".lightnas-recovered-"):
                raise OSError("injected staged restore sync failure")
            return original_sync(path)

        self.cp._fsync_tree = failed_stage_sync
        with self.assertRaisesRegex(OSError, "injected staged restore sync failure"):
            self.cp.recover_pending()
        self.assertTrue(self.cp.journal.exists(), "Keep durable recovery state on failed restore")
        backup = self.cp.journal.parent / "network-backups" / pending["transactionId"]
        self.assertTrue(backup.exists())
        self.cp._fsync_tree = original_sync
        self.cp.recover_pending()
        self.assertEqual(profile.read_text(), "[connection]\\nid=known-good\\n")
        self.assertFalse(self.cp.journal.exists())
        self.assertFalse(backup.exists())

    def test_journal_unlink_sync_failure_never_discards_recovery_backup(self):
        profile = self._use_real_profile_snapshot()
        pending = self.cp.begin("connection-update", lambda: profile.write_text("bad-profile"))
        backup = self.cp.journal.parent / "network-backups" / pending["transactionId"]
        original_sync = self.cp._fsync_directory

        def failed_journal_unlink_sync(path):
            if Path(path) == self.cp.journal.parent and not self.cp.journal.exists():
                raise OSError("injected journal directory sync failure")
            return original_sync(path)

        self.cp._fsync_directory = failed_journal_unlink_sync
        with self.assertRaisesRegex(OSError, "injected journal directory sync failure"):
            self.cp.resolve({"transactionId": pending["transactionId"],
                             "confirmationToken": pending["confirmationToken"]}, commit=False)
        self.assertTrue(backup.exists(), "Never discard backup before durable journal deletion")
        self.assertEqual(profile.read_text(), "[connection]\\nid=known-good\\n")

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
