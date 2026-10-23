import ast
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "scripts/lightnas-host-agent.py"
DIALOG = ROOT / "public/dialog-controls.js"

class NetworkStatusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = HOST.read_text(encoding="utf-8")
        cls.tree = ast.parse(cls.source)
        cls.dialog = DIALOG.read_text(encoding="utf-8")

    def test_live_route_patterns_detect_gateway_and_device(self):
        fn = next(x for x in self.tree.body if isinstance(x, ast.FunctionDef) and x.name == "container_settings")
        patterns = {}
        for node in ast.walk(fn):
            if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Call):
                continue
            if not isinstance(node.value.func, ast.Attribute) or node.value.func.attr != "search":
                continue
            if node.targets and isinstance(node.targets[0], ast.Name) and node.value.args and isinstance(node.value.args[0], ast.Constant):
                patterns[node.targets[0].id] = node.value.args[0].value
        route="default via 10.5.5.1 dev eth0 proto static"
        self.assertEqual(re.search(patterns["gateway_match"],route).group(1),"10.5.5.1")
        self.assertEqual(re.search(patterns["device_match"],route).group(1),"eth0")

    def test_live_dns_regex_detects_resolv_conf(self):
        fn = next(x for x in self.tree.body if isinstance(x, ast.FunctionDef) and x.name == "container_settings")
        patterns=[]
        for node in ast.walk(fn):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr=="findall":
                if node.args and isinstance(node.args[0],ast.Constant):
                    patterns.append(node.args[0].value)
        resolver=next(pattern for pattern in patterns if "nameserver" in pattern)
        self.assertEqual(re.findall(resolver,"nameserver 10.5.5.1\n",re.MULTILINE),["10.5.5.1"])

    def test_manager_dhcp_hides_static_fields(self):
        self.assertIn("data-static-network-field",self.dialog)
        self.assertIn("label.style.display = manual ? '' : 'none'",self.dialog)
        self.assertIn("field.disabled = !manual",self.dialog)
        self.assertIn("Current live gateway",self.dialog)
        self.assertIn("Current live DNS",self.dialog)

if __name__=="__main__":
    unittest.main()
