#!/usr/bin/env bash
# Console-safe interactive network setup for LightNAS ISO and installed appliances.
# Runs only at operator request, never automatically during unattended boot.
set -Eeuo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
command -v whiptail >/dev/null || { echo "Install whiptail to use this wizard." >&2; exit 1; }
command -v nmcli >/dev/null || { echo "NetworkManager is required." >&2; exit 1; }
PY=/opt/lightnas/scripts/lightnas-network-setup.py
[[ -r "$PY" ]] || PY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lightnas-network-setup.py"
[[ -r "$PY" ]] || { echo "LightNAS network discovery is unavailable." >&2; exit 1; }

temp="$(mktemp)"
trap 'rm -f "$temp"' EXIT
if ! python3 "$PY" --json > "$temp"; then
  echo "Cannot discover network interfaces." >&2; exit 1
fi
mapfile -t nics < <(python3 - "$temp" <<'PY'
import json,sys
for nic in json.load(open(sys.argv[1]))["interfaces"]:
    desc = f'{nic["type"]} {nic.get("state") or "unknown"}'
    print(nic["name"] + "\t" + desc)
PY
)
(( ${#nics[@]} > 0 )) || { whiptail --msgbox "No managed Ethernet or Wi-Fi devices were found. Check firmware, drivers and rfkill." 10 74; exit 1; }
choices=()
for nic in "${nics[@]}"; do
  choices+=("${nic%%$'\t'*}" "${nic#*$'\t'}")
done
iface="$(whiptail --title 'LightNAS • Network Setup' --menu 'Choose a network interface' 18 76 10 "${choices[@]}" 3>&1 1>&2 2>&3)" || exit 0
type="$(python3 - "$temp" "$iface" <<'PY'
import json,sys
for nic in json.load(open(sys.argv[1]))["interfaces"]:
    if nic["name"] == sys.argv[2]:
        print(nic["type"])
        break
PY
)"
[[ "$type" == ethernet || "$type" == wifi ]] || { echo "Interface changed. Retry discovery." >&2; exit 1; }

# Prefill editable values from the selected interface, never guessed defaults.
mapfile -t detected < <(python3 - "$temp" "$iface" <<'PY'
import json,sys
for nic in json.load(open(sys.argv[1]))["interfaces"]:
    if nic["name"] == sys.argv[2]:
        print((nic.get("addresses") or [""])[0])
        print(nic.get("gateway") or "")
        print(" ".join(nic.get("dns") or []))
        break
PY
)
current_address="${detected[0]:-}"
current_gateway="${detected[1]:-}"
current_dns="${detected[2]:-}"
current_fqdn="$(python3 - "$temp" <<'PY'
import json,sys
print(json.load(open(sys.argv[1])).get("hostname") or "")
PY
)"

ssid=""
if [[ "$type" == wifi ]]; then
  mapfile -t networks < <(python3 - "$temp" <<'PY'
import json,sys
for ssid in json.load(open(sys.argv[1]))["wifi_ssids"]:
    if ssid and "\n" not in ssid and "\r" not in ssid:
        print(ssid)
PY
)
  if (( ${#networks[@]} > 0 )); then
    wifi_choices=()
    for network in "${networks[@]}"; do wifi_choices+=("$network" "Wi-Fi network"); done
    wifi_choices+=("OTHER" "Enter an SSID manually")
    ssid="$(whiptail --title 'LightNAS • Wi-Fi' --menu 'Select a Wi-Fi network' 19 76 11 "${wifi_choices[@]}" 3>&1 1>&2 2>&3)" || exit 0
  fi
  if [[ -z "$ssid" || "$ssid" == OTHER ]]; then
    ssid="$(whiptail --title 'LightNAS • Wi-Fi' --inputbox 'Wi-Fi network name (SSID)' 10 76 3>&1 1>&2 2>&3)" || exit 0
  fi
  [[ -n "$ssid" ]] || { whiptail --msgbox 'An SSID is required.' 9 54; exit 1; }
fi

method="$(whiptail --title 'LightNAS • IPv4' --menu 'Choose IPv4 configuration' 13 76 3 'dhcp' 'Automatic IP, gateway and DNS from router' 'static' 'Enter a static address, gateway and DNS' 3>&1 1>&2 2>&3)" || exit 0
args=(--apply --interface "$iface" --method "$method")
if [[ "$type" == wifi ]]; then args+=(--ssid "$ssid"); fi
if [[ "$method" == static ]]; then
  address="$(whiptail --inputbox 'IPv4 address with prefix, e.g. 192.168.1.25/24' 10 76 "$current_address" 3>&1 1>&2 2>&3)" || exit 0
  gateway="$(whiptail --inputbox 'Default gateway IPv4 address' 10 76 "$current_gateway" 3>&1 1>&2 2>&3)" || exit 0
  dns="$(whiptail --inputbox 'DNS server IPs, separated by spaces' 10 76 "$current_dns" 3>&1 1>&2 2>&3)" || exit 0
  read -r -a dns_servers <<< "$dns"
  args+=(--address "$address" --gateway "$gateway" --dns "${dns_servers[@]}")
fi
fqdn="$(whiptail --title 'LightNAS • Hostname' --inputbox 'Hostname or FQDN (letters, numbers, hyphens and dots)' 10 76 "$current_fqdn" 3>&1 1>&2 2>&3)" || exit 0
[[ -z "$fqdn" ]] || args+=(--fqdn "$fqdn")
review="Interface: $iface ($type)\nIPv4: $method\nHostname: ${fqdn:-unchanged}"
if [[ "$method" == static ]]; then review+="\nAddress: $address\nGateway: $gateway\nDNS: $dns"; fi
if [[ "$type" == wifi ]]; then review+="\nWi-Fi: $ssid"; fi
whiptail --title 'LightNAS • Review' --yesno "$(printf '%b\\n\\n%s' "$review" 'Applying changes may disconnect remote sessions. Continue?')" 19 76 || exit 0
# Display the real resulting configuration, never invented gateway/DNS.
python3 "$PY" "${args[@]}"
whiptail --title 'LightNAS • Configured' --msgbox "$(python3 "$PY" | head -25)" 20 78
