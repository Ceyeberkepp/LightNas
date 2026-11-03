#!/usr/bin/env bash
# Configure the LightNAS appliance LAN automatically.
#
# Wired uplink:
#   physical NIC -> virbr0 -> LightNAS host + VMs + native LXC containers
#
# Wi-Fi uplink:
#   keep the Wi-Fi connection on the host; VM/container runtimes use routed/NAT
#   networking because a station-mode Wi-Fi NIC cannot be a transparent
#   Ethernet bridge on normal hardware.
set -Eeuo pipefail

BRIDGE="${LIGHTNAS_LAN_BRIDGE:-virbr0}"
STATE_DIR=/etc/lightnas
STATE_FILE="${STATE_DIR}/network.env"
CHOICE_FILE="${STATE_DIR}/network-choice.env"
mkdir -p "${STATE_DIR}"

# WSL2's eth0, address, DNS and default route are provisioned by Windows.
# It is not a physical appliance uplink and must NEVER be moved into virbr0,
# enslaved, renamed, or managed by LightNAS's DHCP/NetworkManager bootstrap.
# Keep this check before any NIC discovery, probes, or network writes.
if grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then
  printf 'LIGHTNAS_NETWORK_MODE=pending-uplink\nLIGHTNAS_NETWORK_ERROR=wsl-host-managed\n' >"${STATE_FILE}"
  echo "LightNAS network: WSL2 guest detected; preserving Windows-owned networking. Guest LAN passthrough requires separate validated support."
  exit 0
fi

preferred_uplink="${LIGHTNAS_UPLINK_PREFERENCE:-}"
if [[ -z "${preferred_uplink}" && -r "${CHOICE_FILE}" ]]; then
  preferred_uplink="$(sed -n 's/^LIGHTNAS_UPLINK_PREFERENCE=//p' "${CHOICE_FILE}" | tail -1)"
fi
if [[ -n "${preferred_uplink}" && ! "${preferred_uplink}" =~ ^[A-Za-z0-9_.:-]{1,32}$ ]]; then
  echo "LightNAS network: ignoring invalid saved uplink preference." >&2
  preferred_uplink=""
fi
if [[ -n "${preferred_uplink}" && ! -e "/sys/class/net/${preferred_uplink}" ]]; then
  echo "LightNAS network: saved interface ${preferred_uplink} is not currently present; using automatic discovery." >&2
  preferred_uplink=""
fi

