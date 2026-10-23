#!/usr/bin/env python3
"""Export an OFFLINE Red Hat libvirt file-backed VM disk into an empty local staging folder."""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
NAME=re.compile(r"^[A-Za-z][A-Za-z0-9-]{1,39}$")
CHUNK=1024*1024
def command(*args):
    result=subprocess.run(args,check=True,capture_output=True,text=True,timeout=60)
    if len(result.stdout)>2_000_000:raise ValueError("command result exceeds limit")
    return result.stdout
def file_disks(xml):
    root=ET.fromstring(xml)
    disks=[]
    for disk in root.findall("./devices/disk"):
        if disk.attrib.get("device")!="disk" or disk.attrib.get("type")!="file":continue
        source=disk.find("source")
        value=source.attrib.get("file") if source is not None else None
        if value:disks.append(value)
    if not disks:raise ValueError("No eligible local file-backed disks")
    if len(disks)>32:raise ValueError("Too many attached disks")
    return disks
def validate_source(path,allowed_root):
    allowed=Path(allowed_root).resolve(strict=True)
    source=Path(path).resolve(strict=True)
    if allowed==source or allowed not in source.parents:raise ValueError("Disk outside approved root")
    st=os.lstat(path)
    if not os.path.isfile(path) or os.path.islink(path) or st.st_size<=0:
        raise ValueError("Disk is not a regular nonempty file")
    info=json.loads(command("qemu-img","info","--output=json",str(source)))
    if info.get("backing-filename") or info.get("full-backing-filename"):
        raise ValueError("External backing chain is not permitted")
    return source,st.st_size
def export_vm(name,allowed_root,output_parent):
    if not NAME.fullmatch(name):raise ValueError("Invalid VM name")
    if command("virsh","-c","qemu:///system","domstate",name).strip().lower() not in ("shut off","shutoff"):
        raise ValueError("VM must be shut off before exporting disks")
    disks=file_disks(command("virsh","-c","qemu:///system","dumpxml",name))
    output_parent=Path(output_parent).resolve(strict=True)
    if not output_parent.is_dir():raise ValueError("Invalid output directory")
    sources=[validate_source(path,allowed_root) for path in disks]
    for path,_ in sources:
        if output_parent==path.parent or output_parent in path.parents or path.parent in output_parent.parents:
            raise ValueError("Export destination overlaps VM source storage")
    final=output_parent/("export-"+name)
    if final.exists() or final.is_symlink():raise ValueError("Export already exists")
    temporary=output_parent/(".lightnas-export-"+uuid.uuid4().hex)
    temporary.mkdir(mode=0o700)
    results=[]
    try:
        for index,(disk,size) in enumerate(sources):
            filename=f"disk-{index}.img"
            copied=0
            digest=hashlib.sha256()
            with open(disk,"rb") as inp, open(temporary/filename,"xb") as out:
                while True:
                    data=inp.read(CHUNK)
                    if not data:break
                    copied+=len(data)
                    if copied>size:raise ValueError("Disk size changed while exporting")
                    digest.update(data)
                    out.write(data)
                out.flush()
                os.fsync(out.fileno())
            if copied!=size or os.stat(disk).st_size!=size:
                raise ValueError("Disk size changed while exporting")
            results.append({"file":filename,"bytes":size,"sha256":digest.hexdigest()})
        manifest={"source":"redhat","vm":name,"state":"exported-offline","disks":results,
                  "vmDefinitionImported":False,"bootTested":False}
        with open(temporary/"manifest.json","x",encoding="utf8") as output:
            json.dump(manifest,output,indent=2)
        temporary.rename(final)
        return manifest
    except BaseException:
        shutil.rmtree(temporary,ignore_errors=True)
        raise
if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--name",required=True)
    p.add_argument("--source-root",required=True)
    p.add_argument("--output-parent",required=True)
    args=p.parse_args()
    try:print(json.dumps(export_vm(args.name,args.source_root,args.output_parent)))
    except (OSError,ValueError,subprocess.SubprocessError,ET.ParseError) as error:
        print(json.dumps({"error":str(error)}),file=sys.stderr);sys.exit(1)
