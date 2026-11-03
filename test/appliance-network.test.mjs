import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

test('LXC appliance networking follows the host LAN when direct nested LAN is available', async () => {
  const [network, provision, helper, agent, runtime, ui] = await Promise.all([
    readFile(new URL('../scripts/configure-appliance-network.sh', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/provision-runtimes.sh', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/proxmox-lxc-install.sh', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/lightnas-host-agent.py', import.meta.url), 'utf8'),
    readFile(new URL('../src/runtimes-next.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);

  assert.match(network, /LIGHTNAS_NETWORK_MODE=nested-macvlan/);
  assert.match(network, /LIGHTNAS_CONTAINER_PARENT/);
  assert.match(network, /LIGHTNAS_NESTED_LAN_MODE:-auto/);
  assert.match(network, /systemd-detect-virt --container/);
  assert.match(network, /LIGHTNAS_NETWORK_MODE=bridge/);
  assert.match(network, /LIGHTNAS_NETWORK_MODE=pending-uplink/);

  assert.match(provision, /legacy LXC guest configuration/);
  assert.match(provision, /192\.168\.122\.1/);
  assert.match(provision, /network_mode.*lxc-nat/);
  assert.match(provision, /lightnas0\|lxcbr0\|virbr0/);

  assert.match(helper, /Keep the existing LightNAS eth0\/net0 connection and IP exactly as-is/);
  assert.match(helper, /firewall=0/);

  assert.match(agent, /\{"nested-macvlan", "nested-ipvlan"\}/);
  assert.match(agent, /lxc\.net\.0\.macvlan\.mode = bridge/);
  assert.match(agent, /lxc\.net\.0\.ipvlan\.mode = l2/);
  assert.match(agent, /LIGHTNAS_NETWORK_MODE.*lxc-nat/);
  assert.match(runtime, /LightNAS managed NAT/);
  assert.match(ui, /LightNAS host networking/);
  assert.match(ui, /network-table-row/);
});


test('network bootstrap service never performs a nested management-interface cutover', async () => {
  const [installer, network] = await Promise.all([
    readFile(new URL('../install.sh', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/configure-appliance-network.sh', import.meta.url), 'utf8')
  ]);
  assert.match(installer, /lightnas-network-bootstrap\.service/);
  assert.match(network, /Do not move the management address/);
  assert.doesNotMatch(network, /trying transparent host-LAN bridge/);
});

test('unattended physical DHCP fallback cannot take over existing host policy (#449)', async () => {
  const network = await readFile(new URL('../scripts/configure-appliance-network.sh', import.meta.url), 'utf8');
  const guard = network.match(/^has_existing_network_ownership\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(guard, 'host network ownership preflight must exist');
  assert.ok(network.indexOf('if has_existing_network_ownership; then') <
            network.indexOf('ip link set "${uplink}" up'),
            'ownership check must precede any device mutation');
  assert.doesNotMatch(network, /^\s*nmcli device connect /m,
                      'may activate foreign/dormant management profiles');
  assert.doesNotMatch(network, /^\s*nmcli connection modify /m,
                      'may modify a foreign physical management profile');
  assert.match(network, /existing-network-policy-approval-required/);
  assert.match(network, /LIGHTNAS_NETWORK_ERROR=%s/);

  // Exercise the exact preflight function with read-only mocked host commands.
  // Both IPv6-only management and dormant NM profiles must refuse takeover.
  for (const owner of ['ipv6', 'nm-profile', 'nm-failed']) {
    const script = `set -Eeuo pipefail
ip() {
  if [[ "$TEST_OWNER" == "ipv6" && "$1" == "-6" ]]; then
    printf '2: eth0 inet6 2001:db8::1/64 scope global\\n'
  fi
}
nmcli() {
  if [[ "$TEST_OWNER" == "nm-failed" ]]; then
    return 1
  fi
  if [[ "$TEST_OWNER" == "nm-profile" ]]; then
    printf '123e4567-e89b-12d3-a456-426614174000\\n'
  fi
}
${guard}
has_existing_network_ownership
`;
    assert.doesNotThrow(
      () => execFileSync('bash', ['-c', script],
        { env: { ...process.env, TEST_OWNER: owner }, stdio: 'pipe' }),
      'existing host ownership must block unattended DHCP for '+owner
    );
  }
});

test('ownership inspection errors and long ifupdown policy fail closed', async () => {
  const network = await readFile(new URL('../scripts/configure-appliance-network.sh', import.meta.url), 'utf8');
  const guard = network.match(/^has_existing_network_ownership\(\) \{[\s\S]*?^\}/m)[0];
  for (const scenario of ['ip-failed', 'long-policy', 'policy-failed', 'include-policy']) {
    const script = `set -Eeuo pipefail
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
ip() { [[ "$TEST_SCENARIO" != ip-failed ]]; }
nmcli() { return 0; }
mkdir -p "$work/interfaces.d"
case "$TEST_SCENARIO" in
  long-policy) for ((i=0; i<20000; i++)); do printf 'iface eth%s inet static\\n' "$i"; done > "$work/interfaces" ;;
  include-policy) printf 'source /custom/network/*\\n' > "$work/interfaces" ;;
  policy-failed) touch "$work/interfaces"; awk() { return 2; } ;;
esac
${guard.replaceAll('/etc/network/', '${work}/').replaceAll('/etc/', '${work}/etc/').replaceAll('/run/', '${work}/run/')}
has_existing_network_ownership
`;
    execFileSync('bash', ['-c', script], { env: { ...process.env, TEST_SCENARIO: scenario }, stdio: 'pipe' });
  }
});

test('NM profiles appearing after preflight or failed enumeration prevent mutations', async () => {
  const network = await readFile(new URL('../scripts/configure-appliance-network.sh', import.meta.url), 'utf8');
  const bootstrap = network.match(/^bootstrap_wired_dhcp\(\) \{[\s\S]*?^\}/m)[0];
  for (const scenario of ['enumeration-failed', 'long-profiles']) {
    const script = `set -Eeuo pipefail
ip() { if [[ "$1" == link ]]; then echo MUTATION; fi; }
systemctl() { echo MUTATION; }
has_existing_network_ownership() { return 1; }
nmcli() {
  if [[ "$*" == '-t -f NAME connection show' ]]; then
    [[ "$TEST_SCENARIO" != enumeration-failed ]] || return 1
    printf 'lightnas-auto-eth0\\n'
    for ((i=0; i<20000; i++)); do printf 'foreign-%s\\n' "$i"; done
  else echo MUTATION; fi
}
${bootstrap}
bootstrap_error=''
if bootstrap_wired_dhcp eth0; then exit 20; fi
[[ "$bootstrap_error" == existing-network-policy-approval-required ]]
`;
    const output = execFileSync('bash', ['-c', script], { env: { ...process.env, TEST_SCENARIO: scenario }, encoding: 'utf8' });
    assert.doesNotMatch(output, /MUTATION/);
  }
});


test('vendor and runtime network policy prevents first-boot DHCP takeover', async () => {
  const network = await readFile(new URL('../scripts/configure-appliance-network.sh', import.meta.url), 'utf8');
  const guard = network.match(/^has_existing_network_ownership\(\) \{[\s\S]*?^\}/m)[0];
  const isolatedGuard = guard.replaceAll('/etc/', '${work}/etc/')
    .replaceAll('/run/', '${work}/run/').replaceAll('/usr/lib/', '${work}/usr/lib/')
    .replaceAll(' /lib/', ' ${work}/lib/');
  const policies = [
    'usr/lib/systemd/network/80-management.network',
    'lib/systemd/network/80-management.network',
    'run/netplan/management.yaml',
    'lib/netplan/management.yaml',
    'run/NetworkManager/system-connections/management.nmconnection',
    'usr/lib/NetworkManager/system-connections/management.nmconnection',
    'etc/NetworkManager/system-connections/legacy-profile'
  ];
  for (const policy of [...policies, 'none']) {
    const script = `set -Eeuo pipefail
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
ip() { return 0; }
nmcli() { return 0; }
if [[ "$TEST_POLICY" != none ]]; then
  mkdir -p "$work/$(dirname "$TEST_POLICY")"
  printf '[Network]\\nDHCP=yes\\n' > "$work/$TEST_POLICY"
fi
${isolatedGuard}
if has_existing_network_ownership; then printf owned; else printf unowned; fi
`;
    const output = execFileSync('bash', ['-c', script], {
      env: { ...process.env, TEST_POLICY: policy }, encoding: 'utf8'
    });
    assert.equal(output, policy === 'none' ? 'unowned' : 'owned', policy);
  }
});
