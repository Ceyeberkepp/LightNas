import test from 'node:test';import assert from 'node:assert/strict';import {verifyWorkloadTransferBundle} from '../src/migration-workload-bundle.mjs';
const coverage=Object.fromEntries(['storage','database','configuration','identity','permissions','secrets','network','services'].map(k=>[k,'verified']));
test('empty bundle rejected across supported sources and workload types',async()=>{
 for(const source of ['truenas','proxmox','vmware','redhat'])
  for(const type of ['vm','container','app'])
   await assert.rejects(verifyWorkloadTransferBundle({source,type,artifacts:[],inventoryComplete:true,coverage,dependencies:[]}),/Invalid workload artifact/);
});
test('dependency gaps block bundle verification before accessing staged artifacts',async()=>{
 await assert.rejects(verifyWorkloadTransferBundle({source:'truenas',type:'app',artifacts:[{jobId:'safe',kind:'application-data',sha256:'0'.repeat(64)}],inventoryComplete:true,coverage:{...coverage,database:'unknown'},dependencies:[]}),/incomplete/);
});
test('unknown or duplicate artifact metadata rejected',async()=>{
 await assert.rejects(verifyWorkloadTransferBundle({source:'vmware',type:'vm',artifacts:[{jobId:'../bad',kind:'vm-disk',sha256:'0'.repeat(64)}],inventoryComplete:true,coverage,dependencies:[]}),/Invalid or duplicate/);
});
