"""Regression checks: unsafe management cutovers never run unguarded."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("lightnas_host_guard_test", ROOT / "scripts" / "lightnas-host-agent.py")
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)
require_safe_network_mutation = agent.require_safe_network_mutation
ACTIVATION_ACTIONS = agent.PROTECTED_NETWORK_ACTIVATION_ACTIONS
PROTECTED_LIVE_ACTIONS = agent.PROTECTED_LIVE_NETWORK_ACTIONS


class NetworkMutationGuardTests(unittest.TestCase):
    def test_unprotected_live_network_changes_are_rejected(self):
        for action in sorted(PROTECTED_LIVE_ACTIONS):
            for payload in ({}, {"activate": False}, {"force": True, "confirm": True}):
                with self.subTest(action=action, payload=payload):
                    with self.assertRaisesRegex(ValueError, "timed network rollback"):
                        require_safe_network_mutation(action, payload)

    def test_immediate_profile_activation_is_rejected(self):
        for action in sorted(ACTIVATION_ACTIONS):
            for flag in (True, "true", "false", "yes", 1, 0, None):
                with self.subTest(action=action, flag=flag):
                    with self.assertRaisesRegex(ValueError, "timed rollback"):
                        require_safe_network_mutation(action, {"activate": flag})

    def test_firewall_deny_rule_is_blocked_but_allow_rule_can_be_prepared(self):
        with self.assertRaisesRegex(ValueError, "timed network rollback"):
            require_safe_network_mutation("firewall-add", {
                "decision": "deny", "protocol": "tcp", "port": 3080
            })
        with self.assertRaisesRegex(ValueError, "timed network rollback"):
            require_safe_network_mutation("firewall-add", {
                "decision": "DENY", "protocol": "udp", "port": 5353, "force": True
            })
        require_safe_network_mutation("firewall-add", {
            "decision": "allow", "protocol": "tcp", "port": 443
        })

    def test_nonactivating_profile_drafts_and_safe_queries_still_work(self):
        for action in sorted(ACTIVATION_ACTIONS):
            require_safe_network_mutation(action, {"activate": False})
            require_safe_network_mutation(action, {})
        for action in ("network-inventory", "firewall-add", "bond-create", "vlan-create"):
            require_safe_network_mutation(action, {})

    def test_privileged_agent_enforces_guard_before_any_host_action(self):
        source = (ROOT / "scripts" / "lightnas-host-agent.py").read_text()
        self.assertIn("def require_safe_network_mutation(action: str, data: dict)", source)
        function = source.split("def network_action(data: dict) -> dict:", 1)[1]
        start = function.split("if action == \"firewall-add\":", 1)[0]
        self.assertIn("require_safe_network_mutation(action, data)", start)
        self.assertNotIn("run(", start)


if __name__ == "__main__":
    unittest.main()
