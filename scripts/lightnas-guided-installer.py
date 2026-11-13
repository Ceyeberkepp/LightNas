#!/usr/bin/env python3
"""Branded, keyboard-accessible LightNAS ISO installation wizard.

No target disk is preselected. The destructive install is delegated to the
existing native installer after two separate operator confirmations.
"""
import json
import os
import queue
import re
import subprocess
import tempfile
import threading
import tkinter as tk
from tkinter import ttk, messagebox, simpledialog

HERE = os.path.dirname(os.path.abspath(__file__))
STEPS = ("Welcome", "Storage", "Locale", "Administrator", "Network", "Summary", "Install")
BG, PANEL, PANEL2 = "#07131c", "#10252b", "#172b33"
GREEN, LIGHT, MUTED, BORDER = "#83f36b", "#f5f9fc", "#aec0c8", "#31565a"


def command(*args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=12).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


def available_disks():
    try:
        devices = json.loads(command("lsblk", "-J", "-b", "-o",
                                      "NAME,PATH,SIZE,MODEL,TYPE,RO,RM,MOUNTPOINTS")).get("blockdevices", [])
    except (ValueError, AttributeError):
        return []
    return [d for d in devices if d.get("type") == "disk" and
            not d.get("ro") and not d.get("rm") and int(d.get("size") or 0) >= 37580963840]


