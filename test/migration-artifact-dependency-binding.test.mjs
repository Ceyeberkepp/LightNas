import test from 'node:test';import assert from 'node:assert/strict';
import {verifyWorkloadTransferBundle} from '../src/migration-workload-bundle.mjs';
const coverage=Object.fromEntries(['storage','database','configuration','identity','permissions','secrets','network','services'].map(k=>[k,'verified']));
const artifact={jobId:'data',kind:'application-data',sha256:'a'.repeat(64)};
const base={source:'truenas',type:'app',inventoryComplete:true,coverage,artifacts:[artifact],
  dependencies:[{id:'db',kind:'database',destinationVerified:true,applicationConsistentBackup:true}]};
test('app DB dependency requires a staged database backup rather than merely claiming success',async()=>{
 await assert.rejects(verifyWorkloadTransferBundle(base),/no matching staged backup artifact: db/);
});
test('external volumes cannot silently reuse application data archive',async()=>{
 const input={...base,dependencies:[{id:'external',kind:'bind-mount',destinationVerified:true,external:true,explicitlyIncluded:true,artifactJobId:'data'}]};
 await assert.rejects(verifyWorkloadTransferBundle(input),/no matching staged backup artifact: external/);
});
test('a fully enumerated backup must reference an actual job',async()=>{
 const input={...base,dependencies:[{id:'config',kind:'configuration',destinationVerified:true,artifactJobId:'missing'}]};
 await assert.rejects(verifyWorkloadTransferBundle(input),/no matching staged backup artifact: config/);
});
