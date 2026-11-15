#!/usr/bin/env python3
"""Destructive-install qualification confined to a disposable QEMU disk.

Boot the *actual* release ISO kernel/initrd into a serial maintenance shell,
run the unmodified native installer on a newly created virtual disk, then boot
that disk without the ISO and verify HTTPS answers on the forwarded host port.

Never pass a host disk or a pre-existing disk. Not run inside the shipped ISO.
"""
from pathlib import Path
import os
import pexpect
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def run(*args):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE).stdout


def extract_boot_image(iso, folder):
    listing = run("xorriso", "-indev", str(iso), "-find", "/live", "-type", "f", "-print")
    paths = [line.strip() for line in listing.splitlines() if line.strip().startswith("/live/")]
    kernels = sorted((p for p in paths if re.search(r"/vmlinuz[^/]*$", p)), key=len)
    initrds = sorted((p for p in paths if re.search(r"/initrd[^/]*$", p)), key=len)
    if not kernels or not initrds:
        raise RuntimeError(f"ISO is missing live kernel/initrd: {paths[:30]}")
    kernel = folder / "vmlinuz"
    initrd = folder / "initrd.img"
    for source, destination in ((kernels[0], kernel), (initrds[0], initrd)):
        run("xorriso", "-osirrox", "on", "-indev", str(iso),
            "-extract", source, str(destination))
    return kernel, initrd


def spawn_qemu(args, log_path):
    log = log_path.open("w", encoding="utf-8", buffering=1)
    child = pexpect.spawn(args[0], args[1:], encoding="utf-8",
                          codec_errors="replace", timeout=60)
    child.logfile_read = log
    return child, log


def tail(path, length=7000):
    try:
        return path.read_text(encoding="utf-8", errors="replace")[-length:]
    except OSError:
        return "(no log available)"


def probe_live_shell(child, log):
    # Probe output differs from the *literal* text sent to the terminal, so
    # echoed input alone cannot accidentally make the test pass.
    marker = "LIGHTNAS_E2E_READY:111"
    for _ in range(45):
        if not child.isalive():
            raise RuntimeError("Live QEMU exited before shell: " + tail(log))
        child.sendline("printf '\\nLIGHTNAS_E2E_READY:%s\\n' \"$((37*3))\"")
        try:
            child.expect_exact(marker, timeout=8)
            return
        except pexpect.TIMEOUT:
            time.sleep(1)
    raise RuntimeError("Live ISO never reached interactive serial shell: " + tail(log))


def run_installer(child, log):
    # These are commands inside the disposable guest. Nothing on the runner's
    # own disks is opened, partitioned or formatted.
    child.sendline(
        "mountpoint -q /proc || mount -t proc proc /proc; "
        "mountpoint -q /sys || mount -t sysfs sysfs /sys; "
        "mountpoint -q /dev || mount -t devtmpfs devtmpfs /dev; "
        "printf %s test-password-2026 >/run/lightnas-ci-password; "
        "chmod 600 /run/lightnas-ci-password; "
        "LIGHTNAS_ERASE_CONFIRM=CONFIRM_ERASE:/dev/vda "
        "LIGHTNAS_INSTALL_ADMIN=admin "
        "LIGHTNAS_INSTALL_PASSWORD_FILE=/run/lightnas-ci-password "
        "LIGHTNAS_INSTALL_HOSTNAME=lightnas-ci "
        "LIGHTNAS_INSTALL_TIMEZONE=Etc/UTC "
        "/bin/bash /opt/lightnas/scripts/lightnas-native-install.sh /dev/vda "
        ">/run/lightnas-ci-install.log 2>&1; "
        "ret=$?; tail -n 55 /run/lightnas-ci-install.log; "
        "printf '\\nLIGHTNAS_E2E_INSTALL_EXIT:%s\\n' \"$ret\""
    )
    try:
        child.expect(r"LIGHTNAS_E2E_INSTALL_EXIT:([0-9]+)", timeout=1200)
    except (pexpect.TIMEOUT, pexpect.EOF) as exc:
        raise RuntimeError("Native installer did not finish: " + tail(log)) from exc
    if int(child.match.group(1)) != 0:
        raise RuntimeError("Native installer exited unsuccessfully: " + tail(log))
    child.sendline("sync")
    time.sleep(4)


def verify_https(child, log, timeout=600):
    end = time.monotonic() + timeout
    context = ssl._create_unverified_context()
    url = "https://127.0.0.1:13080/"
    while time.monotonic() < end:
        if not child.isalive():
            raise RuntimeError("Installed OS stopped before HTTPS response: " + tail(log))
        try:
            with urllib.request.urlopen(url, context=context, timeout=4) as response:
                print(f"HTTPS smoke PASS: {response.status} from installed LightNAS", flush=True)
                return
        except urllib.error.HTTPError as exc:
            # Login pages can respond with 401/403; any valid HTTP response
            # proves the installed HTTPS listener answered.
            print(f"HTTPS smoke PASS: {exc.code} from installed LightNAS", flush=True)
            return
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(5)
    raise RuntimeError("Installed OS did not serve HTTPS on port 3080: " + tail(log))


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: iso-qemu-install.py <LightNAS-amd64.iso>")
    iso = Path(sys.argv[1]).resolve(strict=True)
    if iso.suffix != ".iso":
        raise SystemExit("Only a built ISO artifact is accepted")
    with tempfile.TemporaryDirectory(prefix="lightnas-qemu-e2e-") as tmp:
        work = Path(tmp)
        kernel, initrd = extract_boot_image(iso, work)
        disk = work / "DISPOSABLE-ONLY.qcow2"
        run("qemu-img", "create", "-f", "qcow2", str(disk), "40G")
        common = [
            "qemu-system-x86_64", "-machine", "q35",
            "-m", "3072", "-smp", "2", "-display", "none",
            "-monitor", "none", "-serial", "stdio", "-no-reboot",
            "-drive", f"file={disk},if=virtio,format=qcow2",
        ]
        install_args = common + [
            "-cdrom", str(iso), "-kernel", str(kernel), "-initrd", str(initrd),
            "-append", "boot=live components console=ttyS0,115200n8 "
                       "init=/bin/bash hostname=lightnas-ci",
        ]
        live_log = work / "live-install-serial.log"
        vm, log = spawn_qemu(install_args, live_log)
        try:
            print("Booting real LightNAS ISO with disposable 40 GB QEMU disk...", flush=True)
            probe_live_shell(vm, live_log)
            run_installer(vm, live_log)
            print("Native disk install PASS. Booting installed disk without ISO...", flush=True)
        finally:
            vm.terminate(force=True)
            log.close()

        boot_args = common + [
            "-netdev", "user,id=lan,hostfwd=tcp:127.0.0.1:13080-:3080",
            "-device", "virtio-net-pci,netdev=lan",
        ]
        boot_log = work / "installed-boot-serial.log"
        vm, log = spawn_qemu(boot_args, boot_log)
        try:
            verify_https(vm, boot_log)
        finally:
            vm.terminate(force=True)
            log.close()
        print("LightNAS ISO end-to-end qualification PASSED", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"LightNAS end-to-end qualification FAILED: {exc}", file=sys.stderr)
        raise
