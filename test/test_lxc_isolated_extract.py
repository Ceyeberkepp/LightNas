import hashlib
import io
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "lxc-isolated-extract.py"

class IsolatedExtractorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.archive = self.root / "source.tar"
        self.output = self.root / "destination"
        self.output.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def build(self, entries):
        with tarfile.open(self.archive, "w") as tar:
            for name, payload, kind in entries:
                item = tarfile.TarInfo(name)
                if kind == "file":
                    item.size = len(payload)
                    tar.addfile(item, io.BytesIO(payload))
                elif kind == "symlink":
                    item.type = tarfile.SYMTYPE
                    item.linkname = "../../outside"
                    tar.addfile(item)
        return hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def run_restore(self, sha):
        return subprocess.run([sys.executable, str(SCRIPT), "--archive", str(self.archive),
            "--sha256", sha, "--destination-parent", str(self.output), "--name", "RestoredLxc"],
            capture_output=True, text=True)

    def test_valid_archive_stages_offline(self):
        sha = self.build([("etc/os-release", b"NAME=Test\n", "file"),
                          ("home/data.txt", b"preserved bytes", "file")])
        run = self.run_restore(sha)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual((self.output / "RestoredLxc/etc/os-release").read_bytes(), b"NAME=Test\n")
        self.assertIn('"containerCreated": false', run.stdout)

    def test_rejects_traversal_and_cleans_stage(self):
        sha = self.build([("etc/os-release", b"ok", "file"),
                          ("../escaped", b"unsafe", "file")])
        self.assertNotEqual(self.run_restore(sha).returncode, 0)
        self.assertFalse((self.root / "escaped").exists())
        self.assertEqual(list(self.output.iterdir()), [])

    def test_rejects_symlink(self):
        sha = self.build([("etc/os-release", b"ok", "file"),
                          ("link", b"", "symlink")])
        self.assertNotEqual(self.run_restore(sha).returncode, 0)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_checksum_mismatch_never_stages(self):
        self.build([("etc/os-release", b"ok", "file")])
        self.assertNotEqual(self.run_restore("0" * 64).returncode, 0)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_existing_destination_is_preserved(self):
        sha = self.build([("etc/os-release", b"ok", "file")])
        (self.output / "RestoredLxc").mkdir()
        self.assertNotEqual(self.run_restore(sha).returncode, 0)
        self.assertTrue((self.output / "RestoredLxc").is_dir())

if __name__ == "__main__":
    unittest.main()
