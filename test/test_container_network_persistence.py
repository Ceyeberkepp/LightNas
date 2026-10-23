import ast
import re
import unittest
from pathlib import Path
SOURCE=Path(__file__).resolve().parents[1]/"scripts"/"lightnas-host-agent.py"
class PersistedNetworkTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  source=SOURCE.read_text(encoding="utf-8")
  module=ast.parse(source)
  fn=next(x for x in module.body if isinstance(x,ast.FunctionDef) and x.name=="container_settings")
  cls.fn=fn
  cls.source=source
 def test_saved_dhcp_mode_is_recognized(self):
  patterns=[]
  for node in ast.walk(self.fn):
   if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=="search":
    if node.args and isinstance(node.args[0],ast.Constant) and isinstance(node.args[0].value,str):
     patterns.append(node.args[0].value)
  pattern=next(x for x in patterns if "DHCP" in x)
  self.assertIsNotNone(re.search(pattern,"[Match]\nName=eth0\n[Network]\nDHCP=ipv4\n",re.MULTILINE|re.IGNORECASE))
 def test_saved_static_gateway_is_recognized(self):
  patterns=[]
  for node in ast.walk(self.fn):
   if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=="search":
    if node.args and isinstance(node.args[0],ast.Constant) and isinstance(node.args[0].value,str):
     patterns.append(node.args[0].value)
  pattern=next(x for x in patterns if "Gateway" in x and x.startswith("^"))
  self.assertEqual(re.search(pattern,"Gateway=10.5.5.1\n",re.MULTILINE).group(1),"10.5.5.1")
 def test_live_default_gateway_detected(self):
  self.assertIn('r"\\bvia\\s+([0-9.]+)"',self.source)
  self.assertEqual(re.search(r"\bvia\s+([0-9.]+)","default via 10.5.5.1 dev eth0").group(1),"10.5.5.1")
 def test_resolver_detected(self):
  self.assertIn('r"^nameserver\\s+([^\\s#]+)"',self.source)
  self.assertEqual(re.findall(r"^nameserver\s+([^\s#]+)","nameserver 10.5.5.1",re.MULTILINE),["10.5.5.1"])
if __name__=="__main__":unittest.main()
