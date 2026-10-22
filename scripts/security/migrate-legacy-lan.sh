#!/usr/bin/env bash
# Migrate legacy LightNAS LXC veth on lightnas0 to existing eth0 LAN.
# Review-only by default. --apply changes guest config during downtime.
set -Eeuo pipefail
action="${1:---check}"
[[ "$action" == "--check" || "$action" == "--apply" ]] || { echo "Usage: $0 [--check|--apply]"; exit 2; }
[[ "$(id -u)" == 0 ]] || { echo "Run as root" >&2; exit 2; }
ip link show eth0 >/dev/null
echo "Host management interface:"
ip -4 address show dev eth0
ip -4 route show default
echo "Legacy bridge-connected LXC guests:"
mapfile -t guests < <(grep -lE '^lxc\.net\.0\.link[[:space:]]*=[[:space:]]*lightnas0[[:space:]]*$' /var/lib/lxc/*/config 2>/dev/null || true)
for config in "${guests[@]}"; do
  name="$(basename "$(dirname "$config")")"
  printf '  %s (%s)\n' "$name" "$(lxc-info -n "$name" -sH 2>/dev/null || true)"
done
if [[ "$action" == "--check" ]]; then
  echo "No changes. Apply only in a guest maintenance window: $0 --apply"
  exit 0
fi
# Fail closed when eth0 cannot create macvlan; never change host management IP.
probe="lnmtest-$$"
if ! ip link add link eth0 name "$probe" type macvlan mode bridge; then
  echo "eth0 does not permit macvlan passthrough. No changes made." >&2
  exit 1
fi
ip link delete "$probe"
if (( ${#guests[@]} )); then
  echo "Migrating running guests requires planned downtime."
fi
for config in "${guests[@]}"; do
  name="$(basename "$(dirname "$config")")"
  backup="${config}.before-eth0-$(date +%Y%m%d%H%M%S)"
  cp -a "$config" "$backup"
  running=0
  [[ "$(lxc-info -n "$name" -sH 2>/dev/null || true)" == RUNNING ]] && running=1
  if (( running )); then
    lxc-stop -n "$name" -t 60 || { echo "Could not stop $name. No edits applied to $name." >&2; exit 1; }
  fi
  # Modify only the host-side LXC connection; do not overwrite guest static IP,
  # routes, DNS, or metadata.
  # LXC requires lxc.net.0.type BEFORE all other lxc.net.0.* keys.
  # Appending it after the existing name/hwaddr causes a parser failure.
  python3 - "$config" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
lines = path.read_text().splitlines()
old_keys = ("lxc.net.0.type", "lxc.net.0.link", "lxc.net.0.macvlan.mode")
kept = [line for line in lines if not any(line.strip().startswith(key + " ") or line.strip().startswith(key + "=") for key in old_keys)]
first = next((i for i, line in enumerate(kept) if line.strip().startswith("lxc.net.0.")), len(kept))
kept[first:first] = ["lxc.net.0.type = macvlan", "lxc.net.0.link = eth0", "lxc.net.0.macvlan.mode = bridge"]
path.write_text("\n".join(kept) + "\n")
PY
  if (( running )); then
    if ! lxc-start -n "$name" -d; then
      echo "Failed to restart $name on eth0; restoring configuration" >&2
      cp -a "$backup" "$config"
      lxc-start -n "$name" -d || true
      exit 1
    fi
  fi
  echo "$name switched to eth0; verify application connectivity and guest IP/DNS. Backup: $backup"
done
if grep -qlE '^lxc\.net\.0\.link[[:space:]]*=[[:space:]]*lightnas0[[:space:]]*$' /var/lib/lxc/*/config 2>/dev/null; then
  echo "Guest still depends on lightnas0; preserving legacy bridge." >&2
  exit 1
fi
# Prevent legacy DHCP and bridge from returning on reboot; stopping the unit
# must NOT invoke ExecStop: unrelated VM/guest traffic may still depend on it.
systemctl disable lightnas-container-network.service || true
systemctl mask lightnas-container-network.service || true
echo "Legacy network disabled for future boot; current bridge retained until all guests/VMs are verified and an approved teardown."
