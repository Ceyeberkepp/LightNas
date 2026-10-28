import ast
import tempfile
import json
import os
import ipaddress
import subprocess
from types import SimpleNamespace
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
  self.assertIn("#!/bin/sh\n","".join(constants))
  self.assertIn("for lease in /run/systemd/netif/leases/*; do\n","".join(constants))

 def configure_fixture(self, mode="dhcp"):
  temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
  root=Path(temporary.name);rootfs=root/"rootfs"
  (rootfs/"etc").mkdir(parents=True);(rootfs/"usr/lib/systemd").mkdir(parents=True)
  tree=ast.parse(HOST.read_text(encoding="utf-8"))
  fn=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=="configure_container_guest")
  namespace={"Path":Path,"os":os,"json":json,"ipaddress":ipaddress,
   "rootfs_from_config":lambda _:rootfs,"lightnas_network_state":lambda:{},
   "_nested_routed_guest_next_hop":lambda *_:"",
   "subprocess":SimpleNamespace(run=lambda *a,**k:SimpleNamespace(returncode=0),DEVNULL=subprocess.DEVNULL)}
  exec(compile(ast.Module(body=[fn],type_ignores=[]),str(HOST),"exec"),namespace)
  namespace["configure_container_guest"](root/"config",{"password":"fixture-secret","ipv4Mode":mode,"ipv4Address":"10.5.5.8/24","gateway":"10.5.5.1","dns":"10.5.5.1, 1.1.1.1"})
  return rootfs
 def test_generated_dhcp_files_have_real_lines(self):
  rootfs=self.configure_fixture()
  script=rootfs/"usr/local/sbin/lightnas-dhcp-resolv"
  text=script.read_text()
  self.assertTrue(text.startswith("#!/bin/sh\n"))
  self.assertIn('printf "nameserver %s\\n"',text)
  result=subprocess.run(["sh","-n",str(script)],capture_output=True,text=True)
  self.assertEqual(result.returncode,0,result.stderr)
  unit=(rootfs/"etc/systemd/system/lightnas-dhcp-resolv.service").read_text()
  timer=(rootfs/"etc/systemd/system/lightnas-dhcp-resolv.timer").read_text()
  self.assertIn("[Unit]\n",unit);self.assertIn("[Service]\n",unit)
  self.assertIn("[Timer]\n",timer);self.assertNotIn("\\n",unit+timer)
 def test_static_dns_writes_separate_resolver_records(self):
  rootfs=self.configure_fixture("manual")
  self.assertEqual((rootfs/"etc/resolv.conf").read_text(),"nameserver 10.5.5.1\nnameserver 1.1.1.1\n")

if __name__=="__main__":unittest.main()
