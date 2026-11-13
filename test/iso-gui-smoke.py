#!/usr/bin/env python3
"""Non-destructive GUI smoke test; requires Xvfb and Tk."""
import importlib.util
import os
from pathlib import Path
import tkinter as tk

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
    # Exercise the REAL callback with Tk's button invocation.
    wizard.next_btn.invoke()
    root.update()
    assert wizard.step == 1, "Next did not leave Welcome"
    wizard.disk.set("/dev/lightnas-TEST-ONLY")
    wizard.next_btn.invoke()
    root.update()
    assert wizard.step == 2, "Next did not leave Storage"
    wizard.back_btn.invoke()
    root.update()
    assert wizard.step == 1, "Back did not return to Storage"
    wizard.next_btn.invoke()
    wizard.next_btn.invoke()
    root.update()
    assert wizard.step == 3, "Administrator page not reachable"
    wizard.username.set("admin")
    wizard.password.set("Example-GUI-Test-Only-123")
    wizard.confirm_password.set("Example-GUI-Test-Only-123")
    wizard.next_btn.invoke()
    root.update()
    assert wizard.step == 4, "Administrator validation blocked valid credentials"
    wizard.network_mode.set("Manual (open network setup)")
    wizard.next_btn.invoke()
    root.update()
    assert wizard.step == 5, "Static IP mode incorrectly blocks the Summary page"
    assert not wizard.install_running
    print("LightNAS GUI smoke PASS: real logo loaded; Next/Back/selection/validation/navigation work")
finally:
    root.destroy()
