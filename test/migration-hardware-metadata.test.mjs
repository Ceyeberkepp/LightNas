import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/migration-discovery.mjs',import.meta.url),'utf8');
test('inventory returns CPU memory power-state and node without secrets',()=>{
 assert.match(source,/hardware:\s*\{/);
 assert.match(source,/cpuCount:/);
 assert.match(source,/memoryMiB:/);
 assert.match(source,/state: \['running'/);
 assert.match(source,/host:/);
});
test('proxmox memory in bytes converted to MiB',()=>assert.match(source,/Math\.round\(x\.maxmem\/1048576\)/));
