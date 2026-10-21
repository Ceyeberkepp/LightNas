#!/usr/bin/env bash
# LightNAS native offline installation. Intentionally never chooses a disk.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
die() { echo "LightNAS installer: $*" >&2; exit 1; }
[[ $EUID == 0 ]] || die "Root privileges required"
[[ -e /run/live/medium || -e /lib/live/mount/medium ]] || die "Boot from the LightNAS live ISO first"
[[ $# == 1 && "$1" == /dev/* ]] || die "Provide exactly one disk path"
disk="$(readlink -f "$1")"
[[ -b "$disk" && "$(lsblk -dn -o TYPE "$disk" | xargs)" == disk ]] || die "Select a whole physical or virtual disk"
[[ "$(lsblk -dn -o RO "$disk" | xargs)" == 0 ]] || die "Read-only disk"
(( $(blockdev --getsize64 "$disk") >= 37580963840 )) || die "At least 35 GiB is required"
[[ "${LIGHTNAS_ERASE_CONFIRM:-}" == "ERASE:$disk" ]] || die "Explicit erase confirmation missing"
source="$(findmnt -no SOURCE /run/live/medium 2>/dev/null || findmnt -no SOURCE /lib/live/mount/medium 2>/dev/null || true)"
if [[ "$source" == /dev/* ]]; then
  media_parent="$(lsblk -no PKNAME "$source" 2>/dev/null | head -1)"
  [[ "$source" != "$disk" && "/dev/$media_parent" != "$disk" ]] || die "Refusing to erase the boot media"
fi
[[ -z "$(lsblk -nr -o MOUNTPOINTS "$disk" | tr -d '[:space:]')" ]] || die "Selected disk has mounted filesystems"
for cmd in sgdisk wipefs mkfs.vfat mkfs.ext4 rsync grub-install update-grub; do command -v "$cmd" >/dev/null || die "Missing dependency $cmd"; done
target=/mnt/lightnas-install-target
[[ ! -e "$target/etc/fstab" ]] || die "Installation target mountpoint is in use"
mkdir -p "$target"
cleanup() { umount -R "$target" 2>/dev/null || true; }
trap cleanup EXIT
echo "Installing LightNAS to $disk. This disk will be erased."
wipefs -a "$disk"
sgdisk --zap-all "$disk"
sgdisk -n 1:1MiB:+4MiB -t 1:ef02 -c 1:"LightNAS BIOS" "$disk"
sgdisk -n 2:0:+512MiB -t 2:ef00 -c 2:"LightNAS EFI" "$disk"
sgdisk -n 3:0:0 -t 3:8300 -c 3:"LightNAS System" "$disk"
partprobe "$disk" || true
udevadm settle --timeout=30 || true
part() { if [[ "$disk" =~ [0-9]$ ]]; then echo "${disk}p$1"; else echo "${disk}$1"; fi; }
esp="$(part 2)"; root="$(part 3)"
for i in {1..30}; do [[ -b "$esp" && -b "$root" ]] && break; sleep 1; done
[[ -b "$esp" && -b "$root" ]] || die "Kernel did not detect partitions"
mkfs.vfat -F32 -n LIGHTNAS_EFI "$esp"
mkfs.ext4 -F -L LIGHTNAS_ROOT "$root"
mount "$root" "$target"
mkdir -p "$target/boot/efi"
mount "$esp" "$target/boot/efi"
rsync -aHAX --numeric-ids --one-file-system \
  --exclude='/dev/*' --exclude='/proc/*' --exclude='/sys/*' \
  --exclude='/run/*' --exclude='/tmp/*' --exclude='/mnt/*' \
  --exclude='/media/*' --exclude='/lost+found' \
  / "$target/"
mkdir -p "$target"/{dev,proc,sys,run,tmp,mnt,media}
chmod 1777 "$target/tmp"
printf 'UUID=%s / ext4 defaults,noatime 0 1\nUUID=%s /boot/efi vfat umask=0077 0 2\n' \
  "$(blkid -s UUID -o value "$root")" "$(blkid -s UUID -o value "$esp")" > "$target/etc/fstab"
printf 'lightnas\n' >"$target/etc/hostname"
touch "$target/etc/lightnas-installed"
rm -f "$target/etc/systemd/system/multi-user.target.wants/lightnas-native-installer.service"
for p in dev proc sys run; do mount --bind "/$p" "$target/$p"; done
chroot "$target" grub-install --target=i386-pc --recheck "$disk"
chroot "$target" grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=LightNAS --removable --no-nvram
chroot "$target" update-grub
sync
echo "LightNAS installation complete. Remove ISO and reboot."
