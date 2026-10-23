#!/usr/bin/env python3
"""Export local Red Hat libvirt and Podman inventory without secrets or VM disks."""
import argparse
import json
import re
import subprocess
import sys
NAME=re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,119}$")
ID=re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$")
def command(args):
    p=subprocess.run(args,capture_output=True,text=True,timeout=25,check=True)
    if len(p.stdout)>2_000_000: raise ValueError("inventory output too large")
    return p.stdout
def collect():
    vms=[]
    containers=[]
    warnings=[]
    try:
        names=command(["virsh","-c","qemu:///system","list","--all","--name"]).splitlines()
        for name in names:
            if not name: continue
            if not NAME.fullmatch(name): raise ValueError("invalid libvirt name")
            vms.append({"id":name,"name":name})
    except (OSError,subprocess.SubprocessError) as exc:
        warnings.append("libvirt inventory unavailable")
    try:
        records=json.loads(command(["podman","ps","--all","--format","json"]))
        if not isinstance(records,list): raise ValueError("invalid Podman response")
        for record in records:
            if not isinstance(record,dict): raise ValueError("invalid Podman record")
            ident=str(record.get("Id",""))
            names=record.get("Names",[])
            name=names[0] if isinstance(names,list) and names else (names if isinstance(names,str) else "")
            if not ID.fullmatch(ident) or not NAME.fullmatch(name): raise ValueError("invalid Podman identity")
            containers.append({"id":ident,"name":name})
    except (OSError,subprocess.SubprocessError,ValueError,KeyError):
        warnings.append("Podman inventory unavailable or invalid")
    if len(vms)+len(containers)>2000: raise ValueError("inventory limit exceeded")
    return {"source":"redhat","vms":vms,"containers":containers,"warnings":warnings,
            "exportState":"inventory-only","imagesExported":False,"secretsExported":False}
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",required=True)
    args=parser.parse_args()
    data=collect()
    with open(args.output,"x",encoding="utf-8") as file:
        json.dump(data,file,indent=2)
        file.write("\n")
    print(json.dumps({"output":args.output,"vms":len(data["vms"]),"containers":len(data["containers"])}))
if __name__=="__main__":
    try: main()
    except (OSError,ValueError,subprocess.SubprocessError) as exc:
        print(str(exc),file=sys.stderr);sys.exit(1)
