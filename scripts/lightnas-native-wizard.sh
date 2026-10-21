#!/usr/bin/env bash
# LightNAS native interactive installer console, never auto-erases disks.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
[[ -e /etc/lightnas-installed ]] && exit 0
[[ -e /run/live/medium || -e /lib/live/mount/medium ]] || exit 0
clear || true
printf '\n       LightNAS Native Installer\n'
printf '       Detecting storage, networking and graphics...\n\n'
if command -v /opt/lightnas/scripts/lightnas-hardware-report.sh >/dev/null; then
  /bin/bash /opt/lightnas/scripts/lightnas-hardware-report.sh > /run/lightnas-hardware-report.log 2>&1 || true
fi
if [[ -n "${DISPLAY:-}" ]]; then
  :
elif [[ -x /usr/bin/xinit && -f /opt/lightnas/scripts/lightnas-install-hub.py ]]; then
  # Attempt software-friendly X first. If no graphics, fall back automatically
  # to a keyboard-operated terminal wizard without stopping installation.
  timeout 35 xinit /usr/bin/python3 /opt/lightnas/scripts/lightnas-install-hub.py -- :0 -nolisten tcp >/run/lightnas-installer-x.log 2>&1 && exit 0 || true
fi
if ! command -v whiptail >/dev/null; then
  echo "Graphical environment unavailable; whiptail is missing."
  exec /bin/bash
fi
while true; do
  selection="$(whiptail --title 'LightNAS Installer' --menu 'Select next step' 19 75 9 \
    network 'Configure Ethernet or Wi-Fi' \
    disks 'Select destination disk and install' \
    hardware 'View hardware-driver report' \
    shell 'Open diagnostic shell' \
    exit 'Exit installer' 3>&1 1>&2 2>&3)" || exit 0
  case "$selection" in
    network)
      if [[ -x /usr/bin/nmtui ]]; then nmtui; else whiptail --msgbox 'NetworkManager console is not available.' 9 65; fi
      ;;
    hardware)
      whiptail --textbox /run/lightnas-hardware-report.log 23 85 || true
      ;;
    shell) /bin/bash ;;
    exit) exit 0 ;;
    disks)
      choices=()
      while read -r path size model; do
        [[ -n "$path" ]] && choices+=("$path" "$size $model")
      done < <(lsblk -dnp -o PATH,SIZE,MODEL -P | sed -n 's/.*PATH="\([^"]*\)".*SIZE="\([^"]*\)".*MODEL="\([^"]*\)".*/\1 \2 \3/p')
      if (( ${#choices[@]} == 0 )); then
        whiptail --msgbox 'No installation disks detected.' 9 65
        continue
      fi
      disk="$(whiptail --title 'Select LightNAS installation disk' --menu 'ALL DATA on the selected disk will be erased.' 22 85 12 "${choices[@]}" 3>&1 1>&2 2>&3)" || continue
      if whiptail --title 'Confirm destructive installation' --yesno "PERMANENTLY ERASE ALL DATA on $disk and install LightNAS? This cannot be undone." 12 76; then
        if whiptail --inputbox "To confirm, type ERASE followed by the disk path exactly: ERASE:$disk" 12 85 3>&1 1>&2 2>&3 | grep -Fxq "ERASE:$disk"; then
          export LIGHTNAS_ERASE_CONFIRM="ERASE:$disk"
          if /bin/bash /opt/lightnas/scripts/lightnas-native-install.sh "$disk" >/run/lightnas-install.log 2>&1; then
            whiptail --msgbox 'LightNAS installed. Remove the ISO before rebooting.' 10 70
            exit 0
          else
            whiptail --textbox /run/lightnas-install.log 23 85 || true
          fi
        fi
      fi
      ;;
  esac
done
