#!/usr/bin/env python3
"""LightNAS graphical network setup (root console, no disk writes).

Run from graphical appliance console with:
  sudo -E python3 /opt/lightnas/scripts/lightnas-network-gui.py
Uses the same validated network engine as the text installer.
"""
import ipaddress
import json
import os
import subprocess
import sys
import tempfile
import tkinter as tk
from tkinter import messagebox, ttk

BASE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(BASE, "lightnas-network-setup.py")
COLORS = {"bg": "#15191d", "panel": "#252d32", "fg": "#f4fbff", "accent": "#00b83f"}


def discover():
    p = subprocess.run([sys.executable, ENGINE, "--json"], check=True,
                       text=True, stdout=subprocess.PIPE, timeout=60)
    return json.loads(p.stdout)


class Wizard:
    def __init__(self, root):
        self.root = root
        root.title("LightNAS | Network Configuration")
        root.geometry("780x675")
        root.minsize(670, 610)
        root.configure(bg=COLORS["bg"])
        self.frame = tk.Frame(root, bg=COLORS["bg"], padx=28, pady=20)
        self.frame.pack(fill="both", expand=True)
        self.header = tk.Label(self.frame, text="LightNAS", font=("Sans", 26, "bold"),
                               fg=COLORS["accent"], bg=COLORS["bg"])
        self.header.pack(anchor="w")
        tk.Label(self.frame, text="Network & hostname setup",
                 font=("Sans", 15), fg=COLORS["fg"], bg=COLORS["bg"]).pack(anchor="w")
        self.status = tk.StringVar(value="Detecting network adapters…")
        tk.Label(self.frame, textvariable=self.status, fg=COLORS["accent"],
                 bg=COLORS["bg"]).pack(anchor="w", pady=(5, 10))
        self.data = {}
        self.nic = tk.StringVar()
        self.method = tk.StringVar(value="dhcp")
        self.address = tk.StringVar()
        self.gateway = tk.StringVar()
        self.dns = tk.StringVar()
        self.fqdn = tk.StringVar()
        self.ssid = tk.StringVar()
        self.wifi_password = tk.StringVar()
        self.row = tk.Frame(self.frame, bg=COLORS["bg"])
        self.row.pack(fill="both", expand=True)
        self.controls()
        self.refresh()

    def field(self, label, variable):
        ttk.Label(self.row, text=label).pack(anchor="w", pady=(8, 1))
        entry = ttk.Entry(self.row, textvariable=variable, width=68)
        entry.pack(fill="x")
        return entry

    def controls(self):
        ttk.Label(self.row, text="Physical network adapter").pack(anchor="w")
        self.adapters = ttk.Combobox(self.row, state="readonly", textvariable=self.nic)
        self.adapters.pack(fill="x")
        self.adapters.bind("<<ComboboxSelected>>", self.populate)
        ttk.Label(self.row, text="IPv4 mode").pack(anchor="w", pady=(10, 0))
        modes = ttk.Frame(self.row)
        modes.pack(fill="x")
        for label, value in (("Automatic DHCP", "dhcp"), ("Static IPv4", "static")):
            ttk.Radiobutton(modes, text=label, value=value, variable=self.method,
                            command=self.toggle).pack(side="left", padx=(0, 25))
        self.address_entry = self.field("IPv4 address / prefix", self.address)
        self.gateway_entry = self.field("Default gateway", self.gateway)
        self.dns_entry = self.field("DNS servers (space separated)", self.dns)
        ttk.Label(self.row, text="Wi-Fi network (choose a visible SSID)").pack(anchor="w", pady=(8, 0))
        self.wifi = ttk.Combobox(self.row, textvariable=self.ssid)
        self.wifi.pack(fill="x")
        ttk.Label(self.row, text="Wi-Fi password (WPA/WPA2 Personal)").pack(anchor="w", pady=(8, 0))
        self.password_entry = ttk.Entry(self.row, textvariable=self.wifi_password, show="*")
        self.password_entry.pack(fill="x")
        self.field("Hostname / FQDN (hyphens and dots allowed)", self.fqdn)
        self.summary = tk.Text(self.row, width=76, height=5, bg=COLORS["panel"],
                               fg=COLORS["fg"], font=("Monospace", 10), state="disabled")
        self.summary.pack(fill="x", pady=(12, 3))
        buttons = ttk.Frame(self.row)
        buttons.pack(fill="x", pady=8)
        ttk.Button(buttons, text="Rescan adapters", command=self.refresh).pack(side="left")
        ttk.Button(buttons, text="Search nearby Wi-Fi", command=self.scan_wifi).pack(side="left", padx=8)
        ttk.Button(buttons, text="Connect & Continue", command=self.apply).pack(side="right")
        self.toggle()

    def toggle(self):
        enabled = "normal" if self.method.get() == "static" else "disabled"
        for widget in (self.address_entry, self.gateway_entry, self.dns_entry):
            widget.configure(state=enabled)

    def refresh(self):
        try:
            self.data = discover()
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            messagebox.showerror("Discovery failed", str(exc))
            self.status.set("Unable to enumerate NICs")
            return
        nics = self.data.get("interfaces", [])
        self.adapters["values"] = [n["name"] for n in nics]
        self.wifi["values"] = []
        self.fqdn.set(self.data.get("hostname") or "")
        if nics:
            current = self.nic.get()
            self.nic.set(current if any(n["name"] == current for n in nics) else nics[0]["name"])
            self.populate()
        else:
            self.status.set("No managed Ethernet/Wi-Fi NICs; check drivers or firmware")

    def populate(self, *_):
        selected = next((x for x in self.data.get("interfaces", [])
                         if x["name"] == self.nic.get()), None)
        if not selected:
            return
        self.address.set((selected.get("addresses") or [""])[0])
        self.gateway.set(selected.get("gateway") or "")
        self.dns.set(" ".join(selected.get("dns") or []))
        is_wifi = selected.get("type") == "wifi"
        self.wifi.configure(state="normal" if is_wifi else "disabled")
        self.password_entry.configure(state="normal" if is_wifi else "disabled")
        self.wifi_password.set("")
        self.ssid.set("")
        self.status.set(f"{selected['name']} • {selected['type']} • {selected.get('state') or 'unknown'}")
        if is_wifi:
            self.scan_wifi()
        lines = [
            f"Adapter: {selected['name']} ({selected['type']})",
            f"IP: {self.address.get() or 'Unassigned / DHCP pending'}",
            f"Gateway: {self.gateway.get() or 'Not supplied'}",
            f"DNS: {self.dns.get() or 'Not supplied'}",
        ]
        self.summary.configure(state="normal")
        self.summary.delete("1.0", "end")
        self.summary.insert("1.0", "\n".join(lines))
        self.summary.configure(state="disabled")

    def scan_wifi(self):
        """Scan the SELECTED wireless NIC, not all nearby NICs combined."""
        selected = next((n for n in self.data.get("interfaces", [])
                         if n["name"] == self.nic.get()), None)
        if not selected or selected["type"] != "wifi":
            self.wifi["values"] = []
            return
        self.status.set("Searching nearby Wi-Fi networks…")
        self.root.update_idletasks()
        try:
            scan = subprocess.run(["nmcli", "-g", "SSID", "device", "wifi",
                                   "list", "ifname", selected["name"],
                                   "--rescan", "yes"], text=True,
                                  capture_output=True, timeout=35)
            if scan.returncode:
                raise RuntimeError(scan.stderr.strip() or "Wi-Fi scan failed")
            networks = sorted(set(x.strip() for x in scan.stdout.splitlines() if x.strip()))
            self.wifi["values"] = networks
            self.status.set(f"Found {len(networks)} visible Wi-Fi networks on {selected['name']}")
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
            self.status.set("Wi-Fi scan unavailable")
            messagebox.showwarning("Wi-Fi discovery", str(exc))

    def apply(self):
        if os.geteuid() != 0:
            messagebox.showerror("Administrator access required",
                                 "Run this wizard with sudo from the local appliance console.")
            return
        iface = self.nic.get()
        nic = next((n for n in self.data.get("interfaces", []) if n["name"] == iface), None)
        if not nic:
            messagebox.showerror("NIC", "Select a detected interface.")
            return
        args = [sys.executable, ENGINE, "--apply", "--interface", iface, "--method", self.method.get()]
        if self.method.get() == "static":
            try:
                address = ipaddress.ip_interface(self.address.get())
                gw = ipaddress.ip_address(self.gateway.get())
                dns = self.dns.get().split()
                if address.version != 4 or gw not in address.network or not dns:
                    raise ValueError("IPv4 gateway/subnet or DNS is invalid")
                for server in dns:
                    if ipaddress.ip_address(server).version != 4:
                        raise ValueError("Enter IPv4 DNS server addresses")
            except ValueError as exc:
                messagebox.showerror("Invalid network settings", str(exc))
                return
            args += ["--address", self.address.get(), "--gateway", self.gateway.get(), "--dns", *dns]
        fqdn = self.fqdn.get().strip()
        if fqdn:
            args += ["--fqdn", fqdn]
        if nic["type"] == "wifi":
            ssid = self.ssid.get().strip()
            password = self.wifi_password.get()
            if not ssid or len(password) < 8 or len(password) > 63 or "\n" in ssid:
                messagebox.showerror("Wi-Fi", "Choose an SSID and enter a WPA Personal password (8–63 characters).")
                return
            args += ["--ssid", ssid]
        review = f"Adapter: {iface}\nMode: {self.method.get()}\nHostname: {fqdn or 'unchanged'}"
        if self.method.get() == "static":
            review += f"\nIP: {self.address.get()}\nGateway: {self.gateway.get()}\nDNS: {self.dns.get()}"
        if not messagebox.askyesno("Apply LightNAS network settings",
                                   review + "\n\nApplying can disconnect active connections. Continue?"):
            return
        secret_path = None
        try:
            if nic["type"] == "wifi":
                # NetworkManager consumes a private file, not a password on argv.
                fd, secret_path = tempfile.mkstemp(prefix="lightnas-nm-", dir="/run")
                with os.fdopen(fd, "w", encoding="utf-8") as file:
                    file.write("802-11-wireless-security.psk:" + password + "\n")
                os.chmod(secret_path, 0o600)
                args += ["--wifi-password-file", secret_path]
            result = subprocess.run(args, text=True, capture_output=True, timeout=150)
            if result.returncode:
                raise RuntimeError((result.stderr or result.stdout)[-1200:])
            self.wifi_password.set("")
            self.refresh()
            messagebox.showinfo("Network connected", "NetworkManager activated the selected connection. Continue the LightNAS installation.")
            self.root.destroy()
        except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
            messagebox.showerror("Network activation failed", str(exc))
        finally:
            if secret_path:
                os.unlink(secret_path)


if __name__ == "__main__":
    window = tk.Tk()
    style = ttk.Style()
    if "clam" in style.theme_names():
        style.theme_use("clam")
    style.configure(".", font=("Sans", 11))
    Wizard(window)
    window.mainloop()
