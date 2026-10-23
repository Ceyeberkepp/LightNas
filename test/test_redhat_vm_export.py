import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
SCRIPT=Path(__file__).resolve().parents[1]/"scripts"/"export-redhat-offline-vm.py"
spec=importlib.util.spec_from_file_location("rh_export",SCRIPT)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
XML="<domain><devices><disk type='file' device='disk'><source file='{path}'/></disk></devices></domain>"
class RedHatExportTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.root=Path(self.temp.name)
  self.source=self.root/"source";self.target=self.root/"target"
  self.source.mkdir();self.target.mkdir()
  self.disk=self.source/"test.raw";self.disk.write_bytes(b"offline vm image data")
 def tearDown(self):self.temp.cleanup()
 def fake(self,*args):
  if "domstate" in args:return "shut off\n"
  if "dumpxml" in args:return XML.format(path=self.disk)
  if "qemu-img" in args:return json.dumps({"format":"raw"})
  raise AssertionError(args)
 def test_offline_export_writes_manifest_and_hash(self):
  with patch.object(module,"command",side_effect=self.fake):
   result=module.export_vm("Guest",self.source,self.target)
  self.assertEqual(result["state"],"exported-offline")
  self.assertEqual((self.target/"export-Guest"/"disk-0.img").read_bytes(),self.disk.read_bytes())
  self.assertFalse(result["bootTested"])
 def test_running_vm_refused(self):
  with patch.object(module,"command",return_value="running"):
   with self.assertRaisesRegex(ValueError,"shut off"):
    module.export_vm("Guest",self.source,self.target)
  self.assertEqual(list(self.target.iterdir()),[])
 def test_external_backing_chain_refused(self):
  def fake(*args):
   if "qemu-img" in args:return '{"format":"qcow2","backing-filename":"parent.qcow2"}'
   return self.fake(*args)
  with patch.object(module,"command",side_effect=fake):
   with self.assertRaisesRegex(ValueError,"backing chain"):
    module.export_vm("Guest",self.source,self.target)
  self.assertEqual(list(self.target.iterdir()),[])
if __name__=="__main__":unittest.main()
