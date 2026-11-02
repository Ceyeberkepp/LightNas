import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "guest-network-migration-plan.py"
spec = importlib.util.spec_from_file_location("lightnas_guest_network_plan", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReadOnlyGuestNetworkPlanTests(unittest.TestCase):
    def test_lxc_planning_does_not_modify_config_or_metadata(self):
        with tempfile.TemporaryDirectory() as root:
            p = Path(root) / "ct-101"
            p.mkdir()
            config = p / "config"
            original = b"lxc.net.0.type = veth\nlxc.net.0.link = lightnas0\n"
            config.write_bytes(original)
            meta = p / "lightnas.json"
            meta.write_text('{"ipv4Mode":"manual"}')
            before = meta.read_bytes()
            result = module.build_plan(root, "nested-macvlan", "virbr0", "eth0")
            self.assertEqual(config.read_bytes(), original)
            self.assertEqual(meta.read_bytes(), before)
            self.assertEqual(len(result["lxcCandidates"]), 1)
            self.assertEqual(result["lxcCandidates"][0]["proposedTarget"]["type"], "macvlan")
            self.assertFalse(result["approved"])
            self.assertFalse(result["executable"])
            self.assertTrue(result["readOnly"])
            self.assertEqual(result, module.build_plan(root, "nested-macvlan", "virbr0", "eth0"))
            config.write_bytes(original + b"# changed\n")
            newer = module.build_plan(root, "nested-macvlan", "virbr0", "eth0")
            self.assertNotEqual(newer["planSha256"], result["planSha256"])

    def test_invalid_parent_or_symlink_fails_closed(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                module.build_plan(root, "nested-ipvlan", "virbr0", "")
            p = Path(root) / "ct-102"
            p.mkdir()
            target = Path(root) / "real"
            target.write_text("lxc.net.0.link = lightnas0")
            (p / "config").symlink_to(target)
            with self.assertRaises(ValueError):
                module.build_plan(root, "bridge", "virbr0", "")

    def test_libvirt_inventory_only_executes_read_commands(self):
        calls = []
        xml = '<domain><devices><interface type="bridge"><source bridge="virbr0"/></interface></devices></domain>'
        def fake_run(argv, **kwargs):
            calls.append(tuple(argv))
            if "list" in argv:
                stdout = "guest-01\n"
            elif "dumpxml" in argv:
                stdout = xml
            else:
                stdout = "running\n"
            return subprocess.CompletedProcess(argv, 0, stdout=stdout, stderr="")
        with patch.object(module.subprocess, "run", side_effect=fake_run):
            found = module.libvirt_targets("lxc-nat")
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["observedState"], "running")
        self.assertTrue(all(command[3] in {"list", "dumpxml", "domstate"} for command in calls))
        self.assertFalse(any(word in str(calls) for word in ("destroy", "shutdown", "define", "start")))

    def test_libvirt_error_is_not_silently_ignored(self):
        with patch.object(module.subprocess, "run", side_effect=subprocess.CalledProcessError(1, ["virsh"])):
            with self.assertRaises(subprocess.CalledProcessError):
                module.libvirt_targets("lxc-nat")


if __name__ == "__main__":
    unittest.main()
