import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('Proxmox LXC preflight validates source and does not extract archive or mutate containers', async()=>{
 const code=await readFile(new URL('../src/migration-lxc-preflight.mjs',import.meta.url),'utf8');
 assert.match(code,/verifiedMigrationFile\(jobId\)/);
 assert.match(code,/createHash\('sha256'\)/);
 assert.match(code,/tar.*-taf/);
 assert.match(code,/canRestoreAutomatically: false/);
 assert.doesNotMatch(code,/lxc-start|lxc-create|tar.*-xaf/);
});
