import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateLxcRestorePlan,planVerifiedLxcRestore} from '../src/migration-lxc-restore-plan.mjs';
const input={jobId:'verified',name:'RestoredLxc',pool:'tank',network:'bridge0',rootfsGiB:10,memoryMiB:2048,cpus:2};
const archive={hasLinuxRootfsMarker:true,entryCount:120,archiveSha256:'a'.repeat(64)};
const storage={pools:[{id:'tank',online:true,writable:true,content:['rootdir'],capacityKnown:true,availableBytes:20*1024**3}]};
test('valid restore maps remain manual-only',()=>{
 const plan=evaluateLxcRestorePlan(input,archive,storage);
 assert.equal(plan.readyForManualReview,true);
 assert.equal(plan.canRestoreAutomatically,false);
 assert.equal(plan.approvedForExecution,false);
});
test('offline or read-only destinations block manual readiness',()=>{
 const plan=evaluateLxcRestorePlan(input,archive,{pools:[{...storage.pools[0],writable:false}]});
 assert.equal(plan.readyForManualReview,false);
 assert.match(plan.issues.join(' '),/online writable/);
});
test('insufficient space blocks readiness',()=>{
 const plan=evaluateLxcRestorePlan(input,archive,{pools:[{...storage.pools[0],availableBytes:1}]});
 assert.match(plan.issues.join(' '),/enough reported free space/);
});
test('invalid resource sizes rejected',()=>assert.throws(()=>evaluateLxcRestorePlan({...input,cpus:0},archive,storage),/Invalid container/));
test('verified source is required',async()=>await assert.rejects(planVerifiedLxcRestore({...input,jobId:42}),/Verified archive job/));
test('plan uses verified preflight and storage providers',async()=>{
 const plan=await planVerifiedLxcRestore(input,{
 inspectVerifiedLxcArchive:async id=>{assert.equal(id,'verified');return archive;},
 listStoragePools:async()=>storage
 });
 assert.equal(plan.archiveSha256,archive.archiveSha256);
});
