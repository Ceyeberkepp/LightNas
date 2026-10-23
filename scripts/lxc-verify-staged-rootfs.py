#!/usr/bin/env python3
"""Read-only verification of an offline LightNAS LXC rootfs staging directory."""
import argparse
import hashlib
import json
import os
import stat
import sys
from pathlib import Path

MAX_ENTRIES = 200000
MAX_BYTES = 128 * 1024 ** 3
BLOCK = 1024 * 1024

def verify(root):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("rootfs must be an existing real directory")
    root_stat = os.lstat(root)
    if not stat.S_ISDIR(root_stat.st_mode):
        raise ValueError("rootfs must be a directory")
    file_count = 0
    dir_count = 0
    total_bytes = 0
    entries = []
    seen = set()
    def visit(folder, prefix=""):
        nonlocal file_count, dir_count, total_bytes
        with os.scandir(folder) as iterator:
            for item in iterator:
                relative = prefix + item.name
                if relative in seen:
                    raise ValueError("duplicate rootfs path")
                seen.add(relative)
                if len(seen) > MAX_ENTRIES:
                    raise ValueError("rootfs entry limit exceeded")
                metadata = item.stat(follow_symlinks=False)
                if stat.S_ISDIR(metadata.st_mode):
                    dir_count += 1
                    entries.append({"path":relative,"type":"directory"})
                    visit(item.path, relative + "/")
                elif stat.S_ISREG(metadata.st_mode):
                    file_count += 1
                    total_bytes += metadata.st_size
                    if total_bytes > MAX_BYTES:
                        raise ValueError("rootfs byte limit exceeded")
                    digest = hashlib.sha256()
                    fd = os.open(item.path, os.O_RDONLY | os.O_NOFOLLOW)
                    try:
                        before = os.fstat(fd)
                        if not stat.S_ISREG(before.st_mode):
                            raise ValueError("rootfs file changed during inspection")
                        while True:
                            chunk = os.read(fd, BLOCK)
                            if not chunk:
                                break
                            digest.update(chunk)
                        after = os.fstat(fd)
                        if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
                            raise ValueError("rootfs file changed while verifying")
                    finally:
                        os.close(fd)
                    entries.append({"path":relative,"type":"file","size":metadata.st_size,"sha256":digest.hexdigest()})
                else:
                    raise ValueError("rootfs contains a symlink or special file")
    visit(str(root))
    paths={x["path"] for x in entries if x["type"]=="file"}
    if not ({"etc/os-release","etc/debian_version"} & paths):
        raise ValueError("Linux rootfs marker is missing")
    entries.sort(key=lambda x:x["path"])
    manifest_hash=hashlib.sha256(json.dumps(entries,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    return {"phase":"lxc-rootfs-verification","state":"verified-offline",
            "files":file_count,"directories":dir_count,"bytes":total_bytes,
            "manifestSha256":manifest_hash,"containerCreated":False,
            "permissionsRestored":False,"started":False}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--rootfs",required=True)
    args=parser.parse_args()
    try:
        print(json.dumps(verify(args.rootfs),sort_keys=True))
    except (OSError,ValueError,RecursionError) as e:
        print(json.dumps({"error":str(e)}),file=sys.stderr)
        sys.exit(1)

if __name__=="__main__":
    main()
