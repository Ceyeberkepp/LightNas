"""Safety and regression tests for the LightNAS one-click management port guard."""
import importlib.util
import signal
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "management_port_reconcile", ROOT / "scripts" / "reconcile-management-port.py"
)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class ManagementPortGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.server = self.base / "lightnas" / "src" / "server.mjs"
        self.server.parent.mkdir(parents=True)
        self.server.write_text("// safe fixture")
        self.proc = self.base / "proc"
        self.proc.mkdir()

    def process(self, pid, *, command=None, cgroup="0::/user.slice/session-12.scope\n"):
        directory = self.proc / str(pid)
        directory.mkdir(parents=True)
        if command is None:
            command = ["/usr/bin/node", str(self.server)]
        (directory / "cmdline").write_bytes(
            b"\0".join(item.encode() for item in command) + b"\0"
        )
        (directory / "cgroup").write_text(cgroup)
        (directory / "cwd").symlink_to(self.server.parent)
        return directory

    def test_reclaims_only_exact_unmanaged_lightnas_entrypoint(self):
        self.process(105)
        self.assertTrue(guard.is_orphaned_lightnas(105, self.server, self.proc))
        state = {"present": True}
        stopped = []

        def read_listeners(port):
            self.assertEqual(port, 3080)
            if state["present"]:
                return ['LISTEN 0 511 0.0.0.0:3080 users:(("node",pid=105,fd=17))'], {105}
            return [], set()

        def terminate(pid, sig):
            stopped.append((pid, sig))
            state["present"] = False

        result = guard.reconcile(
            3080, self.server, read_listeners=read_listeners,
            is_orphan=lambda pid, path: guard.is_orphaned_lightnas(pid, path, self.proc),
            terminate=terminate, sleep=lambda _: None,
        )
        self.assertIn("available", result)
        self.assertEqual(stopped, [(105, signal.SIGTERM)])

    def test_rejects_unrelated_node_and_does_not_send_signal(self):
        other = self.base / "another-app.js"
        other.write_text("// unrelated")
        self.process(110, command=["/usr/bin/node", str(other)])
        self.assertFalse(guard.is_orphaned_lightnas(110, self.server, self.proc))
        with self.assertRaisesRegex(guard.PortConflict, "unknown or separately managed"):
            guard.reconcile(
                3080, self.server,
                read_listeners=lambda _: (["LISTEN TCP:3080"], {110}),
                is_orphan=lambda pid, path: guard.is_orphaned_lightnas(pid, path, self.proc),
                terminate=lambda *_: self.fail("Never terminate unrelated app"),
            )

    def test_rejects_different_systemd_service_even_when_code_matches(self):
        self.process(120, cgroup="0::/system.slice/other-web.service\n")
        self.assertFalse(guard.is_orphaned_lightnas(120, self.server, self.proc))

    def test_accepts_user_session_not_another_systemd_service(self):
        self.process(
            121, cgroup="0::/user.slice/user-1000.slice/user@1000.service/app.slice/app.scope\n"
        )
        self.assertTrue(guard.is_orphaned_lightnas(121, self.server, self.proc))

    def test_refuses_listener_with_no_visible_pid(self):
        with self.assertRaisesRegex(guard.PortConflict, "unknown or separately managed"):
            guard.reconcile(
                3080, self.server,
                read_listeners=lambda _: (["LISTEN port 3080"], set()),
                terminate=lambda *_: self.fail("Never terminate unknown owner"),
            )

    def test_refuses_changed_ownership_before_signal(self):
        visits = [(["LISTEN"], {140}), (["LISTEN"], {140})]

        def read_listeners(_):
            return visits.pop(0)

        matches = iter([True, False])
        with self.assertRaisesRegex(guard.PortConflict, "changed ownership"):
            guard.reconcile(
                3080, self.server, read_listeners=read_listeners,
                is_orphan=lambda *_: next(matches),
                terminate=lambda *_: self.fail("Never signal reclassified process"),
            )

    def test_installer_stops_managed_service_and_checks_port_before_restart(self):
        installer = (ROOT / "install.sh").read_text()
        stop = 'systemctl stop "' + '$' + '{SERVICE_NAME}.service"'
        inspect = 'scripts/reconcile-management-port.py'
        restart = 'systemctl restart "' + '$' + '{SERVICE_NAME}"'
        self.assertLess(installer.index(stop), installer.index(inspect))
        self.assertLess(installer.index(inspect), installer.index(restart))
        active = 'systemctl is-active --quiet "' + '$' + '{SERVICE_NAME}.service"'
        self.assertIn(active, installer)
        self.assertIn("setupRequired", installer)
        self.assertIn("-s /etc/lightnas/tls/nas.crt", installer)
        self.assertIn("-s /etc/lightnas/tls/nas.key", installer)


if __name__ == "__main__":
    unittest.main()
