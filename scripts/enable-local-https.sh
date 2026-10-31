#!/usr/bin/env bash
# One-time, operator-invoked HTTPS migration for an existing LightNAS appliance.
# Only the LightNAS management service is restarted; no disk/network/VM jobs.
set -Eeuo pipefail

[[ "${EUID}" -eq 0 ]] || { echo "Run as root: sudo bash scripts/enable-local-https.sh" >&2; exit 1; }
for binary in systemctl openssl curl python3 hostname runuser; do
  command -v "$binary" >/dev/null 2>&1 || { echo "Missing prerequisite: $binary" >&2; exit 1; }
done
id -g lightnas >/dev/null 2>&1 || { echo "The lightnas service group is missing." >&2; exit 1; }
unit="lightnas.service"
systemctl is-active --quiet "$unit" || { echo "$unit must be running before changing its listener." >&2; exit 1; }

cert_dir=/etc/lightnas/tls
cert="$cert_dir/nas.crt"
key="$cert_dir/nas.key"
override_dir=/etc/systemd/system/lightnas.service.d
override="$override_dir/20-local-https.conf"
marker="# Managed by LightNAS local HTTPS migration; do not edit manually."
umask 077

# Identify IPs on this machine. Never ship someone else's certificate or IP.
mapfile -t current_ips < <(python3 - <<'PY_IPS'
import ipaddress
import subprocess
try:
    values = subprocess.check_output(['hostname', '-I'], text=True).split()
except (OSError, subprocess.CalledProcessError):
    values = []
seen = set()
for raw in values:
    try:
        value = ipaddress.ip_address(raw)
    except ValueError:
        continue
    if isinstance(value, ipaddress.IPv4Address) and not value.is_loopback and not value.is_unspecified and str(value) not in seen:
        seen.add(str(value))
        print(value)
PY_IPS
)
if [[ "${#current_ips[@]}" -eq 0 ]]; then
  echo "No current LAN IPv4 address was detected; refusing to issue an IP-specific certificate." >&2
  exit 1
fi
# Refuse to overwrite an existing (possibly customer-issued) certificate.
if [[ -e "$cert" && ! -f "$cert" ]] || [[ -e "$key" && ! -f "$key" ]]; then
  echo "Unexpected TLS file type. Check $cert_dir manually." >&2; exit 1
fi
if [[ -e "$cert" && ! -e "$key" ]] || [[ ! -e "$cert" && -e "$key" ]]; then
  echo "Incomplete existing TLS certificate/key pair. Refusing to replace it." >&2; exit 1
fi
if [[ -f "$override" ]] && ! grep -Fxq "$marker" "$override"; then
  echo "An unmanaged LightNAS TLS override already exists; refusing to replace it." >&2; exit 1
fi

if [[ -f "$cert" ]]; then
  openssl x509 -in "$cert" -noout >/dev/null
  openssl pkey -in "$key" -noout >/dev/null
  for ip in 127.0.0.1 "${current_ips[@]}"; do
    if ! openssl x509 -in "$cert" -noout -checkip "$ip" | grep -q 'does match'; then
      echo "Existing TLS certificate does not cover $ip. Renew it through an approved certificate rotation before switching." >&2
      exit 1
    fi
  done
else
  install -d -m 0750 -o root -g lightnas "$cert_dir"
  # Isolate temporary key material so EXIT cleanup runs even when OpenSSL
  # or an install step fails. A top-level RETURN trap does not run on exit.
  (
    tmp="$(mktemp -d "$cert_dir/.issue.XXXXXX")"
    complete=0
    # If either install step fails, leave neither half of the certificate pair.
    trap 'if [[ "$complete" -ne 1 ]]; then rm -f -- "$key" "$cert"; fi; rm -rf -- "$tmp"' EXIT
    san="DNS:localhost,IP:127.0.0.1"
    for ip in "${current_ips[@]}"; do san+=",IP:$ip"; done
    openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 397 \
      -keyout "$tmp/nas.key" -out "$tmp/nas.crt" \
      -subj "/CN=LightNAS Local" \
      -addext "subjectAltName=$san" -addext "extendedKeyUsage=serverAuth" >/dev/null 2>&1
    install -o root -g lightnas -m 0640 "$tmp/nas.key" "$key"
    install -o root -g lightnas -m 0644 "$tmp/nas.crt" "$cert"
    complete=1
  )
fi

# A self-signed certificate must be trusted by the client to authenticate the
# appliance. First ensure the lightnas user can read its existing key.
runuser -u lightnas -- test -r "$cert" || { echo "lightnas user cannot read the certificate." >&2; exit 1; }
runuser -u lightnas -- test -r "$key" || { echo "lightnas user cannot read the TLS key." >&2; exit 1; }

if curl --silent --show-error --fail --max-time 6 --cacert "$cert" \
  https://127.0.0.1:3080/api/status >/dev/null 2>&1; then
  echo "LightNAS HTTPS is already active; no service restart needed."
  for ip in "${current_ips[@]}"; do echo "Open: https://$ip:3080"; done
  exit 0
fi
if ! curl --silent --show-error --fail --max-time 6 \
  http://127.0.0.1:3080/api/status >/dev/null; then
  echo "Current HTTP listener failed health validation. Not touching the service." >&2
  exit 1
fi

# Save any previously managed override before the single controlled restart.
previous="$(mktemp)"
had_previous=0
if [[ -f "$override" ]]; then
  cp -p "$override" "$previous"
  had_previous=1
fi
changed=0
rollback() {
  local rc=$?
  trap - EXIT
  if [[ "$rc" -ne 0 && "$changed" -eq 1 ]]; then
    echo "HTTPS validation failed. Restoring previous LightNAS service settings..." >&2
    if [[ "$had_previous" -eq 1 ]]; then
      cp -p "$previous" "$override"
    else
      rm -f "$override"
    fi
    systemctl daemon-reload || true
    systemctl restart "$unit" || true
    if curl --silent --fail --max-time 8 http://127.0.0.1:3080/api/status >/dev/null; then
      echo "Previous HTTP service restored. Check journalctl -u lightnas before retrying." >&2
    else
      echo "Rollback attempted but prior HTTP health is unconfirmed. Check journalctl -u lightnas immediately." >&2
    fi
  fi
  rm -f "$previous"
  exit "$rc"
}
trap rollback EXIT
install -d -m 0755 "$override_dir"
changed=1
cat > "$override" <<EOF
$marker
[Service]
Environment=LIGHTNAS_TLS_CERT_FILE=$cert
Environment=LIGHTNAS_TLS_KEY_FILE=$key
EOF
chmod 0644 "$override"
systemctl daemon-reload
echo "Switching LightNAS management port 3080 from HTTP to HTTPS (one service restart)..."
systemctl restart "$unit"
healthy=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if systemctl is-active --quiet "$unit" && curl --silent --fail --max-time 5 \
      --cacert "$cert" https://127.0.0.1:3080/api/status >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done
if [[ "$healthy" -ne 1 ]]; then
  echo "HTTPS health check failed; triggering rollback." >&2
  exit 1
fi
changed=0
echo "LightNAS HTTPS is enabled on port 3080."
for ip in "${current_ips[@]}"; do echo "Open: https://$ip:3080"; done
echo "The appliance has a unique self-signed certificate. Trust it on each client or install a trusted certificate that includes the IP SAN."
echo "Plain HTTP on port 3080 will no longer work; update any customer-owned reverse proxy/tunnel upstream explicitly."