bridge_uplink() {
  local port path
  if [[ -n "${preferred_uplink}" && -e "/sys/class/net/${preferred_uplink}" ]]; then
    printf '%s\n' "${preferred_uplink}"
    return 0
  fi
  if [[ -r "${STATE_FILE}" ]]; then
    port="$(sed -n 's/^LIGHTNAS_UPLINK=//p' "${STATE_FILE}" | tail -1)"
    [[ -n "${port}" && -e "/sys/class/net/${port}" ]] && { printf '%s\n' "${port}"; return 0; }
  fi
  for path in "/sys/class/net/${BRIDGE}/brif/"*; do
    [[ -e "${path}" ]] || continue
    port="$(basename "${path}")"
    [[ "${port}" =~ ^(veth|tap|tun|docker|br-|lightnas|lxcbr) ]] && continue
    printf '%s\n' "${port}"
    return 0
  done
  # Repair older partial conversions where virbr0 owns the host address but
  # the actual Ethernet interface was never attached as a bridge port.
  for path in /sys/class/net/*; do
    [[ -e "${path}" ]] || continue
    port="$(basename "${path}")"
    [[ "${port}" == "${BRIDGE}" || "${port}" == "lo" ]] && continue
    [[ "${port}" =~ ^(veth|tap|tun|docker|br-|lightnas|lxcbr|virbr) ]] && continue
    [[ -d "${path}/wireless" ]] && continue
    [[ "$(cat "${path}/operstate" 2>/dev/null || true)" =~ ^(up|unknown)$ ]] || continue
    printf '%s\n' "${port}"
    return 0
  done
  return 1
}

# Host bridge sysctl/firewall changes are not part of read-only discovery.
# No automatic bridge mutation is permitted during install or repair.

derive_managed_lan_pool() {
  local dev="$1" cidr gateway
  cidr="$(ip -4 -o addr show dev "$dev" scope global 2>/dev/null | awk 'NR==1{print $4}')"
  gateway="$(ip -4 route show default dev "$dev" 2>/dev/null | awk 'NR==1{for(i=1;i<=NF;i++) if($i=="via"){print $(i+1); exit}}')"
  [[ -n "$cidr" && -n "$gateway" ]] || return 1
  python3 - "$cidr" "$gateway" <<'PY'
import ipaddress, sys
iface=ipaddress.ip_interface(sys.argv[1])
net=iface.network
host=iface.ip
gateway=ipaddress.ip_address(sys.argv[2])
usable=max(0, net.num_addresses-2)
if usable < 60:
    raise SystemExit(1)
start_index=50 if usable >= 200 else max(2, usable//4)
end_index=200 if usable >= 200 else max(start_index, usable-5)
start=net.network_address + start_index
end=net.network_address + end_index
while start in {host, gateway} and start < end:
    start += 1
while end in {host, gateway} and end > start:
    end -= 1
print(f"LIGHTNAS_CONTAINER_SUBNET={net.with_prefixlen}")
print(f"LIGHTNAS_CONTAINER_POOL_START={start}")
print(f"LIGHTNAS_CONTAINER_POOL_END={end}")
print(f"LIGHTNAS_CONTAINER_GATEWAY={gateway}")
print(f"LIGHTNAS_HOST_ADDRESS={host}")
PY
}

# When LightNAS itself runs inside another container (for example Proxmox
# LXC), never move the appliance management IP or default route away from the
# existing outer-provided interface. The outer hypervisor owns that veth
# topology and moving the address to an inner bridge can disconnect LightNAS.
#
# Direct-LAN inner containers are used only when macvlan can be created on the
# existing uplink. Otherwise report unavailable LAN passthrough without moving management networking.
container_kind="$(systemd-detect-virt --container 2>/dev/null || true)"
if [[ -n "$container_kind" && "$container_kind" != "none" ]]; then
  nested_uplink="$(ip -4 route show default 2>/dev/null | awk 'NR==1 {for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')"
  [[ -n "$nested_uplink" && -e "/sys/class/net/$nested_uplink" ]] || nested_uplink=eth0

  nested_mode="${LIGHTNAS_NESTED_LAN_MODE:-auto}"
  if [[ "${nested_mode}" != "nat" ]]; then
    macvlan_probe="lnmv-probe-$$"
    if ip link add link "$nested_uplink" name "$macvlan_probe" type macvlan mode bridge >/dev/null 2>&1; then
      ip link delete "$macvlan_probe" >/dev/null 2>&1 || true
      pool_state="$(derive_managed_lan_pool "$nested_uplink" || true)"
      printf 'LIGHTNAS_NETWORK_MODE=nested-macvlan\nLIGHTNAS_UPLINK=%s\nLIGHTNAS_CONTAINER_PARENT=%s\n%s\n' "$nested_uplink" "$nested_uplink" "$pool_state" >"$STATE_FILE"
      echo "LightNAS network: nested appliance detected; direct LAN is available through macvlan on $nested_uplink."
      exit 0
    fi

    ipvlan_probe="lniv-probe-$$"
    if ip link add link "$nested_uplink" name "$ipvlan_probe" type ipvlan mode l2 >/dev/null 2>&1; then
      ip link delete "$ipvlan_probe" >/dev/null 2>&1 || true
      pool_state="$(derive_managed_lan_pool "$nested_uplink" || true)"
      printf 'LIGHTNAS_NETWORK_MODE=nested-ipvlan\nLIGHTNAS_UPLINK=%s\nLIGHTNAS_CONTAINER_PARENT=%s\n%s\n' "$nested_uplink" "$nested_uplink" "$pool_state" >"$STATE_FILE"
      echo "LightNAS network: macvlan is unavailable; direct LAN is available through ipvlan on $nested_uplink."
      exit 0
    fi
  fi

  # Never silently create the obsolete lightnas0 / 10.77.0.0/24 subnet.
  # An LXC guest cannot turn eth0 into a transparent bridge itself: the outer
  # Proxmox host must allow additional guest MACs and macvlan/ipvlan, or expose
  # a supported bridged interface. Do not move the management address.
  printf 'LIGHTNAS_NETWORK_MODE=pending-uplink\nLIGHTNAS_UPLINK=%s\nLIGHTNAS_NETWORK_ERROR=direct-lan-unavailable\n' "$nested_uplink" >"$STATE_FILE"
  echo "LightNAS network: direct LAN is unavailable on $nested_uplink; guest creation must wait. Enable permitted macvlan/ipvlan/bridged networking on Proxmox. The host eth0 IP is unchanged." >&2
  exit 0
fi

is_virtual_name() {
  [[ "${1:-}" =~ ^(lo|docker[0-9]*|virbr[0-9]*|lightnas[0-9]*|lxcbr[0-9]*|br-[A-Fa-f0-9]+|veth.*|tap.*|tun.*)$ ]]
}

discover_wired_uplink() {
  local path name first="" carrier=""
  if [[ -n "${preferred_uplink}" && -e "/sys/class/net/${preferred_uplink}" && ! -d "/sys/class/net/${preferred_uplink}/wireless" ]]; then
    printf '%s\n' "${preferred_uplink}"
    return 0
  fi
  for path in /sys/class/net/*; do
    [[ -e "${path}" ]] || continue
    name="$(basename "${path}")"
    is_virtual_name "${name}" && continue
    [[ -d "${path}/wireless" ]] && continue
    [[ "$(cat "${path}/type" 2>/dev/null || true)" == "1" ]] || continue
    [[ -n "${first}" ]] || first="${name}"
    carrier="$(cat "${path}/carrier" 2>/dev/null || true)"
    if [[ "${carrier}" == "1" ]]; then
      printf '%s\n' "${name}"
      return 0
    fi
  done
  [[ -n "${first}" ]] && printf '%s\n' "${first}"
}

bootstrap_wired_dhcp() {
  local uplink profile
  uplink="${1:-}"
  [[ -n "${uplink}" ]] || uplink="$(discover_wired_uplink || true)"
  [[ -n "${uplink}" ]] || return 1

  # An existing static/leased address is potentially remote management;
  # never replace its profile merely because the default route is missing.
  if ip -4 addr show dev "${uplink}" scope global 2>/dev/null | grep -q 'inet '; then
    echo "LightNAS network: existing IPv4 address on ${uplink} preserved; DHCP repair requires explicit approval." >&2
    return 1
  fi

  echo "LightNAS network: no IPv4 route yet; bringing up ${uplink} with DHCP."
  ip link set "${uplink}" up >/dev/null 2>&1 || true

  if command -v nmcli >/dev/null 2>&1; then
    systemctl enable NetworkManager.service >/dev/null 2>&1 || true
    systemctl start NetworkManager.service >/dev/null 2>&1 || true

    # Debian live/install images can expose the NIC as unmanaged or leave it
    # without an autoconnect profile. Take ownership and create a deterministic
    # DHCP profile only when the NIC still has no IPv4 address.
    nmcli device set "${uplink}" managed yes >/dev/null 2>&1 || true
    if ! ip -4 addr show dev "${uplink}" scope global 2>/dev/null | grep -q 'inet '; then
      if ! nmcli device connect "${uplink}" >/dev/null 2>&1; then
        profile="lightnas-auto-${uplink}"
        if nmcli -t -f NAME connection show 2>/dev/null | grep -Fxq "${profile}"; then
          nmcli connection modify "${profile}" connection.interface-name "${uplink}" connection.autoconnect yes ipv4.method auto ipv6.method auto >/dev/null 2>&1 || true
        else
          nmcli connection add type ethernet ifname "${uplink}" con-name "${profile}" connection.autoconnect yes ipv4.method auto ipv6.method auto >/dev/null 2>&1 || true
        fi
        nmcli connection up "${profile}" >/dev/null 2>&1 || true
      fi
    fi
  elif command -v dhclient >/dev/null 2>&1; then
    dhclient -1 -v "${uplink}" >/dev/null 2>&1 || true
  fi

  for _ in {1..40}; do
    if ip -4 addr show dev "${uplink}" scope global 2>/dev/null | grep -q 'inet ' \
      && ip -4 route show default dev "${uplink}" 2>/dev/null | grep -q .; then
      echo "LightNAS network: DHCP is active on ${uplink}."
      return 0
    fi
    sleep 1
  done

  echo "LightNAS network: ${uplink} is detected but did not receive a DHCP lease/default route." >&2
  return 1
}

default_dev="$(ip -4 route show default 2>/dev/null | awk 'NR==1 {for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')"
default_gw="$(ip -4 route show default 2>/dev/null | awk 'NR==1 {for(i=1;i<=NF;i++) if($i=="via"){print $(i+1); exit}}')"

# Changing the active management uplink is a network cutover. Preferences
# only declare intent: never disconnect/reconfigure an existing uplink during
# unattended install, upgrades or retries.
if [[ -n "${preferred_uplink}" && "${default_dev}" != "${preferred_uplink}" ]]; then
  printf 'LIGHTNAS_NETWORK_MODE=pending-uplink\nLIGHTNAS_UPLINK=%s\nLIGHTNAS_NETWORK_ERROR=approved-uplink-switch-required\n' "${preferred_uplink}" >"${STATE_FILE}"
  echo "LightNAS network: saved uplink change requires a separately approved management migration." >&2
  exit 0
fi

if [[ -z "${default_dev}" ]]; then
  bootstrap_wired_dhcp "${preferred_uplink}" || true
  default_dev="$(ip -4 route show default 2>/dev/null | awk 'NR==1 {for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')"
  default_gw="$(ip -4 route show default 2>/dev/null | awk 'NR==1 {for(i=1;i<=NF;i++) if($i=="via"){print $(i+1); exit}}')"
fi

if [[ -z "${default_dev}" ]]; then
  pending_uplink="$(discover_wired_uplink || true)"
  printf 'LIGHTNAS_NETWORK_MODE=pending-uplink\nLIGHTNAS_UPLINK=%s\n' "${pending_uplink}" >"${STATE_FILE}"
  echo "LightNAS network: no LAN DHCP/default route is available; guest networking will wait instead of creating a private fallback bridge." >&2
  exit 0
fi

# Read-only existing topology verification. A host that has already been
# bridged by its operator may continue using that existing configuration,
# but automated install/repair MUST NOT alter a management uplink, NM
# profiles, persistent networkd files, libvirt networks or bridge sysctls.
if [[ "${default_dev}" == "${BRIDGE}" ]]; then
  uplink="$(bridge_uplink || true)"
  printf 'LIGHTNAS_NETWORK_MODE=bridge\nLIGHTNAS_LAN_BRIDGE=%s\nLIGHTNAS_UPLINK=%s\n' "${BRIDGE}" "${uplink}" >"${STATE_FILE}"
  echo "LightNAS network: existing ${BRIDGE} bridge detected; preserving host and guest networking."
  exit 0
fi

# Wi-Fi station interfaces cannot be transparently bridged. Discovery here
# preserves the existing uplink; existing separately configured NAT stays put.
if [[ -d "/sys/class/net/${default_dev}/wireless" ]] || {
  command -v iw >/dev/null 2>&1 && iw dev "${default_dev}" info >/dev/null 2>&1
}; then
  printf 'LIGHTNAS_NETWORK_MODE=wifi-nat\nLIGHTNAS_UPLINK=%s\n' "${default_dev}" >"${STATE_FILE}"
  echo "LightNAS network: Wi-Fi uplink ${default_dev} preserved; no bridge cutover attempted."
  exit 0
fi

if is_virtual_name "${default_dev}"; then
  printf 'LIGHTNAS_NETWORK_MODE=virtual-uplink\nLIGHTNAS_UPLINK=%s\n' "${default_dev}" >"${STATE_FILE}"
  echo "LightNAS network: virtual uplink ${default_dev} preserved."
  exit 0
fi

# Physical ethernet cutovers require an immutable, approved, journalled plan
# with verified reboot-safe rollback. That transaction is not implemented.
# Even an operator-provided environment variable must NEVER bypass this.
# Preserve working management DHCP/static configuration and guest networks.
printf 'LIGHTNAS_NETWORK_MODE=pending-uplink\nLIGHTNAS_UPLINK=%s\nLIGHTNAS_NETWORK_ERROR=physical-bridge-approval-required\n' \
  "${default_dev}" >"${STATE_FILE}"
echo "LightNAS network: physical management uplink ${default_dev} preserved. Guest bridge migration needs an approved rollback-capable transaction." >&2
exit 0
