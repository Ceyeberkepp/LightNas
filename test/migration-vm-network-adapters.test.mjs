import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const vm=readFileSync(new URL('../src/migration-vm-import.mjs',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../src/migration-restore-pipeline.mjs',import.meta.url),'utf8');
test('multiple guest adapters are passed to virt-install and checked against destination networks',()=>{
 assert.match(vm,/interfaces\.some\(nic=>!runtime\.networks/);
 assert.match(vm,/const nicArgs=interfaces\.flatMap/);
 assert.match(vm,/\.\.\.nicArgs,'--graphics'/);
});
test('MAC unicast and uniqueness guards are present',()=>{
 assert.match(vm,/macs\.has\(value\)/);
 assert.match(vm,/parseInt\(value\.slice\(0,2\),16\)&1/);
});
test('offline restore pipeline forwards interfaces from migration manifest',()=>{
 assert.match(workflow,/interfaces:input\.interfaces/);
});
