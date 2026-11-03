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
