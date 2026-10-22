import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('legacy guest migration keeps eth0 parent and inserts network type first', async () => {
  const script = await readFile(new URL('../scripts/security/migrate-legacy-lan.sh', import.meta.url), 'utf8');
  assert.match(script, /lxc\.net\.0\.type = macvlan/);
  assert.match(script, /lxc\.net\.0\.link = eth0/);
  assert.match(script, /kept\[first:first\]/);
  assert.match(script, /lxc\.net\.0\.macvlan\.mode = bridge/);
  assert.match(script, /before-eth0-/);
});
test('legacy migration never fabricates IPs or tears down running bridge', async () => {
  const script = await readFile(new URL('../scripts/security/migrate-legacy-lan.sh', import.meta.url), 'utf8');
  assert.match(script, /legacy 10\.77 static IP/);
  assert.doesNotMatch(script, /systemctl disable --now lightnas-container-network/);
  assert.doesNotMatch(script, /ip link delete lightnas0/);
});
