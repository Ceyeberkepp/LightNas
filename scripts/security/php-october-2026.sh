#!/usr/bin/env bash
# LightNAS security: CVE-2026-109618 / CVE-2026-109619
# Read-only by default. Explicit --patch-host updates installed trusted APT packages.
set -Eeuo pipefail
mode="${1:---audit}"
[[ "$mode" == --audit || "$mode" == --patch-host ]] || { echo "Usage: $0 [--audit|--patch-host]" >&2; exit 2; }
echo 'PHP emergency response: CVE-2026-109618 CVE-2026-109619'
echo 'Upstream fixes: PHP 8.5.12, 8.4.27, 8.3.36, 8.2.35'
echo 'Distribution backports must be verified against BOTH CVEs.'
command -v dpkg-query >/dev/null || { echo "Non-Debian host: use distribution security updates." >&2; exit 2; }
mapfile -t pkgs < <(dpkg-query -W -f='${binary:Package} ${db:Status-Abbrev}\n' 'php*' 'libapache2-mod-php*' 2>/dev/null | awk '$2 ~ /^ii/ {print $1}' | sort -u || true)
echo 'Installed host PHP packages:'
printf '  %s\n' "${pkgs[@]}"
if [[ "$mode" == --patch-host ]]; then
  [[ "$EUID" -eq 0 ]] || { echo 'Run as root to patch.' >&2; exit 2; }
  if ((${#pkgs[@]})); then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade "${pkgs[@]}"
  else
    echo 'No APT-managed host PHP packages to upgrade.'
  fi
fi
echo 'PHP executable versions (check vendor backports if lower than upstream fixed release):'
for bin in /usr/bin/php /usr/bin/php[0-9].* /usr/sbin/php-fpm[0-9].* /usr/bin/php-cgi[0-9].*; do
  [[ -x "$bin" ]] || continue
  "$bin" -v 2>/dev/null | head -1 || true
done
echo 'Check distribution changelogs: apt changelog php8.4-common (branch varies).'
if command -v docker >/dev/null 2>&1; then
  echo 'Running containers — PHP images require separate rebuild/recreation:'
  docker ps --format '  {{.Names}}  {{.Image}}' 2>/dev/null || true
fi
if command -v lxc-ls >/dev/null 2>&1; then
  echo 'LXC instances — audit and patch individually:'
  lxc-ls 2>/dev/null || true
fi
echo 'Also audit Apache mod_php, PHP-FPM, stopped containers, VMs, and app-store images.'
echo 'This is not a complete verification of deployed PHP safety.'
[[ "$mode" == --audit ]] || echo 'Schedule web service restart and validate patched version/vendor CVE fix; restart is NOT automatic.'
