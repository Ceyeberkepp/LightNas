#!/usr/bin/env bash
# Read-only hardware compatibility report for LightNAS live/install environments.
set -u
echo "LightNAS hardware compatibility report"
echo "Kernel: $(uname -r)"
echo "Environment: $(systemd-detect-virt 2>/dev/null || echo physical-or-unknown)"
echo
echo "=== PCI hardware and bound drivers ==="
if command -v lspci >/dev/null 2>&1; then lspci -nnk || true; else echo "lspci unavailable"; fi
echo
echo "=== USB hardware ==="
if command -v lsusb >/dev/null 2>&1; then lsusb || true; else echo "lsusb unavailable"; fi
echo
echo "=== Network interfaces and drivers ==="
if command -v ip >/dev/null 2>&1; then ip -brief link || true; fi
for nic in /sys/class/net/*; do
  [ -e "$nic" ] || continue
  name="${nic##*/}"
  printf '%s: ' "$name"
  if [ -e "$nic/device/driver" ]; then readlink -f "$nic/device/driver" | xargs basename
  else echo "virtual or no physical driver"; fi
done
echo
echo "=== Wireless adapters ==="
if command -v iw >/dev/null 2>&1; then iw dev || true; fi
if command -v rfkill >/dev/null 2>&1; then rfkill list || true; fi
echo
echo "=== Input devices ==="
cat /proc/bus/input/devices 2>/dev/null || true
echo
echo "=== Display controllers / DRM ==="
ls -l /dev/dri /dev/fb* 2>/dev/null || true
if command -v lspci >/dev/null 2>&1; then lspci -nnk | grep -A4 -Ei 'vga|3d controller|display controller' || true; fi
echo
echo "=== Storage controllers and disks (read-only) ==="
if command -v lsblk >/dev/null 2>&1; then lsblk -o NAME,SIZE,TYPE,MODEL,TRAN,RO,MOUNTPOINTS || true; fi
echo
echo "=== Kernel driver and firmware load failures ==="
dmesg 2>/dev/null | grep -Ei 'firmware.*(fail|missing)|failed to load firmware|probe failed|unknown symbol' | tail -80 || true
