#!/usr/bin/env python3
"""Validate ISO installer management networking and stage one NM profile on disk.

No changes are made to live networking. The installer calls --check before
erasing any disk and --target after the installed filesystem is mounted.
"""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import tempfile

IFACE = re.compile(r"^[A-Za-z0-9_.:-]{1,32}$")
MAC = re.compile(r"^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$")


def validate(data):
    if not isinstance(data, dict):
        raise ValueError("Network configuration must be an object")
    mode = data.get("mode", "dhcp")
    if mode not in ("dhcp", "static"):
        raise ValueError("Network mode must be DHCP or static")
    interface = data.get("interface", "")
    if not isinstance(interface, str) or (interface and not IFACE.fullmatch(interface)):
        raise ValueError("Invalid interface name")
    if mode == "static" and not interface:
        raise ValueError("Select an Ethernet interface for static IPv4")
    if interface and not (Path("/sys/class/net") / interface).is_dir():
        raise ValueError(f"Network interface {interface} is no longer present")
    mac = data.get("mac") or ""
    if not isinstance(mac, str) or (mac and not MAC.fullmatch(mac)):
        raise ValueError("Invalid MAC address")
    if interface == "lo":
        raise ValueError("Loopback cannot be a management network interface")
    if interface and (Path("/sys/class/net") / interface / "wireless").exists():
        raise ValueError("Use the Wi-Fi network setup tool for wireless connections; integrated IPv4 profiles currently support Ethernet")
    if interface and mac:
        current = (Path("/sys/class/net") / interface / "address").read_text().strip()
        if current.lower() != mac.lower():
            raise ValueError("Selected interface MAC has changed")
    address, gateway, dns = "", "", []
    if mode == "static":
        addr = ipaddress.ip_interface(data.get("address", ""))
        gw = ipaddress.ip_address(data.get("gateway", ""))
        if addr.version != 4 or gw.version != 4 or gw not in addr.network:
            raise ValueError("Static IPv4 gateway must be within the address subnet")
        if addr.ip == gw:
            raise ValueError("IP address cannot equal gateway")
        raw_dns = data.get("dns")
        if not isinstance(raw_dns, list) or not raw_dns:
            raise ValueError("Specify one or more DNS servers")
        dns = [str(ipaddress.IPv4Address(item)) for item in raw_dns]
        address, gateway = str(addr), str(gw)
    return {"mode": mode, "interface": interface, "mac": mac.lower(),
            "address": address, "gateway": gateway, "dns": dns}


def stage(data, target):
    settings = validate(data)
    if not settings["interface"]:
        print("No management NIC selected; NetworkManager auto-discovery remains enabled")
        return
    base = Path(target).resolve(strict=True)
    if not (base / "etc").is_dir():
        raise ValueError("Not an installed root filesystem")
    directory = base / "etc/NetworkManager/system-connections"
    directory.mkdir(parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    iface = settings["interface"]
    connection_id = f"lightnas-management-{iface}"
    lines = [
        "[connection]", f"id={connection_id}", "type=ethernet",
        f"interface-name={iface}", "autoconnect=true",
        "autoconnect-priority=100", "",
        "[ethernet]",
    ]
    if settings["mac"]:
        lines.append(f"mac-address={settings['mac']}")
    lines.extend(["", "[ipv4]", f"method={'auto' if settings['mode'] == 'dhcp' else 'manual'}"])
    if settings["mode"] == "static":
        lines.extend([
            f"address1={settings['address']},{settings['gateway']}",
            "dns=" + ";".join(settings["dns"]) + ";",
            "ignore-auto-dns=true",
        ])
    lines.extend(["", "[ipv6]", "method=auto", ""])
    # Atomic root-owned file. No user-supplied newlines or delimiters are allowed.
    fd, name = tempfile.mkstemp(dir=directory, prefix=".lightnas-nm-")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write("\n".join(lines))
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, directory / f"{connection_id}.nmconnection")
    finally:
        if os.path.exists(name):
            os.unlink(name)
    print(f"Staged {settings['mode']} configuration for {iface} in installed system")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--config", required=True)
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true")
    group.add_argument("--target")
    args = p.parse_args()
    path = Path(args.config)
    st = path.stat()
    if st.st_uid != 0 or st.st_mode & 0o077 or not path.is_file():
        p.error("Configuration file must be root-owned and private")
    try:
        with path.open(encoding="utf-8") as file:
            data = json.load(file)
        if args.check:
            validate(data)
            print("Network settings validated")
        else:
            stage(data, args.target)
    except (ValueError, OSError, KeyError, TypeError) as exc:
        p.error(str(exc))


if __name__ == "__main__":
    main()
