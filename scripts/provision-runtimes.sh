#!/usr/bin/env bash
# Run from install.sh after the lightnas account exists. Never migrate existing guests during provisioning.
set -Eeuo pipefail

status_file="${LIGHTNAS_RUNTIME_STATUS_FILE:-/var/lib/lightnas/runtime-status.txt}"
runtime_env="${LIGHTNAS_RUNTIME_ENV_FILE:-/etc/lightnas/runtime.env}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
network_state=/etc/lightnas/network.env
network_mode=""
lan_bridge="virbr0"
container_parent=""
if [[ ${EUID} -eq 0 && -f "${script_dir}/configure-appliance-network.sh" ]]; then
  bash "${script_dir}/configure-appliance-network.sh" || echo "Warning: automatic appliance LAN bridge configuration needs attention." >&2
fi
if [[ -r "${network_state}" ]]; then
  # shellcheck disable=SC1090
  source "${network_state}"
  network_mode="${LIGHTNAS_NETWORK_MODE:-}"
  lan_bridge="${LIGHTNAS_LAN_BRIDGE:-virbr0}"
  container_parent="${LIGHTNAS_CONTAINER_PARENT:-${LIGHTNAS_UPLINK:-}}"
fi
lan_bridge_ready=0
if [[ "${network_mode}" == "bridge" ]] && ip link show "${lan_bridge}" 2>/dev/null | grep -q 'UP'; then
  lan_bridge_ready=1
fi

mkdir -p "$(dirname "${status_file}")" "$(dirname "${runtime_env}")"
if [[ ! -e "$runtime_env" ]]; then install -m 0600 /dev/null "$runtime_env"; fi
chmod 0600 "$runtime_env"

# Legacy networks remain in place when uplink discovery fails.
# Retiring active bridges/services requires an approved, durable migration.
#
set_flag() {
  local key="$1" value="$2"
  sed -i "/^${key}=/d" "$runtime_env"
  printf '%s=%s\n' "$key" "$value" >> "$runtime_env"
}
report() { printf '%s: %s\n' "$1" "$2" | tee -a "${status_file}"; }
: > "${status_file}"
chmod 0644 "${status_file}"

# Guest DHCP profiles and metadata are preserved during installer/upgrade.
# Network migration requires an immutable approved plan, durable prior-state
# snapshots, graceful quiescence and independently validated rollback.
#
# A nested LightNAS appliance should work without a separate operator flag.
# Enable the feature automatically; the privileged host agent still performs
# cgroup, namespace and veth capability checks before allowing LXC creation.
if systemd-detect-virt --container >/dev/null 2>&1; then
  set_flag LIGHTNAS_ALLOW_NESTED_LXC 1
fi

