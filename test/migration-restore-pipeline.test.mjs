import test from 'node:test';import assert from 'node:assert/strict';import {executeVerifiedWorkloadRestore} from '../src/migration-restore-pipeline.mjs';
const base={source:'truenas',type:'vm',name:'TestVM',pool:'SSD01',network:'default',memoryMiB:1024,cpus:2,inventoryComplete:true,confirm:'EXECUTE_VERIFIED_OFFLINE_RESTORE',artifacts:[{kind:'vm-disk',jobId:'disk1',sha256:'a'.repeat(64)}]};
const verify=async()=>({artifactCount:1,dependenciesReviewed:true,cutoverAuthorized:false});
test('VM restore passes all disk jobs to offline importer',async()=>{
 let passed;const result=await executeVerifiedWorkloadRestore(base,{verify,vm:async input=>{passed=input;return {state:'defined-offline'}}});
 assert.deepEqual(passed.disks,['disk1']);
 assert.equal(passed.confirm,'IMPORT_VERIFIED_VM');
 assert.equal(result.cutoverAuthorized,false);
});
test('application restore only preserves backup set',async()=>{
 const item={...base,type:'app',artifacts:[{kind:'application-data',jobId:'data1',sha256:'b'.repeat(64)}],databaseConsistencyVerified:true};
 const result=await executeVerifiedWorkloadRestore(item,{verify,app:async()=>({phase:'preserved-offline'})});
 assert.equal(result.destinationFunctionalityVerified,false);
 assert.equal(result.phase,'preserved-offline');
});
test('container is blocked, not marked migrated',async()=>{
 await assert.rejects(executeVerifiedWorkloadRestore({...base,type:'container'},{verify}),/not yet safely supported/);
});
test('approval and evidence required before any write',async()=>{
 await assert.rejects(executeVerifiedWorkloadRestore({...base,confirm:''},{verify}),/approval required/);
 await assert.rejects(executeVerifiedWorkloadRestore(base,{verify:async()=>({artifactCount:0})}),/manifest required/);
});
