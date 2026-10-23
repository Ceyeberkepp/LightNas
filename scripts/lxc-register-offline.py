#!/usr/bin/env python3
"""Create a non-running LXC registration bundle from a verified offline rootfs.

Does not install host idmaps, touch /var/lib/lxc, or start a guest.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import uuid
NAME=re.compile(r"^[A-Za-z][A-Za-z0-9-]{1,39}$")
SHA=re.compile(r"^[a-f0-9]{64}$")
def register(rootfs, parent, name, fingerprint, config):
    rootfs=Path(rootfs)
    parent=Path(parent)
    if not NAME.fullmatch(name) or not SHA.fullmatch(fingerprint):raise ValueError("invalid registration identity")
    if rootfs.is_symlink() or not rootfs.is_dir() or parent.is_symlink() or not parent.is_dir():
        raise ValueError("rootfs and parent must be real directories")
    if rootfs.resolve()==parent.resolve() or rootfs.resolve() in parent.resolve().parents or parent.resolve() in rootfs.resolve().parents:
        raise ValueError("rootfs and registration directories overlap")
    if not isinstance(config,str) or len(config)>16384 or "lxc.start.auto = 0\n" not in config or "lxc.net.0.flags = down\n" not in config:
        raise ValueError("offline configuration required")
    permitted={"lxc.uts.name","lxc.idmap","lxc.cgroup2.memory.max","lxc.net.0.type","lxc.net.0.link","lxc.net.0.flags","lxc.start.auto"}
    if any(line.count(" = ")!=1 or line.split(" = ",1)[0] not in permitted for line in config.splitlines()):
        raise ValueError("unsafe configuration directive")
    output=parent/name
    if output.exists() or output.is_symlink():raise ValueError("registration already exists")
    tmp=parent/(".lightnas-registration-"+uuid.uuid4().hex)
    tmp.mkdir(mode=0o700)
    try:
        verifier=Path(__file__).with_name("lxc-verify-staged-rootfs.py")
        spec=importlib.util.spec_from_file_location("lightnas_verify",verifier)
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result=module.verify(rootfs)
        if result["manifestSha256"]!=fingerprint:raise ValueError("rootfs manifest fingerprint changed")
        with (tmp/"config").open("x",encoding="utf8") as handle:
            handle.write(config)
            handle.flush();os.fsync(handle.fileno())
        with (tmp/"rootfs-location.json").open("x",encoding="utf8") as handle:
            json.dump({"rootfs":str(rootfs.resolve()),"manifestSha256":fingerprint,"verified":True},handle)
            handle.flush();os.fsync(handle.fileno())
        tmp.rename(output)
        return {"state":"registered-offline-bundle","name":name,"rootfsVerified":True,
                "containerInstalled":False,"started":False,"rollback":"delete the offline bundle"}
    except BaseException:
        shutil.rmtree(tmp,ignore_errors=True)
        raise
if __name__=="__main__":
    p=argparse.ArgumentParser()
    for arg in ("rootfs","registration-parent","name","manifest-sha256","config-file"):
        p.add_argument("--"+arg,required=True)
    a=p.parse_args()
    try:
        cfg=Path(a.config_file).read_text(encoding="utf8")
        print(json.dumps(register(a.rootfs,a.registration_parent,a.name,a.manifest_sha256,cfg)))
    except (OSError,ValueError) as e:
        print(json.dumps({"error":str(e)}),file=sys.stderr);sys.exit(1)
