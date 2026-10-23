import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { supportedMigrationSources } from '../src/migration-planner.mjs';
import { inspectMigrationSource } from '../src/migration-discovery.mjs';

test('migration source options include four independent platforms', () => {
  assert.deepEqual(supportedMigrationSources().map(item => item.id),
    ['vmware','proxmox','truenas','redhat']);
});
test('discovery rejects localhost, unsupported sources, and absent tokens without network calls', async () => {
  await assert.rejects(inspectMigrationSource({ source:'bogus',host:'10.0.0.2',token:'x' }), /unsupported/);
  await assert.rejects(inspectMigrationSource({ source:'proxmox',host:'localhost',token:'x' }), /loopback/);
  await assert.rejects(inspectMigrationSource({ source:'proxmox',host:'10.0.0.2',token:'' }), /required/);
  await assert.rejects(inspectMigrationSource({ source:'redhat',host:'10.0.0.2',token:'x' }), /inventory export/);
});
test('migration UI does not claim transfer support or persist credentials', async () => {
  const ui=await readFile(new URL('../public/migration-center.html',import.meta.url),'utf8');
  const server=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
  assert.match(ui,/Transfer — not available yet/);
  assert.match(ui,/\$\('token'\)\.value=''/);
  assert.match(server,/\/api\/migration\/inspect/);
  assert.match(server,/Administrator session required/);
});
