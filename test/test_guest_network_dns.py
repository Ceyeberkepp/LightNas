import ast
import unittest
from pathlib import Path

HOST=Path(__file__).resolve().parents[1]/"scripts"/"lightnas-host-agent.py"

class GuestNetworkProvisioningTests(unittest.TestCase):
 def test_dhcp_resolver_and_gateway_configuration_present(self):
  tree=ast.parse(HOST.read_text(encoding="utf-8"))
  fn=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=="configure_container_guest")
  code=ast.get_source_segment(HOST.read_text(encoding="utf-8"),fn)
  for expected in ("UseRoutes=yes","UseGateway=yes","UseDNS=yes","systemd-resolved.service",
                   "lightnas-dhcp-resolv.timer","/run/systemd/netif/leases/*"):
   self.assertIn(expected,code)
 def test_static_dns_written_to_guest_resolv(self):
  code=HOST.read_text(encoding="utf-8")
  self.assertIn('resolv_conf.write_text(',code)
  self.assertIn('if mode == "manual" and dns_values:',code)
 def test_dhcp_script_contains_correct_line_endings(self):
  tree=ast.parse(HOST.read_text(encoding="utf-8"))
  fn=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=="configure_container_guest")
  constants=[node.value for node in ast.walk(fn) if isinstance(node,ast.Constant) and isinstance(node.value,str)]
  self.assertIn("#!/bin/sh\n",constants)
  self.assertIn("for lease in /run/systemd/netif/leases/*; do\n",constants)

if __name__=="__main__":unittest.main()
