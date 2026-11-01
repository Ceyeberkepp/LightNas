"""Regression tests for non-cached NetworkManager recovery integrity checks.

Uses temporary directories only. No NetworkManager D-Bus calls, appliance
network changes or real host profiles.
"""
import importlib.util
import os
import tempfile
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "network_checkpoint_uncached_test", ROOT / "scripts" / "network_checkpoint.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NetworkProfileFreshCompareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.expected = base / "expected"
        self.actual = base / "actual"
        for root in (self.expected, self.actual):
            root.mkdir(mode=0o700)
            profile = root / "uplink.nmconnection"
            profile.write_bytes(b"good")
            profile.chmod(0o600)

    def same(self):
        return module.NetworkCheckpoint._same_profile_tree(self.expected, self.actual)

    def test_same_size_corruption_with_restored_mtime_invalidates_previous_match(self):
        self.assertTrue(self.same(), "prime the old filecmp cache with an equal result")
        profile = self.actual / "uplink.nmconnection"
        before = profile.stat()
        profile.write_bytes(b"evil")  # same byte length as the original
        os.utime(profile, ns=(before.st_atime_ns, before.st_mtime_ns))
        self.assertEqual(profile.stat().st_size, before.st_size)
        self.assertEqual(profile.stat().st_mtime_ns, before.st_mtime_ns)
        self.assertFalse(self.same(), "a previous equality result must never be reused")

    def test_repeated_valid_comparisons_remain_accepted(self):
        self.assertTrue(self.same())
        self.assertTrue(self.same())

    def test_profile_replaced_with_fifo_before_open_fails_without_blocking(self):
        # Simulate a swap after metadata enumeration but before descriptor open.
        # O_NONBLOCK must be present so a substituted FIFO cannot hang recovery.
        profile = self.actual / "uplink.nmconnection"
        original_open = os.open
        swapped = False

        def swap_before_open(path, flags, *args, **kwargs):
            nonlocal swapped
            if str(path) == str(profile) and not swapped:
                self.assertTrue(flags & os.O_NONBLOCK, "FIFO swap must not block")
                swapped = True
                profile.unlink()
                os.mkfifo(profile, 0o600)
            return original_open(path, flags, *args, **kwargs)

        with mock.patch.object(module.os, "open", side_effect=swap_before_open):
            self.assertFalse(self.same())
        self.assertTrue(swapped)

    def test_file_swapped_to_fifo_after_metadata_cannot_skip_byte_comparison(self):
        # A previously verified regular file can be replaced after lstat()
        # and before the old path.is_file() dispatch. That old dispatch
        # returned False for a FIFO and skipped the byte comparison entirely.
        profile = self.expected / "uplink.nmconnection"
        original_lstat = Path.lstat
        swapped = False

        def swap_after_lstat(path, *args, **kwargs):
            nonlocal swapped
            info = original_lstat(path, *args, **kwargs)
            if str(path) == str(profile) and not swapped:
                swapped = True
                profile.unlink()
                os.mkfifo(profile, 0o600)
            return info

        with mock.patch.object(Path, "lstat", autospec=True, side_effect=swap_after_lstat):
            self.assertFalse(self.same(), "metadata-verified regular files must always be byte-checked")
        self.assertTrue(swapped)

    def test_path_swapped_after_read_is_rejected(self):
        # Opening the original profile protects the descriptor, not its
        # pathname. A swap after the initial identity check and byte reads
        # must be detected before recovery can discard its durable backup.
        profile = self.actual / "uplink.nmconnection"
        outside = Path(self.temp.name) / "external-profile"
        outside.write_bytes(b"evil")
        original_read = os.read
        swapped = False

        def replace_after_read(fd, count):
            nonlocal swapped
            chunk = original_read(fd, count)
            if not swapped and chunk == b"good":
                swapped = True
                profile.unlink()
                profile.symlink_to(outside)
            return chunk

        with mock.patch.object(module.os, "read", side_effect=replace_after_read):
            self.assertFalse(self.same(), "post-read path replacement must fail closed")
        self.assertTrue(swapped)
        self.assertTrue(profile.is_symlink())
        self.assertEqual(outside.read_bytes(), b"evil")

    def test_replaced_profile_symlink_is_rejected(self):
        profile = self.actual / "uplink.nmconnection"
        target = Path(self.temp.name) / "outside"
        target.write_bytes(b"good")
        profile.unlink()
        profile.symlink_to(target)
        self.assertFalse(self.same(), "a symlink must not be followed as a trusted keyfile")


if __name__ == "__main__":
    unittest.main()
