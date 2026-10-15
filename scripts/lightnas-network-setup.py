#!/usr/bin/env python3
"""LightNAS ISO network discovery and optional NetworkManager configuration.

Read-only by default; no gateway/DNS values are invented.
"""
import argparse
import ipaddress
import json
import re
import subprocess
import sys

NIC_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,32}$")
LABEL_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")


def run(*args):
    p = subprocess.run(args, text=True, stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, timeout=20, check=False)
    return p.stdout.strip() if p.returncode == 0 else ""


def valid_fqdn(name):
    if not name or len(name) > 253 or ".." in name:
        return False
    labels = name.rstrip(".").split(".")
    return bool(labels) and all(LABEL_RE.fullmatch(label) for label in labels)


def discover():
    links = json.loads(run("ip", "-j", "link", "show") or "[]")
    addresses = json.loads(run("ip", "-j", "-4", "addr", "show") or "[]")
    routes = json.loads(run("ip", "-j", "-4", "route", "show", "default") or "[]")
    addrmap = {x.get("ifname"): [f"{a['local']}/{a['prefixlen']}"
        for a in x.get("addr_info", []) if a.get("family") == "inet"]
        for x in addresses}
    route_by_dev = {r.get("dev"): r.get("gateway") for r in routes if r.get("dev")}
    dns_by_dev = {}
    for link in links:
        name = link.get("ifname", "")
        if not NIC_RE.fullmatch(name) or name == "lo":
            continue
        output = run("nmcli", "-g", "IP4.DNS", "device", "show", name)
        dns_by_dev[name] = [x.strip() for x in output.splitlines() if x.strip()]
    nics = []
    for link in links:
        name = link.get("ifname", "")
        if not NIC_RE.fullmatch(name) or name == "lo":
            continue
        nm_type = run("nmcli", "-g", "GENERAL.TYPE", "device", "show", name)
        if nm_type not in ("ethernet", "wifi"):
            continue
        nics.append({"name": name, "type": nm_type,
                     "mac": link.get("address"), "state": link.get("operstate"),
                     "addresses": addrmap.get(name, []),
                     "gateway": route_by_dev.get(name),
                     "dns": dns_by_dev.get(name, [])})
    wifi = []
    if any(n["type"] == "wifi" for n in nics):
        # \\ escapes SSID colons in terse mode; a plain SSID list avoids
        # treating arbitrary SSID content as shell syntax.
        wifi = sorted(set(run("nmcli", "-t", "-f", "SSID", "device",
                              "wifi", "list", "--rescan", "yes").splitlines()) - {""})
    return {"hostname": run("hostname", "-f") or run("hostname"),
            "interfaces": nics, "wifi_ssids": wifi}


