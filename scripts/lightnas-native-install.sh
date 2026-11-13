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
# Apply only values explicitly supplied by the guided installer.
hostname_value="${LIGHTNAS_INSTALL_HOSTNAME:-lightnas}"
[[ "$hostname_value" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$ ]] || die "Invalid hostname"
printf '%s\n' "$hostname_value" >"$target/etc/hostname"
if [[ -n "${LIGHTNAS_INSTALL_FQDN:-}" ]]; then
  [[ "${LIGHTNAS_INSTALL_FQDN}" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$ ]] || die "Invalid FQDN"
  printf '127.0.1.1 %s %s\n' "$LIGHTNAS_INSTALL_FQDN" "$hostname_value" >>"$target/etc/hosts"
fi
if [[ -n "${LIGHTNAS_INSTALL_TIMEZONE:-}" ]]; then
  tz="$LIGHTNAS_INSTALL_TIMEZONE"
  [[ "$tz" != *..* && "$tz" != /* && -f "$target/usr/share/zoneinfo/$tz" ]] || die "Invalid time zone"
  ln -sfn "/usr/share/zoneinfo/$tz" "$target/etc/localtime"
  printf '%s\n' "$tz" >"$target/etc/timezone"
fi
if [[ -n "${LIGHTNAS_INSTALL_ADMIN:-}" ]]; then
  [[ "${LIGHTNAS_INSTALL_ADMIN}" =~ ^[a-z_][a-z0-9_-]{0,30}$ ]] || die "Invalid administrator username"
  credential="${LIGHTNAS_INSTALL_PASSWORD_FILE:-}"
  [[ -n "$credential" && -f "$credential" && ! -L "$credential" ]] || die "Administrator password file missing"
  [[ "$(stat -c '%a' "$credential")" == 600 && "$(stat -c '%u' "$credential")" == 0 ]] || die "Password file must be root-owned mode 0600"
  admin_name="$LIGHTNAS_INSTALL_ADMIN"
  if ! chroot "$target" id "$admin_name" >/dev/null 2>&1; then
    chroot "$target" useradd -m -s /bin/bash -G sudo "$admin_name"
  fi
  # Never pass passwords in command arguments, logs, or environment variables.
  { printf '%s:' "$admin_name"; cat "$credential"; printf '\n'; } | chroot "$target" chpasswd
fi
# The installed appliance is headless. The installer UI belongs only to
# the live ISO, not the installed boot target.
chroot "$target" systemctl disable lightnas-display-console.service 2>/dev/null || true
chroot "$target" systemctl set-default multi-user.target
rm -f "$target/etc/systemd/system/graphical.target.wants/lightnas-display-console.service"
cat >"$target/etc/systemd/system/lightnas-console-banner.service" <<'BANNER_UNIT'
[Unit]
Description=LightNAS appliance login banner
After=NetworkManager.service network-online.target
Wants=network-online.target
ConditionPathExists=/etc/lightnas-installed

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/lightnas-console-banner

[Install]
WantedBy=multi-user.target
BANNER_UNIT
install -d "$target/usr/local/sbin"
cat >"$target/usr/local/sbin/lightnas-console-banner" <<'BANNER_SCRIPT'
#!/bin/bash
set -eu
host="$(hostname -s)"
ip="$(ip -4 -o addr show scope global 2>/dev/null | awk '$2 !~ /^(docker|virbr|veth|br-|lxc)/ {split($4, a, "/"); print a[1]; exit}')"
ip="${ip:-<appliance-ip>}"
{
  printf '\n'
  printf 'LightNAS Appliance\n'
  printf 'Web Console: https://%s:3080\n' "$ip"
  printf 'Hostname:    %s\n' "$host"
  printf '\nTo manage your LightNAS system, use the web console.\n\n'
} >/etc/issue
cp /etc/issue /etc/issue.net
BANNER_SCRIPT
chmod 0755 "$target/usr/local/sbin/lightnas-console-banner"
mkdir -p "$target/etc/systemd/system/multi-user.target.wants"
ln -sfn ../lightnas-console-banner.service "$target/etc/systemd/system/multi-user.target.wants/lightnas-console-banner.service"
# Update /etc/issue before the initial login prompt, not only after network-online.
chroot "$target" /usr/local/sbin/lightnas-console-banner || true

touch "$target/etc/lightnas-installed"
rm -f "$target/etc/systemd/system/multi-user.target.wants/lightnas-native-installer.service"
for p in dev proc sys run; do mount --bind "/$p" "$target/$p"; done
chroot "$target" grub-install --target=i386-pc --recheck "$disk"
chroot "$target" grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=LightNAS --removable --no-nvram
chroot "$target" update-grub
sync
echo "LightNAS installation complete. Remove ISO and reboot."