class Wizard:
    def __init__(self, root):
        self.root = root
        root.title("LightNAS ISO Installer")
        root.geometry("1280x760")
        root.minsize(960, 640)
        root.configure(bg=BG)
        self.step = 0
        self.mode = tk.StringVar(value="Install LightNAS")
        self.disk = tk.StringVar(value="")
        self.hostname = tk.StringVar(value="lightnas")
        self.fqdn = tk.StringVar(value="")
        self.username = tk.StringVar(value="admin")
        self.email = tk.StringVar(value="")
        self.password = tk.StringVar(value="")
        self.confirm_password = tk.StringVar(value="")
        self.timezone = tk.StringVar(value="Etc/UTC")
        self.language = tk.StringVar(value="English (US)")
        self.keyboard = tk.StringVar(value="US")
        self.network_mode = tk.StringVar(value="DHCP")
        self.events = queue.Queue()
        self.install_running = False
        self.install_done = False
        self.disks = available_disks()
        style = ttk.Style(root)
        if "clam" in style.theme_names():
            style.theme_use("clam")
        style.configure("Light.TCombobox", fieldbackground=PANEL2, background=PANEL2,
                        foreground="#111e23", padding=8)
        shell = tk.Frame(root, bg=BG)
        shell.pack(fill="both", expand=True)
        self.sidebar = tk.Frame(shell, width=245, bg="#0a1c26", padx=18, pady=24)
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)
        self.main = tk.Frame(shell, bg=BG, padx=32, pady=30)
        self.main.pack(side="left", fill="both", expand=True)
        tk.Label(self.sidebar, text="⬡ LightNAS", fg=LIGHT, bg="#0a1c26",
                 font=("DejaVu Sans", 23, "bold")).pack(anchor="w", pady=(0, 28))
        self.sidebar_steps = tk.Frame(self.sidebar, bg="#0a1c26")
        self.sidebar_steps.pack(fill="x")
        self.content = tk.Frame(self.main, bg=BG)
        self.content.pack(fill="both", expand=True)
        self.footer = tk.Frame(self.main, bg=BG, pady=14)
        self.footer.pack(fill="x")
        tk.Label(self.footer, text="LightNAS ISO Installer", bg=BG, fg=MUTED,
                 font=("DejaVu Sans", 10)).pack(side="left")
        self.next_btn = self.button(self.footer, "Next  →", self.next, accent=True)
        self.next_btn.pack(side="right", padx=(12, 0))
        self.button(self.footer, "Cancel", self.cancel).pack(side="right")
        self.back_btn = self.button(self.footer, "←  Back", self.back)
        self.back_btn.pack(side="right", padx=(0, 10))
        self.render()

    @staticmethod
    def button(parent, text, action, accent=False):
        return tk.Button(parent, text=text, command=action, padx=19, pady=10,
                         bd=0, cursor="hand2", font=("DejaVu Sans", 11, "bold"),
                         bg=GREEN if accent else PANEL2,
                         fg="#061b12" if accent else LIGHT,
                         activebackground="#b2ff91" if accent else BORDER)

    @staticmethod
    def label(parent, text, size=11, bold=False, color=LIGHT, **kwargs):
        return tk.Label(parent, text=text, bg=parent.cget("bg"), fg=color,
                        font=("DejaVu Sans", size, "bold" if bold else "normal"), **kwargs)

    def title(self, name, hint):
        self.label(self.content, name, 27, True).pack(anchor="w", pady=(0, 6))
        self.label(self.content, hint, 13, color=MUTED).pack(anchor="w", pady=(0, 24))

    def panel(self):
        frame = tk.Frame(self.content, bg=PANEL, padx=22, pady=22,
                         highlightbackground=BORDER, highlightthickness=1)
        frame.pack(fill="both", expand=True, pady=(0, 12))
        return frame

    def entry(self, parent, name, variable, secret=False):
        self.label(parent, name, 11, True).pack(anchor="w", pady=(12, 4))
        widget = tk.Entry(parent, textvariable=variable, show="•" if secret else "",
                          font=("DejaVu Sans", 12), bg=PANEL2, fg=LIGHT,
                          insertbackground=GREEN, relief="flat", highlightthickness=1,
                          highlightbackground=BORDER, highlightcolor=GREEN)
        widget.pack(fill="x", ipady=10)
        return widget

    def selection(self, parent, name, variable, values):
        self.label(parent, name, 11, True).pack(anchor="w", pady=(12, 4))
        widget = ttk.Combobox(parent, textvariable=variable, values=values,
                              state="readonly", style="Light.TCombobox",
                              font=("DejaVu Sans", 12))
        widget.pack(fill="x", ipady=6)
        return widget

    def render(self):
        for child in self.sidebar_steps.winfo_children():
            child.destroy()
        for child in self.content.winfo_children():
            child.destroy()
        for i, name in enumerate(STEPS):
            active = i == self.step
            mark = "✓" if i < self.step else str(i + 1)
            bg = "#0e5a37" if active else "#0a1c26"
            fg = GREEN if i < self.step else LIGHT if active else MUTED
            self.label(self.sidebar_steps, f"  {mark}     {name}", 12, active,
                       color=fg).configure(bg=bg)
            tk.Label(self.sidebar_steps, text=f"  {mark}     {name}", bg=bg,
                     fg=fg, anchor="w", padx=9, pady=14,
                     font=("DejaVu Sans", 12, "bold" if active else "normal")
                     ).pack(fill="x", pady=2)
        self.back_btn.configure(state="disabled" if self.step == 0 or self.install_running else "normal")
        self.next_btn.configure(text="Install  →" if self.step == 5 else
                                "Finish" if self.step == 6 and self.install_done else
                                "Next  →", state="disabled" if self.install_running else "normal")
        getattr(self, "page_" + str(self.step))()

    def page_0(self):
        self.title("Welcome to LightNAS Installer", "Set up your LightNAS appliance in a few guided steps.")
        frame = self.panel()
        self.label(frame, "LightNAS", 29, True, color=GREEN).pack(anchor="w", pady=(20, 12))
        self.label(frame, "Your private cloud for storage, media, applications, and virtual machines.",
                   14, color=LIGHT, wraplength=650, justify="left").pack(anchor="w", pady=(0, 28))
        for value, description in [
            ("Install LightNAS", "Install a complete appliance to a selected disk."),
            ("Advanced Installation", "Custom disk layouts and filesystems are not yet available in this ISO."),
            ("Rescue Environment", "Exit to the live recovery shell and diagnostic tools.")
        ]:
            row = tk.Frame(frame, bg=PANEL, pady=8)
            row.pack(fill="x")
            tk.Radiobutton(row, text=f"{value}  —  {description}", variable=self.mode,
                           value=value, bg=PANEL, fg=LIGHT, selectcolor=PANEL2,
                           activebackground=PANEL, activeforeground=GREEN,
                           font=("DejaVu Sans", 11),
                           state="normal" if value != "Advanced Installation" else "disabled"
                           ).pack(anchor="w")

    def page_1(self):
        self.title("Storage Configuration", "Select the installation disk. No disk is preselected.")
        frame = self.panel()
        self.label(frame, "Available installation drives", 17, True).pack(anchor="w", pady=(0, 10))
        if not self.disks:
            self.label(frame, "No writable non-removable disk of at least 35 GiB was detected.",
                       color="#ffd36f").pack(anchor="w")
        for device in self.disks:
            path = device.get("path") or "/dev/" + device["name"]
            size = int(device.get("size") or 0) / 10**9
            tk.Radiobutton(frame, text=f"{path}      {size:.1f} GB      {device.get('model') or 'Disk'}",
                           variable=self.disk, value=path, fg=LIGHT, bg=PANEL,
                           selectcolor=PANEL2, activebackground=PANEL,
                           activeforeground=GREEN, font=("DejaVu Sans", 12),
                           anchor="w", pady=10).pack(fill="x")
        self.label(frame, "Filesystem: ext4 (current native installer)", 12, True,
                   color=GREEN).pack(anchor="w", pady=(22, 7))
        self.label(frame, "ZFS and Btrfs data pools can be configured in the management console "
                   "after installation. Do not select a disk containing data you want to preserve.",
                   color=MUTED, wraplength=650, justify="left").pack(anchor="w")

    def page_2(self):
        self.title("Regional Settings", "Choose your language, timezone, and keyboard preferences.")
        frame = self.panel()
        self.selection(frame, "Language", self.language, ["English (US)"])
        self.selection(frame, "Timezone", self.timezone,
                       ["Etc/UTC", "America/New_York", "America/Chicago",
                        "America/Denver", "America/Los_Angeles", "Europe/London",
                        "Europe/Berlin", "Asia/Tokyo"])
        self.selection(frame, "Keyboard layout", self.keyboard, ["US"])
        self.label(frame, "Additional keyboard and language layouts will be available in a future installer build.",
                   color=MUTED, wraplength=650).pack(anchor="w", pady=24)

    def page_3(self):
        self.title("Administrator Account", "Create the local Linux administrator for the appliance console.")
        frame = self.panel()
        self.entry(frame, "Administrator username", self.username)
        self.entry(frame, "Password (12 characters minimum)", self.password, True)
        self.entry(frame, "Confirm password", self.confirm_password, True)
        self.entry(frame, "Email address (optional)", self.email)
        self.label(frame, "The Linux console account is separate from application-level web authentication.",
                   color=MUTED, wraplength=680).pack(anchor="w", pady=20)

    def page_4(self):
        self.title("Network Configuration", "Set the appliance hostname and review network connectivity.")
        frame = self.panel()
        self.entry(frame, "Hostname", self.hostname)
        self.entry(frame, "Fully qualified domain name (optional)", self.fqdn)
        self.selection(frame, "IP configuration", self.network_mode, ["DHCP", "Manual (open network setup)"])
        self.label(frame, "Detected IP addresses: " + (command("hostname", "-I").strip() or "Not yet connected"),
                   color=GREEN).pack(anchor="w", pady=(18, 8))
        self.button(frame, "Configure Ethernet / Wi-Fi", self.open_network).pack(anchor="w", pady=8)
        self.label(frame, "Networking is configured on the live system using NetworkManager and "
                   "its persistent profiles are transferred to the installed appliance.",
                   color=MUTED, wraplength=700, justify="left").pack(anchor="w", pady=12)
        self.label(frame, "Management console: HTTPS on port 3080", color=GREEN).pack(anchor="w", pady=8)

    def page_5(self):
        self.title("Installation Summary", "Review these settings before installation.")
        frame = self.panel()
        values = [
            ("Target disk", self.disk.get() or "Not selected"),
            ("Filesystem", "ext4"),
            ("Timezone", self.timezone.get()),
            ("Administrator", self.username.get()),
            ("Hostname", self.hostname.get()),
            ("FQDN", self.fqdn.get() or "Not set"),
            ("Network", self.network_mode.get()),
            ("Web management", "HTTPS :3080")
        ]
        for name, value in values:
            line = tk.Frame(frame, bg=PANEL)
            line.pack(fill="x", pady=7)
            self.label(line, name, 11, True, color=MUTED).pack(side="left")
            self.label(line, value, 11, color=LIGHT).pack(side="right")
        self.label(frame, "WARNING: The selected installation disk will be permanently erased.",
                   12, True, color="#ffd36f").pack(anchor="w", pady=25)

    def page_6(self):
        self.title("Install LightNAS", "Installation progress and the final reboot.")
        frame = self.panel()
        self.progress_label = self.label(frame, "Preparing installation...", 15, True, color=GREEN)
        self.progress_label.pack(anchor="w", pady=(0, 12))
        self.log = tk.Text(frame, bg=PANEL2, fg=LIGHT, insertbackground=GREEN,
                           font=("DejaVu Sans Mono", 10), relief="flat", state="disabled")
        self.log.pack(fill="both", expand=True)
        if self.install_done:
            self.progress_label.configure(text="Installation complete. Remove the ISO and reboot.")
        elif not self.install_running:
            self.progress_label.configure(text="Installation has not started.")

    def open_network(self):
        path = os.path.join(HERE, "lightnas-network-gui.py")
        if os.path.isfile(path):
            subprocess.Popen(["python3", path], close_fds=True)
        else:
            messagebox.showerror("LightNAS", "Network setup is unavailable.")

    def validate(self):
        if self.step == 0 and self.mode.get() == "Rescue Environment":
            messagebox.showinfo("LightNAS", "Close the installer to access recovery tools.")
            return False
        if self.step == 1 and not self.disk.get():
            messagebox.showerror("LightNAS", "Select an installation disk.")
            return False
        if self.step == 3:
            if not re.fullmatch(r"[a-z_][a-z0-9_-]{0,30}", self.username.get()):
                messagebox.showerror("LightNAS", "Invalid administrator username.")
                return False
            if len(self.password.get()) < 12 or self.password.get() != self.confirm_password.get() or "\n" in self.password.get() or ":" in self.password.get():
                messagebox.showerror("LightNAS", "Passwords must match, have 12+ characters, and contain no colon or newline.")
                return False
        if self.step == 4:
            if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", self.hostname.get()):
                messagebox.showerror("LightNAS", "Enter a valid hostname.")
                return False
            if self.fqdn.get() and (len(self.fqdn.get()) > 253 or
                                    not all(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", part)
                                            for part in self.fqdn.get().split("."))):
                messagebox.showerror("LightNAS", "Enter a valid FQDN.")
                return False
            if self.network_mode.get().startswith("Manual"):
                messagebox.showinfo("LightNAS", "Configure the static address using Network Setup before continuing.")
                return False
        return True

    def next(self):
        if self.install_running:
            return
        if self.step == 6:
            if self.install_done:
                self.root.destroy()
            return
        if not self.validate():
            return
        if self.step == 5:
            disk = self.disk.get()
            if not messagebox.askyesno("Erase selected disk?", f"ALL partitions and data on {disk} will be destroyed. Continue?"):
                return
            typed = simpledialog.askstring("Confirm disk erase", f"Type ERASE:{disk} to proceed.")
            if typed != f"ERASE:{disk}":
                messagebox.showwarning("LightNAS", "No changes were made.")
                return
            self.step = 6
            self.render()
            self.run_install(typed)
            return
        self.step += 1
        self.render()

    def back(self):
        if self.step > 0 and not self.install_running:
            self.step -= 1
            self.render()

    def cancel(self):
        if self.install_running:
            messagebox.showwarning("LightNAS", "Do not interrupt disk installation. Follow the install log.")
            return
        self.root.destroy()

    def run_install(self, confirmation):
        self.install_running = True
        self.back_btn.configure(state="disabled")
        self.next_btn.configure(state="disabled")
        self.root.protocol("WM_DELETE_WINDOW", self.cancel)

        def worker():
            credential_path = None
            try:
                fd, credential_path = tempfile.mkstemp(prefix="lightnas-admin-", dir="/run")
                os.fchmod(fd, 0o600)
                with os.fdopen(fd, "w") as file:
                    file.write(self.password.get())
                env = dict(os.environ)
                env.update(LIGHTNAS_ERASE_CONFIRM=confirmation,
                           LIGHTNAS_INSTALL_ADMIN=self.username.get(),
                           LIGHTNAS_INSTALL_PASSWORD_FILE=credential_path,
                           LIGHTNAS_INSTALL_HOSTNAME=self.hostname.get(),
                           LIGHTNAS_INSTALL_FQDN=self.fqdn.get(),
                           LIGHTNAS_INSTALL_TIMEZONE=self.timezone.get())
                process = subprocess.Popen(
                    ["/bin/bash", os.path.join(HERE, "lightnas-native-install.sh"), self.disk.get()],
                    env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
                for line in process.stdout:
                    self.events.put(("line", line))
                self.events.put(("done", process.wait()))
            except OSError as error:
                self.events.put(("error", str(error)))
            finally:
                if credential_path:
                    try:
                        os.unlink(credential_path)
                    except OSError:
                        pass
        threading.Thread(target=worker, daemon=True).start()
        self.root.after(150, self.poll)

    def poll(self):
        while not self.events.empty():
            kind, value = self.events.get_nowait()
            if kind == "line":
                self.log.configure(state="normal")
                self.log.insert("end", value)
                self.log.see("end")
                self.log.configure(state="disabled")
            else:
                self.install_running = False
                self.install_done = kind == "done" and value == 0
                self.progress_label.configure(
                    text="Installation complete. Remove ISO and reboot." if self.install_done
                         else "Installation failed. Review the log before rebooting.",
                    fg=GREEN if self.install_done else "#ffb46d")
                self.next_btn.configure(state="normal" if self.install_done else "disabled",
                                        text="Finish" if self.install_done else "Failed")
                if self.install_done:
                    messagebox.showinfo("LightNAS", "Installation completed. Remove the installation media and reboot.")
                return
        self.root.after(150, self.poll)


if __name__ == "__main__":
    if os.geteuid() != 0:
        raise SystemExit("Run the LightNAS installer as root")
    root = tk.Tk()
    Wizard(root)
    root.mainloop()
