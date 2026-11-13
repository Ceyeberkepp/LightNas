#!/usr/bin/env python3
"""Non-destructive GUI smoke test; requires Xvfb and Tk."""
import importlib.util
import os
from pathlib import Path
import tkinter as tk
import subprocess
import time

source = Path(__file__).resolve().parents[1] / "scripts/lightnas-guided-installer.py"
spec = importlib.util.spec_from_file_location("lightnas_installer", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

# Never rely on real disks or trigger the destructive installation subprocess.
module.available_disks = lambda: [
    {"type": "disk", "path": "/dev/lightnas-TEST-ONLY", "size": 40 * 1024**3, "model": "Smoke Disk", "ro": False, "rm": False}
]
root = tk.Tk()
try:
    wizard = module.Wizard(root)
    root.update()
    assert wizard.logo_image is not None, "Branded asset is missing or could not be loaded"
    assert wizard.step == 0
    assert wizard.next_btn.cget("state") == "normal"
    # XTest pointer events exercise the real rendered UI, not Python callbacks.
    def click(widget):
        root.update()
        x = widget.winfo_rootx() + widget.winfo_width() // 2
        y = widget.winfo_rooty() + widget.winfo_height() // 2
        assert 0 <= x < root.winfo_screenwidth(), (x, y, "outside screen")
        assert 0 <= y < root.winfo_screenheight(), (x, y, "outside screen")
        subprocess.run(["xdotool", "mousemove", str(x), str(y)], check=True, timeout=5)
        subprocess.run(["xdotool", "click", "1"], check=True, timeout=5)
        for _ in range(10):
            root.update()
            time.sleep(0.03)

    click(wizard.next_btn)
    assert wizard.step == 1, "Next did not leave Welcome"
    wizard.disk.set("/dev/lightnas-TEST-ONLY")
    click(wizard.next_btn)
    root.update()
    assert wizard.step == 2, "Next did not leave Storage"
    click(wizard.back_btn)
    root.update()
    assert wizard.step == 1, "Back did not return to Storage"
    click(wizard.next_btn)
    click(wizard.next_btn)
    root.update()
    assert wizard.step == 3, "Administrator page not reachable"
    wizard.username.set("admin")
    wizard.password.set("Example-GUI-Test-Only-123")
    wizard.confirm_password.set("Example-GUI-Test-Only-123")
    click(wizard.next_btn)
    root.update()
    assert wizard.step == 4, "Administrator validation blocked valid credentials"
    wizard.network_mode.set("Manual (open network setup)")
    click(wizard.next_btn)
    root.update()
    assert wizard.step == 5, "Static IP mode incorrectly blocks the Summary page"
    assert not wizard.install_running
    print("LightNAS GUI smoke PASS: real logo loaded; X11 mouse clicks, Next/Back, validation/navigation work")
finally:
    root.destroy()
