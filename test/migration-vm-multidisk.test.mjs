import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/migration-vm-import.mjs',import.meta.url),'utf8');
test('all attached VM disk jobs are imported and checksummed',()=>{
 assert.match(src,/input\.disks === undefined \? \[input\.jobId\] : input\.disks/);
 assert.match(src,/new Set\(diskJobs\)\.size !== diskJobs\.length/);
 assert.match(src,/for \(const \{file,disk\} of verifiedDisks\)/);
 assert.match(src,/hash\.digest\('hex'\)!==file\.sha256/);
 assert.match(src,/\.\.\.diskArgs,/);
});
test('external backing chains are rejected before import',()=>assert.match(src,/metadata\['backing-filename'\]/));
test('original source is not removed and newly defined guest stays offline',()=>assert.match(src,/state:'defined-offline'/));
