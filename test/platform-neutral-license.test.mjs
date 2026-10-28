import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('LightNAS is licensed and documented as a platform-neutral independent product', async () => {
  const [license, disclaimer, readme, install, integrations, app, pkg] = await Promise.all([
    readFile(new URL('../LICENSE', import.meta.url), 'utf8'),
    readFile(new URL('../DISCLAIMER.md', import.meta.url), 'utf8'),
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/INSTALLATION.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/INTEGRATIONS.md', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8')
  ]);

  assert.match(license, /LightNAS Development and Community Evaluation License/);
  assert.match(license, /Copyright \(c\) 2026 LightNAS Project/);
  assert.match(disclaimer, /LightNAS is an independent storage and infrastructure operating environment/);
  assert.match(disclaimer, /No responsibility for independently operated instances/);
  assert.match(disclaimer, /operator remains responsible/);
  assert.match(readme, /without requiring any particular external hypervisor platform/);
  assert.match(readme, /Optional external-platform integrations/);
  assert.match(install, /does not require any particular[\s\S]*hypervisor/);
  assert.doesNotMatch(install, /Proxmox/);
  assert.match(integrations, /Proxmox deployment integration/);
  assert.doesNotMatch(app, /Proxmox-style host networking/);
  assert.doesNotMatch(app, /No Proxmox configuration/);
  assert.match(app, /LightNAS · Development & Community Evaluation License/);
  assert.equal(JSON.parse(pkg).license, 'SEE LICENSE IN LICENSE');
});
