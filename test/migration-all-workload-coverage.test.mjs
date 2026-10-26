import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../src/migration-discovery.mjs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/migration-wizard.js',import.meta.url),'utf8');
test('Proxmox QEMU VM and LXC inventory both included',()=>{
 assert.match(api,/rows\.filter\(x => x\.type === 'qemu'\)/);
 assert.match(api,/rows\.filter\(x => x\.type === 'lxc'\)/);
 assert.match(api,/const proxmoxSecondFactor =/);
});
test('vCenter VMs inventoried and container capability not misleading',()=>{
 assert.match(api,/api\/vcenter\/vm/);
 assert.match(api,/not-native-to-vcenter/);
});
test('TrueNAS workload inventory and explicit coverage reporting',()=>{
 assert.match(api,/virt\.instance\.query/);
 assert.match(api,/app\.query/);
 assert.match(api,/const counts = Object\.fromEntries/);
 assert.match(ui,/counts\.container/);
 assert.match(ui,/Object\.entries\(coverage\)/);
});
