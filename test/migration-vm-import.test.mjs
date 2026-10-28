import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('VM importer requires staged verification, selected network and approval', async () => {
  const code=await readFile(new URL('../src/migration-vm-import.mjs',import.meta.url),'utf8');
  assert.match(code,/verifiedMigrationFile\(jobId\)/);
  assert.match(code,/IMPORT_VERIFIED_VM/);
  assert.match(code,/interfaces.some\(nic=>!runtime.networks\?\.includes\(nic.network\)\)/);
  assert.match(code,/hash.digest\('hex'\)!==file.sha256/);
  assert.match(code,/--print-xml/);
  assert.match(code,/defined-offline/);
  assert.doesNotMatch(code,/\['start',name\]/);
});
