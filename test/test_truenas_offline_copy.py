import importlib.util
import tempfile
import unittest
from pathlib import Path
SCRIPT=Path(__file__).resolve().parents[1]/"scripts"/"truenas-offline-dataset-copy.py"
spec=importlib.util.spec_from_file_location("datasetcopy",SCRIPT)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class OfflineDatasetCopyTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory()
  self.base=Path(self.tmp.name)
  self.src=self.base/"source"
  self.dst=self.base/"destination"
  self.src.mkdir();self.dst.mkdir()
  (self.src/"readme.txt").write_text("test dataset")
 def tearDown(self):self.tmp.cleanup()
 def test_stages_verified_regular_files(self):
  result=module.copy_dataset(self.src,self.dst,"Dataset1")
  self.assertEqual((self.dst/"Dataset1"/"readme.txt").read_text(),"test dataset")
  self.assertFalse(result["aclRestored"])
 def test_symlinks_block_and_rollback(self):
  (self.src/"escape").symlink_to("/etc/passwd")
  with self.assertRaisesRegex(ValueError,"link"):
   module.copy_dataset(self.src,self.dst,"Dataset1")
  self.assertEqual(list(self.dst.iterdir()),[])
 def test_existing_destination_preserved(self):
  (self.dst/"Dataset1").mkdir()
  with self.assertRaisesRegex(ValueError,"already exists"):
   module.copy_dataset(self.src,self.dst,"Dataset1")
  self.assertTrue((self.dst/"Dataset1").is_dir())
 def test_overlapping_destination_rejected(self):
  with self.assertRaisesRegex(ValueError,"overlap"):
   module.copy_dataset(self.src,self.src,"Dataset1")
if __name__=="__main__":unittest.main()
