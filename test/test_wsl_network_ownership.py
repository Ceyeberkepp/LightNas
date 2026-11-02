"""Windows owns the WSL2 management interface; no LightNAS cutover."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("wsl_host_agent_test",ROOT/"scripts"/"lightnas-host-agent.py")
agent=importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class WslNetworkOwnershipTests(unittest.TestCase):
    def test_wsl_bootstrap_exits_before_network_discovery_or_bridge_cutover(self):
        script=(ROOT/"scripts"/"configure-appliance-network.sh").read_text()
        wsl_check=script.index("if grep -qi microsoft /proc/sys/kernel/osrelease")
        wsl_exit=script.index("  exit 0",wsl_check)
        first_discovery=script.index("preferred_uplink=")
        self.assertLess(wsl_check,wsl_exit)
        self.assertLess(wsl_exit,first_discovery)
        self.assertIn("LIGHTNAS_NETWORK_ERROR=wsl-host-managed",script)

    def test_wsl_refuses_mutating_host_network_even_if_client_requested_checkpoint(self):
        with patch.object(agent.platform,"release",return_value="6.18.40.1-microsoft-standard-WSL2"):
            for action in ("connection-update","wifi-connect","bridge-create",
                           "route-create","firewall-add","firewall-reset","device-disconnect"):
                with self.subTest(action=action):
                    with self.assertRaisesRegex(ValueError,"managed by Windows"):
                        agent.network_action({"action":action})
            with self.assertRaisesRegex(ValueError,"managed by Windows"):
                agent.network_action({"action":"route-create"},_checkpointed=True)

    def test_regular_linux_network_service_remains_enabled(self):
        with patch.object(agent.platform,"release",return_value="6.8.12-43-pve"):
            with patch.object(agent,"NETWORK_CHECKPOINT") as checkpoint:
                checkpoint.status.return_value={"pending":False}
                self.assertEqual(agent.network_action({"action":"network-transaction-status"}),{"pending":False})


if __name__=="__main__":
    unittest.main()
