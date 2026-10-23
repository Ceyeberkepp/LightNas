import importlib.util
import tempfile
import unittest
from pathlib import Path
SCRIPT=Path(__file__).resolve().parents[1]/"scripts"/"lxc-verify-staged-rootfs.py"
spec=importlib.util.spec_from_file_location("lxc_verify",SCRIPT)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class VerificationTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.root=Path(self.temp.name)/"Rootfs"
  (self.root/"etc").mkdir(parents=True)
  (self.root/"etc"/"os-release").write_text("NAME=Test\n")
 def tearDown(self):
  self.temp.cleanup()
 def test_offline_manifest_is_deterministic(self):
  a=module.verify(self.root);b=module.verify(self.root)
  self.assertEqual(a["manifestSha256"],b["manifestSha256"])
  self.assertEqual(a["state"],"verified-offline")
  self.assertFalse(a["containerCreated"])
 def test_file_change_changes_fingerprint(self):
  first=module.verify(self.root)["manifestSha256"]
  (self.root/"etc"/"os-release").write_text("NAME=Other\n")
  self.assertNotEqual(first,module.verify(self.root)["manifestSha256"])
 def test_symlink_is_rejected(self):
  (self.root/"escape").symlink_to("/etc/passwd")
  with self.assertRaisesRegex(ValueError,"symlink"):
   module.verify(self.root)
 def test_missing_rootfs_marker_is_rejected(self):
  (self.root/"etc"/"os-release").unlink()
  with self.assertRaisesRegex(ValueError,"marker"):
   module.verify(self.root)
 def test_special_file_is_rejected(self):
  import os
  os.mkfifo(self.root/"pipe")
  with self.assertRaisesRegex(ValueError,"special"):
   module.verify(self.root)

if __name__=="__main__":
 unittest.main()
