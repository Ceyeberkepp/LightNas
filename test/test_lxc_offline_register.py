import importlib.util
import tempfile
import unittest
from pathlib import Path
SCRIPT=Path(__file__).resolve().parents[1]/"scripts"/"lxc-register-offline.py"
spec=importlib.util.spec_from_file_location("register_lxc",SCRIPT)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
VERIFY=Path(__file__).resolve().parents[1]/"scripts"/"lxc-verify-staged-rootfs.py"
spec2=importlib.util.spec_from_file_location("verify_lxc",VERIFY)
v=importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(v)
CONFIG="lxc.uts.name = Restore1\nlxc.net.0.flags = down\nlxc.start.auto = 0\n"
class BundleTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory()
  self.parent=Path(self.tmp.name)
  self.root=self.parent/"root";(self.root/"etc").mkdir(parents=True)
  (self.root/"etc"/"os-release").write_text("NAME=Test")
  self.dest=self.parent/"out";self.dest.mkdir()
 def tearDown(self):self.tmp.cleanup()
 def test_bundle_is_offline(self):
  sha=v.verify(self.root)["manifestSha256"]
  result=module.register(self.root,self.dest,"Restore1",sha,CONFIG)
  self.assertFalse(result["containerInstalled"])
  self.assertFalse(result["started"])
  self.assertTrue((self.dest/"Restore1"/"config").exists())
 def test_changed_rootfs_prevents_registration(self):
  sha=v.verify(self.root)["manifestSha256"]
  (self.root/"etc"/"os-release").write_text("NAME=Changed")
  with self.assertRaisesRegex(ValueError,"fingerprint"):
   module.register(self.root,self.dest,"Restore1",sha,CONFIG)
  self.assertEqual(list(self.dest.iterdir()),[])
 def test_hooks_rejected(self):
  sha=v.verify(self.root)["manifestSha256"]
  with self.assertRaisesRegex(ValueError,"unsafe configuration"):
   module.register(self.root,self.dest,"Restore1",sha,CONFIG+"lxc.hook.pre-start = /bin/true\n")
 def test_duplicate_target_preserved(self):
  sha=v.verify(self.root)["manifestSha256"]
  (self.dest/"Restore1").mkdir()
  with self.assertRaisesRegex(ValueError,"already exists"):
   module.register(self.root,self.dest,"Restore1",sha,CONFIG)
if __name__=="__main__":unittest.main()
