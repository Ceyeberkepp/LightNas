import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateLxcRestoreApproval} from '../src/migration-lxc-approval.mjs';
const sha='a'.repeat(64);
const plan={phase:'lxc-restore-plan',readyForManualReview:true,archiveSha256:sha,destination:{name:'RestoreLxc',pool:'pool1'}};
const decisions={idMappingReviewed:true,aclReviewed:true,mountsReviewed:true,networkReviewed:true,backupConfirmed:true,downtimeApproved:true};
test('complete review cannot itself execute restore',()=>{
 const p=evaluateLxcRestoreApproval(plan,{decisions,archiveSha256:sha,confirm:'REVIEW_LXC_RESTORE'});
 assert.equal(p.reviewComplete,true);
 assert.equal(p.approvedForExecution,false);
 assert.equal(p.restoreStarted,false);
});
test('missing review item blocks completion',()=>{
 const p=evaluateLxcRestoreApproval(plan,{decisions:{...decisions,aclReviewed:false},archiveSha256:sha,confirm:'REVIEW_LXC_RESTORE'});
 assert.deepEqual(p.missing,['aclReviewed']);
});
test('archive fingerprint mismatch blocks review',()=>{
 const p=evaluateLxcRestoreApproval(plan,{decisions,archiveSha256:'b'.repeat(64),confirm:'REVIEW_LXC_RESTORE'});
 assert.ok(p.missing.includes('archiveSha256'));
});
test('ineligible destination rejected',()=>assert.throws(()=>evaluateLxcRestoreApproval({...plan,readyForManualReview:false},{decisions}),/preflight must pass/));
