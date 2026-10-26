import test from 'node:test';import assert from 'node:assert/strict';
import {evaluateMigrationAcceptance} from '../src/migration-acceptance.mjs';
const sha='a'.repeat(64);
const base={type:'vm',sourceSha256:sha,destinationSha256:sha,sourcePreserved:true,operatorApproved:true,
 checks:{sourceBackupVerified:true,destinationChecksumVerified:true,diskLayoutVerified:true,guestBootVerified:true,servicesHealthy:true,networkVerified:true,rollbackTested:true}};
test('even complete VM evidence does not itself start production cutover',()=>{
 const result=evaluateMigrationAcceptance(base);
 assert.equal(result.evidenceComplete,true);
 assert.equal(result.productionCutoverAuthorized,false);
 assert.equal(result.sourceDeletionAuthorized,false);
 assert.equal(result.dataLossProven,false);
});
test('mismatched checksums block acceptance',()=>{
 const result=evaluateMigrationAcceptance({...base,destinationSha256:'b'.repeat(64)});
 assert.equal(result.evidenceComplete,false);
 assert.ok(result.missing.includes('matchingSourceDestinationSha256'));
});
test('missing rollback test blocks acceptance',()=>{
 const result=evaluateMigrationAcceptance({...base,checks:{...base.checks,rollbackTested:false}});
 assert.ok(result.missing.includes('rollbackTested'));
});
test('TrueNAS container requires identity ACL and backup checks',()=>{
 const result=evaluateMigrationAcceptance({...base,type:'container'});
 assert.ok(result.missing.includes('ownershipVerified'));
 assert.ok(result.missing.includes('aclVerified'));
});
test('source deletion never authorized',()=>{
 const result=evaluateMigrationAcceptance({...base,sourcePreserved:false});
 assert.equal(result.sourceDeletionAuthorized,false);
 assert.ok(result.missing.includes('sourcePreserved'));
});
