#!/usr/bin/env python3
"""Copy an exported TrueNAS dataset into new offline staging; no ACL/identity application."""
import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import uuid
from pathlib import Path

MAX_FILES=200000
MAX_BYTES=128*1024**3
CHUNK=1024*1024
NAME=re.compile(r"^[A-Za-z][A-Za-z0-9_-]{1,47}$")
def fail(reason): raise ValueError(reason)
def copy_dataset(source,parent,name):
    if not NAME.fullmatch(name): fail("invalid dataset destination name")
    source=Path(source)
    parent=Path(parent)
    if source.is_symlink() or not source.is_dir(): fail("source must be a real directory")
    if parent.is_symlink() or not parent.is_dir(): fail("target parent must be a real directory")
    if parent.resolve()==source.resolve() or source.resolve() in parent.resolve().parents or parent.resolve() in source.resolve().parents:
        fail("source and destination must not overlap")
    final=parent/name
    if final.exists() or final.is_symlink(): fail("target already exists")
    staging=parent/(".lightnas-dataset-"+uuid.uuid4().hex)
    staging.mkdir(mode=0o700)
    count=0
    size=0
    digest=hashlib.sha256()
    try:
        def visit(source_dir,target_dir,prefix=""):
            nonlocal count,size
            with os.scandir(source_dir) as iterator:
                for entry in iterator:
                    count+=1
                    if count>MAX_FILES: fail("dataset entry count exceeded")
                    info=entry.stat(follow_symlinks=False)
                    rel=prefix+entry.name
                    if stat.S_ISDIR(info.st_mode):
                        newdir=target_dir/entry.name
                        newdir.mkdir(mode=0o700)
                        visit(entry.path,newdir,rel+"/")
                    elif stat.S_ISREG(info.st_mode):
                        size+=info.st_size
                        if size>MAX_BYTES: fail("dataset size limit exceeded")
                        source_fd=os.open(entry.path,os.O_RDONLY|os.O_NOFOLLOW)
                        target_fd=os.open(target_dir/entry.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                        filehash=hashlib.sha256()
                        try:
                            while True:
                                block=os.read(source_fd,CHUNK)
                                if not block: break
                                filehash.update(block)
                                view=memoryview(block)
                                while view:
                                    n=os.write(target_fd,view)
                                    if n<=0: fail("short write")
                                    view=view[n:]
                            os.fsync(target_fd)
                            if os.fstat(source_fd).st_size!=info.st_size:fail("source changed during copy")
                        finally:
                            os.close(source_fd)
                            os.close(target_fd)
                        digest.update(rel.encode("utf-8")+b"\\0"+filehash.digest())
                    else:fail("dataset contains link or unsupported special object")
        visit(source,staging)
        os.rename(staging,final)
        return {"phase":"dataset-staged-offline","filesAndDirectories":count,
                "bytesCopied":size,"manifestSha256":digest.hexdigest(),
                "aclRestored":False,"identitiesRestored":False,"sharesCreated":False}
    except BaseException:
        shutil.rmtree(staging,ignore_errors=True)
        raise

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--source",required=True)
    p.add_argument("--destination-parent",required=True)
    p.add_argument("--name",required=True)
    args=p.parse_args()
    try: print(json.dumps(copy_dataset(args.source,args.destination_parent,args.name)))
    except (OSError,ValueError) as e:
        print(json.dumps({"error":str(e)}),file=sys.stderr);sys.exit(1)
