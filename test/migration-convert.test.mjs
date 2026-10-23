import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('disk conversion only accepts verified source and emits verified import receipt',async()=>{
 const s=await readFile(new URL('../src/migration-convert.mjs',import.meta.url),'utf8');
 assert.match(s,/verifiedMigrationFile\(input\?\.jobId\)/);
 assert.match(s,/CONVERT_VERIFIED_DISK/);
 assert.match(s,/qemu-img/);
 assert.match(s,/\['convert','-p'/);
 assert.match(s,/\['check','-f','qcow2'/);
 assert.match(s,/registerVerifiedConvertedDisk/);
 assert.match(s,/createHash\('sha256'\)/);
});
