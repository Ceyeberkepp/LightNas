#!/usr/bin/env bash
# Exercise the EFI label with real dosfstools, without touching a block device.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
label="$(sed -n 's/^mkfs\.vfat -F32 -n \([A-Za-z0-9_]*\) "\$esp"$/\1/p' scripts/lightnas-native-install.sh)"
[[ -n "$label" ]] || { echo 'Cannot extract EFI filesystem label' >&2; exit 1; }
[[ "${#label}" -le 11 ]] || { echo "EFI FAT label too long: $label" >&2; exit 1; }
command -v mkfs.vfat >/dev/null || { echo 'dosfstools is required' >&2; exit 1; }
command -v fatlabel >/dev/null || { echo 'fatlabel is required' >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkfs.vfat -F32 -n "$label" -C "$tmp/efi.img" 65536 >/dev/null
actual="$(fatlabel "$tmp/efi.img" | tr -d '\r\n ')"
[[ "$actual" == "$label" ]] || { echo "EFI FAT label mismatch: $actual" >&2; exit 1; }
echo "LightNAS EFI FAT format OK: $label"
