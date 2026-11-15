#!/usr/bin/env python3
"""Offline unit tests for persistent LightNAS ISO Ethernet configuration."""
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

FILE = Path(__file__).resolve().parents[1] / "scripts/lightnas-install-network.py"
spec = importlib.util.spec_from_file_location("lightnas_network_stage", FILE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NetworkStagingTest(unittest.TestCase):
    def setUp(self):
        self.nic = next((p.name for p in Path("/sys/class/net").iterdir()
                         if p.name != "lo" and not (p / "wireless").exists()), None)
        if not self.nic:
            self.skipTest("No Ethernet interface exposed by test runner")
        self.mac = (Path("/sys/class/net") / self.nic / "address").read_text().strip()

    def payload(self, mode="dhcp"):
        return {"interface": self.nic, "mac": self.mac, "mode": mode,
                "address": "10.18.0.25/16", "gateway": "10.18.0.1",
                "dns": ["10.18.0.10", "1.1.1.1"]}

    def test_dhcp_profile(self):
        with TemporaryDirectory() as tmp:
            (Path(tmp) / "etc").mkdir()
            module.stage(self.payload(), tmp)
            profile = Path(tmp) / "etc/NetworkManager/system-connections" / f"lightnas-management-{self.nic}.nmconnection"
            text = profile.read_text()
            self.assertIn("method=auto", text)
            self.assertIn("interface-name=" + self.nic, text)
            self.assertIn("autoconnect=true", text)
            self.assertEqual(profile.stat().st_mode & 0o777, 0o600)

    def test_static_profile(self):
        with TemporaryDirectory() as tmp:
            (Path(tmp) / "etc").mkdir()
            module.stage(self.payload("static"), tmp)
            profile = Path(tmp) / "etc/NetworkManager/system-connections" / f"lightnas-management-{self.nic}.nmconnection"
            text = profile.read_text()
            self.assertIn("method=manual", text)
            self.assertIn("address1=10.18.0.25/16,10.18.0.1", text)
            self.assertIn("dns=10.18.0.10;1.1.1.1;", text)

    def test_invalid_gateway_prevents_staging(self):
        data = self.payload("static")
        data["gateway"] = "192.168.8.1"
        with self.assertRaises(ValueError):
            module.validate(data)

    def test_wrong_mac_is_rejected(self):
        data = self.payload()
        data["mac"] = "aa:bb:cc:dd:ee:ff"
        with self.assertRaises(ValueError):
            module.validate(data)


if __name__ == "__main__":
    unittest.main()
