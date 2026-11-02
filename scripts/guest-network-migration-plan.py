#!/usr/bin/env python3
"""Read-only inventory of legacy guest networks; never applies a migration.

This is planning groundwork, NOT an approval, executable migration or rollback
implementation. A host-owned transaction protocol is required before cutover.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

LEGACY_LINKS = frozenset({"lightnas0", "lxcbr0", "virbr0"})
LINK_RE = re.compile(r"^\s*lxc\.net\.(\d+)\.link\s*=\s*(\S+)", re.MULTILINE)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def lxc_targets(root, mode, bridge, parent):
    """Read legacy LXC configs without following a config-file symlink."""
    candidates = []
    for path in sorted(Path(root).glob("*/config")):
        if path.is_symlink():
            raise ValueError(f"Refusing symlinked LXC configuration: {path}")
        if not path.is_file():
            continue
        original = path.read_bytes()
        content = original.decode("utf-8")
        for index, link in LINK_RE.findall(content):
            if link not in LEGACY_LINKS:
                continue
            if mode == "bridge":
                target = {"type": "veth", "link": bridge}
            elif mode in {"nested-macvlan", "nested-ipvlan"}:
                target = {"type": mode.removeprefix("nested-"), "link": parent}
            else:
                continue
            if link == target["link"]:
                continue
            candidates.append({
                "kind": "lxc",
                "name": path.parent.name,
                "networkIndex": int(index),
                "previousLink": link,
                "proposedTarget": target,
                "sourceSha256": sha256(original),
                "configurationPath": str(path),
                "requiresGuestStateSnapshot": True,
                "requiresConnectivityRollback": True,
            })
    return candidates


def virsh_read(*args):
    """Only read-only virsh commands are permitted."""
    if not args or args[0] not in {"list", "dumpxml", "domstate"}:
        raise ValueError("Only read-only libvirt inventory commands are supported")
    completed = subprocess.run(
        ["virsh", "-c", "qemu:///system", *args],
        text=True, capture_output=True, check=True, timeout=30
    )
    return completed.stdout


def libvirt_targets(mode):
    """Read-only enumeration. Do not stop, define, destroy or restart any VM."""
    candidates = []
    names = [name.strip() for name in virsh_read("list", "--all", "--name").splitlines() if name.strip()]
    for name in sorted(names):
        original = virsh_read("dumpxml", "--inactive", name)
        state = virsh_read("domstate", name).strip()
        root = ET.fromstring(original)
        for index, interface in enumerate(root.findall("./devices/interface")):
            source = interface.find("source")
            if interface.get("type") != "bridge" or source is None:
                continue
            if source.get("bridge") != "virbr0" or mode != "lxc-nat":
                continue
            candidates.append({
                "kind": "libvirt",
                "name": name,
                "interfaceIndex": index,
                "previousBridge": "virbr0",
                "proposedTarget": {"type": "network", "name": "default"},
                "sourceSha256": sha256(original.encode("utf-8")),
                "observedState": state,
                "requiresGuestStateSnapshot": True,
                "requiresConnectivityRollback": True,
            })
    return candidates


def build_plan(root, mode, bridge, parent, inspect_virsh=False):
    if mode in {"nested-macvlan", "nested-ipvlan"} and not parent:
        raise ValueError("Nested network plans require --parent")
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,32}", bridge):
        raise ValueError("Invalid bridge name")
    if parent and not re.fullmatch(r"[A-Za-z0-9_.:-]{1,32}", parent):
        raise ValueError("Invalid parent name")
    guests = lxc_targets(root, mode, bridge, parent)
    vms = libvirt_targets(mode) if inspect_virsh else []
    source = {
        "schemaVersion": 1,
        "mode": mode,
        "bridge": bridge,
        "parent": parent or None,
        "lxcCandidates": guests,
        "libvirtCandidates": vms,
        "libvirtInventory": "complete" if inspect_virsh else "not-inspected",
    }
    return {
        **source,
        "planSha256": sha256(json.dumps(source, sort_keys=True, separators=(",", ":")).encode()),
        "readOnly": True,
        "approved": False,
        "executable": False,
        "warning": "Inventory only. Guest state, ownership, approval, safe shutdown and rollback are NOT verified.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lxc-root", default="/var/lib/lxc")
    parser.add_argument("--mode", required=True, choices=["bridge", "nested-macvlan", "nested-ipvlan", "lxc-nat"])
    parser.add_argument("--bridge", default="virbr0")
    parser.add_argument("--parent", default="")
    parser.add_argument("--inspect-virsh", action="store_true", help="query libvirt read-only; fails on libvirt errors")
    args = parser.parse_args()
    try:
        plan = build_plan(args.lxc_root, args.mode, args.bridge, args.parent, args.inspect_virsh)
    except (OSError, UnicodeError, ValueError, ET.ParseError, subprocess.SubprocessError) as exc:
        print(f"Migration inventory failed closed: {exc}", file=sys.stderr)
        return 2
    json.dump(plan, sys.stdout, indent=2, sort_keys=True)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
