#!/usr/bin/env python3
"""Offline, unprivileged LXC rootfs extraction. Never registers or starts a container.

Only regular files and directories are supported. Ownership, ACLs, xattrs and
capabilities intentionally require a separate privileged restoration phase.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tarfile
import uuid

MAX_ENTRIES = 200000
MAX_BYTES = 128 * 1024 ** 3
CHUNK = 1024 * 1024
NAME = re.compile(r"^[A-Za-z][A-Za-z0-9-]{1,39}$")
HASH = re.compile(r"^[a-fA-F0-9]{64}$")

def fail(reason):
    raise ValueError(reason)

def components(path):
    if not isinstance(path, str) or len(path) > 4096 or path.startswith("/") or "\\" in path or "\x00" in path:
        fail("unsafe archive path")
    value = path.rstrip("/")
    parts = value.split("/")
    if not value or any(p in ("", ".", "..") for p in parts):
        fail("unsafe archive path")
    return parts

def walk_dir(rootfd, parts):
    fd = os.dup(rootfd)
    try:
        for part in parts:
            try:
                os.mkdir(part, mode=0o700, dir_fd=fd)
            except FileExistsError:
                pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise

def verify_digest(path, expected):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(CHUNK), b""):
            digest.update(block)
    if digest.hexdigest().lower() != expected.lower():
        fail("archive SHA-256 mismatch")

def extract(archive, expected_sha256, destination_parent, name):
    if not HASH.fullmatch(expected_sha256) or not NAME.fullmatch(name):
        fail("invalid digest or destination name")
    if not os.path.isfile(archive) or os.path.islink(archive):
        fail("archive must be a regular file")
    if not os.path.isdir(destination_parent) or os.path.islink(destination_parent):
        fail("destination parent must be an existing directory")
    verify_digest(archive, expected_sha256)
    parentfd = os.open(destination_parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    tempname = ".lightnas-restore-" + uuid.uuid4().hex
    count = 0
    written = 0
    seen = set()
    committed = False
    try:
        try:
            os.stat(name, dir_fd=parentfd, follow_symlinks=False)
            fail("destination already exists")
        except FileNotFoundError:
            pass
        os.mkdir(tempname, mode=0o700, dir_fd=parentfd)
        rootfd = os.open(tempname, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parentfd)
        try:
            with tarfile.open(archive, "r|*") as tar:
                for member in tar:
                    count += 1
                    if count > MAX_ENTRIES:
                        fail("archive entry limit exceeded")
                    parts = components(member.name)
                    normalized = "/".join(parts)
                    if normalized in seen:
                        fail("duplicate archive member")
                    seen.add(normalized)
                    if not (member.isfile() or member.isdir()):
                        fail("links and special archive members are not supported")
                    if member.size < 0 or (member.isfile() and written + member.size > MAX_BYTES):
                        fail("extracted byte limit exceeded")
                    folderfd = walk_dir(rootfd, parts[:-1])
                    try:
                        if member.isdir():
                            try:
                                os.mkdir(parts[-1], mode=0o700, dir_fd=folderfd)
                            except FileExistsError:
                                existing = os.open(parts[-1], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=folderfd)
                                os.close(existing)
                        else:
                            source = tar.extractfile(member)
                            if source is None:
                                fail("archive member cannot be read")
                            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
                            filefd = os.open(parts[-1], flags, 0o600, dir_fd=folderfd)
                            try:
                                remaining = member.size
                                while remaining:
                                    data = source.read(min(CHUNK, remaining))
                                    if not data:
                                        fail("truncated archive member")
                                    view = memoryview(data)
                                    while view:
                                        n = os.write(filefd, view)
                                        if n <= 0:
                                            fail("short filesystem write")
                                        view = view[n:]
                                    remaining -= len(data)
                                os.fsync(filefd)
                            finally:
                                os.close(filefd)
                            written += member.size
                    finally:
                        os.close(folderfd)
            if "etc/os-release" not in seen and "etc/debian_version" not in seen:
                fail("restored rootfs marker missing")
            os.rename(tempname, name, src_dir_fd=parentfd, dst_dir_fd=parentfd)
            os.fsync(parentfd)
            committed = True
        finally:
            os.close(rootfd)
    finally:
        os.close(parentfd)
        if not committed:
            shutil.rmtree(os.path.join(destination_parent, tempname), ignore_errors=True)
    return {"state":"staged-offline","name":name,"entries":count,"bytesWritten":written,
            "containerCreated":False,"permissionsRestored":False,"started":False}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--archive",required=True)
    parser.add_argument("--sha256",required=True)
    parser.add_argument("--destination-parent",required=True)
    parser.add_argument("--name",required=True)
    args=parser.parse_args()
    try:
        print(json.dumps(extract(args.archive,args.sha256,args.destination_parent,args.name)))
    except (OSError,ValueError,tarfile.TarError) as error:
        print(json.dumps({"error":str(error)}),file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
