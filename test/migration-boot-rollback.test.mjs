import test from 'node:test';
import assert from 'node:assert/strict';
import {previewMigrationBootTest,previewMigrationRollback} from '../src/migration-boot-rollback.mjs';
const base={name:'MigratedVM',diskSha256:'a'.repeat(64),offlineVerified:true,isolatedNetwork:true,snapshotConfirmed:true,sourceUnchanged:true,rollbackReviewed:true};
test('approved prerequisites still cannot trigger unimplemented boot execution',()=>{
 const result=previewMigrationBootTest(base);
 assert.deepEqual(result.blockers,[]);
 assert.equal(result.canExecute,false);
 assert.equal(result.bootStarted,false);
});
test('nonisolated network blocks plan',()=>{
 const result=previewMigrationBootTest({...base,isolatedNetwork:false,productionNetwork:true});
 assert.ok(result.blockers.some(x=>x.includes('Production network')));
});
test('rollback preview never authorizes disk overwrite',()=>{
 const r=previewMigrationRollback({name:'MigratedVM',backupSha256:'b'.repeat(64)});
 assert.equal(r.executed,false);
 assert.equal(r.destructiveActionsAuthorized,false);
});
test('rejects invalid checksum',()=>assert.throws(()=>previewMigrationBootTest({...base,diskSha256:'broken'}),/valid VM/));
