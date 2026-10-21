#!/usr/bin/env python3
"""LightNAS native graphical installation and network wizard."""
import json
import os
import shutil
import subprocess
import sys
import tkinter as tk
from tkinter import messagebox, ttk

HERE = os.path.dirname(os.path.abspath(__file__))
NETWORK = os.path.join(HERE, "lightnas-network-gui.py")
THEME = {"background": "#07101d", "foreground": "#f1f7fb",
         "accent": "#00b83f", "panel": "#0d1928", "muted": "#90a3b7"}


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
        style = ttk.Style(root)
        if "clam" in style.theme_names():
            style.theme_use("clam")
        style.configure(".", background=THEME["background"],
                        foreground=THEME["foreground"], font=("Sans", 11))
        style.configure("TFrame", background=THEME["background"])
        style.configure("TLabel", background=THEME["background"],
                        foreground=THEME["foreground"])
        style.configure("TButton", background=THEME["panel"],
                        foreground=THEME["foreground"], padding=(14, 10),
                        borderwidth=1)
        style.map("TButton", background=[("active", THEME["accent"])],
                  foreground=[("active", THEME["background"])])
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
        from tkinter import simpledialog
        if os.geteuid() != 0:
            messagebox.showerror("LightNAS", "Installation requires administrator access.")
            return
        candidates = [d for d in disks() if not d.get("ro") and
                      int(d.get("size") or 0) >= 37580963840]
        if not candidates:
            messagebox.showerror("LightNAS", "No writable installation disks of at least 35 GiB were found.")
            return
        labels = [f"{d.get('path')} - {int(d.get('size') or 0)/10**9:.1f} GB - {d.get('model') or 'Disk'}"
                  for d in candidates]
        chooser = tk.Toplevel(self.root)
        chooser.title("Select LightNAS destination disk")
        chooser.geometry("750x230")
        chooser.configure(bg=THEME["background"])
        tk.Label(chooser, text="All data on the selected disk will be permanently erased.",
                 bg=THEME["background"], fg=THEME["foreground"]).pack(pady=16)
        chosen = tk.StringVar(value=labels[0])
        combo = ttk.Combobox(chooser, state="readonly", textvariable=chosen, values=labels, width=85)
        combo.pack(pady=10)

        def confirm():
            index = labels.index(chosen.get())
            target = candidates[index].get("path")
            if not target or not target.startswith("/dev/"):
                messagebox.showerror("LightNAS", "Invalid installation disk.", parent=chooser)
                return
            if not messagebox.askyesno("Erase selected disk?",
                    f"Erase ALL files and partitions on {target}? This is irreversible.",
                    parent=chooser):
                return
            typed = simpledialog.askstring("Final confirmation",
                    f"Type ERASE:{target} exactly to confirm.", parent=chooser)
            if typed != f"ERASE:{target}":
                messagebox.showwarning("LightNAS", "Installation was cancelled.", parent=chooser)
                return
            chooser.destroy()
            self.root.update_idletasks()
            try:
                proc = subprocess.run(
                    ["/bin/bash", os.path.join(HERE, "lightnas-native-install.sh"), target],
                    env={**os.environ, "LIGHTNAS_ERASE_CONFIRM": typed},
                    capture_output=True, text=True, timeout=3600)
                if proc.returncode != 0:
                    messagebox.showerror("LightNAS install failed",
                                         (proc.stderr + "\n" + proc.stdout)[-1800:])
                    return
                messagebox.showinfo("LightNAS", "Installation completed. Remove the ISO and reboot.")
                self.root.destroy()
            except (OSError, subprocess.TimeoutExpired) as exc:
                messagebox.showerror("LightNAS", str(exc))

        ttk.Button(chooser, text="Review and install", command=confirm).pack(pady=12)


if __name__ == "__main__":
    root = tk.Tk()
    theme = ttk.Style()
    if "clam" in theme.theme_names():
        theme.theme_use("clam")
    Hub(root)
    root.mainloop()