# Native system containers are built into LightNAS through LXC/liblxc.
if command -v lxc-create >/dev/null 2>&1 && command -v lxc-start >/dev/null 2>&1; then
  # Read-only legacy guest discovery: no guest shutdown/redefinition/restart.
  # Older guest links: lightnas0|lxcbr0|virbr0. Preserve the guest's config.
  migration_pending=0
  for config in /var/lib/lxc/*/config; do
    [[ -f "$config" ]] || continue
    if grep -Eq '^[[:space:]]*lxc\.net\.[0-9]+\.link[[:space:]]*=[[:space:]]*(lightnas0|lxcbr0|virbr0)([[:space:]]|$)' "$config"; then
      migration_pending=$((migration_pending + 1))
    fi
  done
  if [[ "$migration_pending" -gt 0 ]]; then
    report Migration "$migration_pending legacy LXC guest configuration(s) preserved; LAN migration requires a separately approved, rollback-capable plan"
  fi
  # Do not create lightnas0 as a NAT router or run a private DHCP service.
  # Guest network is direct LAN only; a bridge is a layer-2 passthrough,
  # not a new 10.77.0.0/24 network. In nested Proxmox LXC, an
  # unavailable uplink is an explicit setup error, never a NAT fallback.
  # Existing legacy NAT services/configuration are left untouched here:
  # dismantling active bridges requires a separately approved migration.
  if systemd-detect-virt --container >/dev/null 2>&1 && [[ "${LIGHTNAS_ALLOW_NESTED_LXC:-0}" != "1" ]]; then
    report Containers 'native LXC installed, but this appliance is itself in a container and nested LXC was not enabled'
  elif [[ "${network_mode}" =~ ^nested-(macvlan|ipvlan)$ && -n "${container_parent}" ]]; then
    report Containers "native LXC/liblxc ready on ${container_parent} ${network_mode#nested-}; containers receive real LAN addresses"
  elif [[ "${lan_bridge_ready}" == "1" ]]; then
    report Containers "native LXC/liblxc ready on ${lan_bridge}; containers receive real LAN addresses"
  elif [[ "${network_mode}" == "pending-uplink" ]]; then
    report Containers 'native LXC/liblxc installed; waiting for permitted LAN passthrough; check Proxmox LXC network capabilities and DHCP'
  elif ip link show lightnas0 2>/dev/null | grep -q 'UP' \
    && ip -4 address show dev lightnas0 2>/dev/null | grep -q '10\.77\.0\.1/24'; then
    report Containers 'native LXC/liblxc ready on lightnas0 (10.77.0.0/24 NAT fallback)'
  else
    report Containers 'native LXC/liblxc installed, but the LightNAS container bridge is not active'
  fi
else
  report Containers 'native LXC/liblxc tools are not installed on this host'
fi

# Docker/OCI is optional and is used only by the App Store. Do not install or
# grant Docker-socket access unless the operator explicitly opts in.
if [[ "${LIGHTNAS_ENABLE_DOCKER_APPS:-1}" != "1" ]]; then
  set_flag LIGHTNAS_DOCKER_ENABLED 0
  report Apps 'optional Docker/OCI engine disabled (set LIGHTNAS_ENABLE_DOCKER_APPS=1 to enable)'
else
  if ! command -v docker >/dev/null 2>&1; then
    if ! apt-get install -y docker.io; then report Apps 'docker.io package installation failed'; fi
  fi
  if command -v docker >/dev/null 2>&1; then
    systemctl enable --now docker.service >/dev/null 2>&1 || true
    for attempt in {1..5}; do
      docker info >/dev/null 2>&1 && break
      sleep 1
    done
    if docker info >/dev/null 2>&1; then
      if getent group docker >/dev/null 2>&1; then usermod -aG docker lightnas; fi
      if runuser -u lightnas -- docker info >/dev/null 2>&1; then
        set_flag LIGHTNAS_DOCKER_ENABLED 1
        # Catalog applications publish these reviewed web ports on the
        # LightNAS LAN address. Authorize them during the same installation so
        # users never configure a second firewall or hypervisor port forward.
        if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
          for app_port in 3000 3001 8081 8082 8083 8096; do
            ufw allow "${app_port}/tcp" comment 'LightNAS managed app' >/dev/null 2>&1 || true
          done
        fi
        report Apps 'Docker/OCI engine ready; managed application publishing enabled'
      else
        set_flag LIGHTNAS_DOCKER_ENABLED 0
        report Apps 'Docker is running but inaccessible to the LightNAS service account'
      fi
    else
      set_flag LIGHTNAS_DOCKER_ENABLED 0
      report Apps 'Docker could not start'
    fi
  else
    set_flag LIGHTNAS_DOCKER_ENABLED 0
    report Apps 'Docker not installed'
  fi
fi

if [[ "${LIGHTNAS_SKIP_VM:-0}" == "1" ]]; then
  set_flag LIGHTNAS_VM_ENABLED 0
  set_flag LIGHTNAS_VM_ACCELERATION disabled
  report VMs 'skipped by operator (LIGHTNAS_SKIP_VM=1)'
else
  # Provision only a native ISA machine emulator frontend: virt-install always
  # uses KVM and never selects QEMU's translated/TCG guest CPU fallback.
  host_arch="$(dpkg --print-architecture)"
  case "$host_arch" in
    amd64) vm_binary=qemu-system-x86_64; vm_package=qemu-system-x86 ;;
    i386) vm_binary=qemu-system-i386; vm_package=qemu-system-x86 ;;
    arm64) vm_binary=qemu-system-aarch64; vm_package=qemu-system-arm ;;
    armhf|armel) vm_binary=qemu-system-arm; vm_package=qemu-system-arm ;;
    riscv64) vm_binary=qemu-system-riscv64; vm_package=qemu-system-misc ;;
    *) vm_binary=; vm_package= ;;
  esac
  vm_packages_ready=1
  [[ -n "$vm_binary" ]] || vm_packages_ready=0
  for command in "$vm_binary" qemu-img virsh virt-install; do
    [[ -n "$command" ]] && command -v "$command" >/dev/null 2>&1 || vm_packages_ready=0
  done
  if [[ "$vm_packages_ready" == "1" ]] || { [[ -n "$vm_package" ]] && apt-get install -y --no-install-recommends "$vm_package" qemu-utils libvirt-daemon-system libvirt-clients virtinst; }; then
    # Nested/unprivileged LXC cannot chown host device nodes such as
    # /dev/urandom. libvirt's normal DAC manager can therefore abort a VM at
    # startup with "Failed to chown device /dev/urandom: Operation not
    # permitted". In nested appliance mode, run QEMU as container-root and
    # disable libvirt dynamic ownership changes. This is scoped only to the
    # outer-container case; bare-metal/VM installs keep the normal libvirt
    # account and ownership model.
    if systemd-detect-virt --container >/dev/null 2>&1; then
      install -d -m 0755 /etc/libvirt
      touch /etc/libvirt/qemu.conf
      sed -Ei '/^[[:space:]]*#?[[:space:]]*(remember_owner|dynamic_ownership|user|group)[[:space:]]*=/d' /etc/libvirt/qemu.conf
      cat >>/etc/libvirt/qemu.conf <<'EOF'

# LightNAS nested-LXC compatibility
user = "root"
group = "root"
dynamic_ownership = 0
remember_owner = 0
EOF
      systemctl try-restart virtqemud.service >/dev/null 2>&1 || true
      systemctl try-restart virtqemud.socket >/dev/null 2>&1 || true
      systemctl try-restart libvirtd.service >/dev/null 2>&1 || true
      systemctl try-restart libvirtd.socket >/dev/null 2>&1 || true
    fi
    # Debian installations may use modular virtqemud or legacy libvirtd.
    # A single socket activation attempt is not enough if a unit is masked,
    # missing, or failed at first boot. Try the available QEMU daemon first.
    libvirt_online=0
    for unit in virtqemud.socket virtqemud.service libvirtd.socket libvirtd.service; do
      if systemctl list-unit-files "$unit" --no-legend 2>/dev/null | grep -q "^$unit"; then
        systemctl enable --now "$unit" >/dev/null 2>&1 || true
        for attempt in {1..4}; do
          if virsh -c qemu:///system list --all >/dev/null 2>&1; then
            libvirt_online=1
            break
          fi
          sleep 1
        done
        [[ "$libvirt_online" == "1" ]] && break
      fi
    done
    if getent group libvirt >/dev/null 2>&1; then usermod -aG libvirt lightnas; fi
    # Refresh supplementary groups for the running control-plane service.
    # On Debian the socket commonly grants access to members of libvirt.
    if [[ "$libvirt_online" == "1" ]]; then
      systemctl try-restart lightnas.service >/dev/null 2>&1 || true
    else
      echo 'LightNAS: libvirt QEMU daemon did not become ready. Diagnostics:' >&2
      systemctl --no-pager --full status virtqemud.service libvirtd.service 2>&1 | tail -35 >&2 || true
    fi

    install -d -m 0755 /var/lib/libvirt/images
    setfacl -m u:lightnas:rwx /var/lib/libvirt/images >/dev/null 2>&1 || true

    for attempt in {1..6}; do
      virsh -c qemu:///system list --all >/dev/null 2>&1 && break
      sleep 1
    done

    if ! virsh -c qemu:///system pool-info default >/dev/null 2>&1; then
      pool_xml="$(mktemp)"
      cat >"$pool_xml" <<'EOF'
<pool type='dir'>
  <name>default</name>
  <target><path>/var/lib/libvirt/images</path></target>
</pool>
EOF
      virsh -c qemu:///system pool-define "$pool_xml" >/dev/null 2>&1 || true
      rm -f "$pool_xml"
    fi
    virsh -c qemu:///system pool-build default >/dev/null 2>&1 || true
    virsh -c qemu:///system pool-start default >/dev/null 2>&1 || true
    virsh -c qemu:///system pool-autostart default >/dev/null 2>&1 || true

    if [[ "${lan_bridge_ready}" == "1" ]]; then
      # Preserve existing libvirt network definitions, autostart and guests.
      if virsh -c qemu:///system net-info default >/dev/null 2>&1; then
        report Migration 'existing libvirt default network preserved; explicit network migration and rollback verification required'
      fi
    else
      if ! virsh -c qemu:///system net-info default >/dev/null 2>&1; then
        network_xml="$(mktemp)"
        cat >"$network_xml" <<'EOF'
<network>
  <name>default</name>
  <forward mode='nat'/>
  <bridge name='virbr0' stp='on' delay='0'/>
  <ip address='192.168.122.1' netmask='255.255.255.0'>
    <dhcp><range start='192.168.122.2' end='192.168.122.254'/></dhcp>
  </ip>
</network>
EOF
        virsh -c qemu:///system net-define "$network_xml" >/dev/null 2>&1 || true
        rm -f "$network_xml"
      fi
      virsh -c qemu:///system net-start default >/dev/null 2>&1 || true
      virsh -c qemu:///system net-autostart default >/dev/null 2>&1 || true
    fi

    if [[ "${network_mode}" == "lxc-nat" ]]; then
      report Migration 'legacy libvirt guest NICs preserved; installer will not change their network definitions'
    fi

    acceleration=unavailable
    if [[ -c /dev/kvm ]] && runuser -u lightnas -- test -r /dev/kvm && runuser -u lightnas -- test -w /dev/kvm; then
      acceleration=kvm
    fi
    set_flag LIGHTNAS_VM_ACCELERATION "$acceleration"

    for attempt in {1..5}; do
      runuser -u lightnas -- virsh -c qemu:///system list --all --name >/dev/null 2>&1 && break
      sleep 1
    done

    vm_network_ready=0
    if [[ "${lan_bridge_ready}" == "1" ]] && ip link show "${lan_bridge}" 2>/dev/null | grep -q 'UP'; then
      vm_network_ready=1
    elif virsh -c qemu:///system net-info default >/dev/null 2>&1; then
      vm_network_ready=1
    fi
    if runuser -u lightnas -- virsh -c qemu:///system list --all --name >/dev/null 2>&1 \
      && virsh -c qemu:///system pool-info default >/dev/null 2>&1 \
      && [[ "${vm_network_ready}" == "1" ]] \
      && command -v virt-install >/dev/null 2>&1; then
      if [[ "$acceleration" == kvm ]]; then
        set_flag LIGHTNAS_VM_ENABLED 1
        if [[ "${lan_bridge_ready}" == "1" ]]; then report VMs "native KVM/libvirt ready on ${lan_bridge} LAN bridge"; else report VMs 'native KVM/libvirt ready; hardware acceleration enabled'; fi
      else
        set_flag LIGHTNAS_VM_ENABLED 0
        report VMs 'Native VM creation unavailable: no accessible KVM acceleration on this host; software CPU emulation is disabled'
      fi
    else
      set_flag LIGHTNAS_VM_ENABLED 0
      report VMs 'QEMU/libvirt installed, but the local VM pool/network or LightNAS service access is not ready'
    fi
  else
    set_flag LIGHTNAS_VM_ENABLED 0
    set_flag LIGHTNAS_VM_ACCELERATION unavailable
    report VMs 'QEMU/libvirt package installation failed'
  fi
fi
