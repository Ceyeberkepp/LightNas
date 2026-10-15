#!/usr/bin/env python3
"""LightNAS live installer hub. Read-only inventory; installation delegated to Debian Installer."""
import json
import os
import shutil
import subprocess
import sys
import tkinter as tk
from tkinter import messagebox, ttk

HERE = os.path.dirname(os.path.abspath(__file__))
NETWORK = os.path.join(HERE, "lightnas-network-gui.py")
THEME = {"background": "#15191d", "foreground": "#edf7f4",
         "accent": "#00b83f", "panel": "#252d32"}


def command(*args):
    try:
        p = subprocess.run(args, text=True, capture_output=True, timeout=15, check=False)
        return p.stdout if p.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def disks():
    try:
        raw = json.loads(command("lsblk", "-J", "-b", "-o",
                                 "NAME,PATH,SIZE,MODEL,TYPE,TRAN,RO,RM,MOUNTPOINTS") or "{}")
    except ValueError:
        return []
    return [dev for dev in raw.get("blockdevices", [])
            if dev.get("type") == "disk"]


class Hub:
    def __init__(self, root):
        self.root = root
        root.title("LightNAS | Installation")
        root.geometry("860x640")
        root.minsize(720, 540)
        root.configure(bg=THEME["background"])
        frame = tk.Frame(root, bg=THEME["background"], padx=30, pady=28)
        frame.pack(fill="both", expand=True)
        tk.Label(frame, text="LightNAS", fg=THEME["accent"],
                 bg=THEME["background"], font=("Sans", 30, "bold")).pack(anchor="w")
        tk.Label(frame, text="Install your full-featured NAS and virtualization platform",
                 fg=THEME["foreground"], bg=THEME["background"],
                 font=("Sans", 13)).pack(anchor="w", pady=(0, 18))
        ttk.Label(frame, text="Detected storage (view-only; no disk is selected automatically)").pack(anchor="w")
        self.disk_text = tk.Text(frame, height=10, bg=THEME["panel"],
                                 fg=THEME["foreground"], font=("Monospace", 11))
        self.disk_text.pack(fill="both", expand=True, pady=8)
        ttk.Label(frame, text="Networking").pack(anchor="w", pady=(12, 0))
        self.net_text = tk.Text(frame, height=5, bg=THEME["panel"],
                                fg=THEME["foreground"], font=("Monospace", 10))
        self.net_text.pack(fill="x", pady=8)
        controls = ttk.Frame(frame)
        controls.pack(fill="x", pady=12)
        ttk.Button(controls, text="Refresh hardware", command=self.refresh).pack(side="left", padx=(0, 8))
        ttk.Button(controls, text="Configure network", command=self.network).pack(side="left")
        ttk.Button(controls, text="Continue to disk installer", command=self.install).pack(side="right")
        self.refresh()

    def refresh(self):
        disk_lines = []
        for item in disks():
            size = int(item.get("size") or 0)
            detail = "read-only" if item.get("ro") else "removable" if item.get("rm") else "fixed"
            disk_lines.append(f"{item.get('path') or item.get('name')}  {size / 10**9:.1f} GB  {item.get('model') or ''}  ({detail})")
        if not disk_lines:
            disk_lines = ["No disks detected. Check controller drivers and storage cabling."]
        self._replace(self.disk_text, "\n".join(disk_lines))
        net_lines = []
        try:
            result = subprocess.run([sys.executable, os.path.join(HERE, "lightnas-network-setup.py"), "--json"],
                                    text=True, capture_output=True, timeout=40, check=True)
            data = json.loads(result.stdout)
            net_lines.append("Hostname: " + (data.get("hostname") or "not assigned"))
            for adapter in data.get("interfaces", []):
                net_lines.append(f"{adapter['name']} ({adapter['type']})  IP: {', '.join(adapter.get('addresses') or []) or 'DHCP pending'}")
                net_lines.append(f"  Gateway: {adapter.get('gateway') or 'none'} | DNS: {', '.join(adapter.get('dns') or []) or 'none'}")
        except (OSError, ValueError, subprocess.SubprocessError):
            net_lines = ["Network discovery unavailable; check NIC firmware."]
        self._replace(self.net_text, "\n".join(net_lines))

    @staticmethod
    def _replace(widget, value):
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.insert("1.0", value)
        widget.configure(state="disabled")

    def network(self):
        if not os.path.isfile(NETWORK):
            messagebox.showerror("LightNAS", "Network setup was not bundled.")
            return
        subprocess.Popen([sys.executable, NETWORK], close_fds=True)

    def install(self):
        launcher = shutil.which("debian-installer-launcher")
        if not launcher:
            messagebox.showinfo("Installer boot option",
                                "This session does not provide the live installer launcher. "
                                "Reboot and select Install LightNAS (Graphical) from the ISO boot menu. "
                                "The installer will ask you to select and confirm the target disk.")
            return
        if not messagebox.askyesno("Start LightNAS installation",
                                   "Open the Debian graphical disk installer? "
                                   "No disk will be formatted until you choose a target and confirm its changes."):
            return
        subprocess.Popen([launcher], close_fds=True)


if __name__ == "__main__":
    root = tk.Tk()
    theme = ttk.Style()
    if "clam" in theme.theme_names():
        theme.theme_use("clam")
    Hub(root)
    root.mainloop()