def configure(args):
    if not NIC_RE.fullmatch(args.interface):
        raise ValueError("Invalid network interface")
    snapshot = discover()
    selected = next((n for n in snapshot["interfaces"]
                     if n["name"] == args.interface), None)
    if not selected:
        raise ValueError("Select a detected Ethernet or Wi-Fi interface")
    if args.fqdn and not valid_fqdn(args.fqdn):
        raise ValueError("Invalid FQDN: labels allow letters, numbers, and interior hyphens; dots separate labels")
    if selected["type"] == "wifi" and not args.ssid:
        raise ValueError("Wi-Fi requires --ssid and authentication using nmcli")
    if selected["type"] != "wifi" and args.ssid:
        raise ValueError("--ssid is only supported for Wi-Fi")
    if args.method == "static":
        if not args.address or not args.gateway or not args.dns:
            raise ValueError("Static mode requires --address, --gateway and --dns")
        iface = ipaddress.ip_interface(args.address)
        gateway = ipaddress.ip_address(args.gateway)
        if gateway.version != iface.version or gateway not in iface.network:
            raise ValueError("Gateway must be on the configured address subnet")
        for server in args.dns:
            ipaddress.ip_address(server)
    elif args.address or args.gateway or args.dns:
        raise ValueError("Address, gateway and DNS overrides require --method static")
    if args.fqdn:
        # Validate before making any modifications.
        result = subprocess.run(["hostnamectl", "set-hostname", args.fqdn],
                                check=False)
        if result.returncode:
            raise RuntimeError("Could not set hostname")
    if selected["type"] == "wifi" and not args.wifi_password_file:
        # Keep the existing text-console credential prompt unchanged.
        cmd = ["nmcli", "--ask", "device", "wifi", "connect", args.ssid,
               "ifname", args.interface]
        if subprocess.run(cmd, check=False).returncode:
            raise RuntimeError("Wi-Fi authentication/association failed")
    if args.wifi_password_file:
        import os
        info = os.stat(args.wifi_password_file)
        if info.st_uid != 0 or (info.st_mode & 0o077):
            raise ValueError("Wi-Fi secret file must be root-owned and mode 0600")
        if selected["type"] != "wifi":
            raise ValueError("Wi-Fi secret provided for a non-wireless interface")
    profile = run("nmcli", "-g", "GENERAL.CONNECTION", "device",
                  "show", args.interface)
    if not profile or profile == "--":
        profile = "lightnas-auto-" + args.interface
        cmd = ["nmcli", "connection", "add", "type",
               "wifi" if selected["type"] == "wifi" else "ethernet",
               "ifname", args.interface, "con-name", profile]
        if selected["type"] == "wifi":
            cmd += ["ssid", args.ssid]
        if subprocess.run(cmd, check=False).returncode:
            raise RuntimeError("Could not create network connection profile")
    cmd = ["nmcli", "connection", "modify", profile,
           "connection.autoconnect", "yes", "ipv4.method",
           "auto" if args.method == "dhcp" else "manual"]
    if args.method == "static":
        cmd += ["ipv4.addresses", args.address, "ipv4.gateway", args.gateway,
                "ipv4.dns", ",".join(args.dns)]
    else:
        cmd += ["ipv4.addresses", "", "ipv4.gateway", "", "ipv4.dns", ""]
    if subprocess.run(cmd, check=False).returncode:
        raise RuntimeError("Could not configure connection")
    if args.wifi_password_file:
        # NM reads the secret from a root-only file; no password appears in argv.
        if subprocess.run(["nmcli", "connection", "modify", profile,
                           "802-11-wireless.ssid", args.ssid,
                           "802-11-wireless-security.key-mgmt", "wpa-psk"],
                          check=False).returncode:
            raise RuntimeError("Could not configure Wi-Fi authentication")
        activate = ["nmcli", "connection", "up", profile,
                    "passwd-file", args.wifi_password_file]
    else:
        activate = ["nmcli", "connection", "up", profile]
    if subprocess.run(activate, check=False).returncode:
        raise RuntimeError("Connection activation failed")
    return discover()


def main():
    parser = argparse.ArgumentParser(description="LightNAS network discovery and configuration")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--apply", action="store_true", help="Explicitly apply network changes")
    parser.add_argument("--interface")
    parser.add_argument("--method", choices=("dhcp", "static"), default="dhcp")
    parser.add_argument("--address", help="Static CIDR, e.g. 192.168.1.15/24")
    parser.add_argument("--gateway")
    parser.add_argument("--dns", nargs="+")
    parser.add_argument("--fqdn", help="Hostname or FQDN; hyphens and dots are valid")
    parser.add_argument("--ssid", help="Wi-Fi network name")
    parser.add_argument("--wifi-password-file", help="Root-only NetworkManager passwd-file for WPA-PSK")
    args = parser.parse_args()
    if args.apply:
        if not args.interface:
            parser.error("--apply requires --interface")
        if hasattr(__import__("os"), "geteuid") and __import__("os").geteuid() != 0:
            parser.error("--apply must run as root")
        try:
            result = configure(args)
        except (ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
            parser.error(str(exc))
    else:
        result = discover()
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print("LightNAS network discovery")
        print("Hostname:", result["hostname"])
        for nic in result["interfaces"]:
            print(f"  {nic['name']} ({nic['type']}) {nic['state']}  IP: {', '.join(nic['addresses']) or 'DHCP pending'}")
            print(f"    Gateway: {nic['gateway'] or 'not assigned'}  DNS: {', '.join(nic['dns']) or 'not assigned'}")
        if result["wifi_ssids"]:
            print("Wi-Fi SSIDs:", ", ".join(result["wifi_ssids"]))


if __name__ == "__main__":
    main()
