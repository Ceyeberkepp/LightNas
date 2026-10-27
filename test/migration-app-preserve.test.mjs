import test from 'node:test';import assert from 'node:assert/strict';
import {preserveVerifiedApplication} from '../src/migration-app-preserve.mjs';
test('unsafe or incomplete app preservation rejected without writing anything',async()=>{
 const items=[
  {name:'sftpgo',pool:'local',confirm:'wrong',artifacts:[{jobId:'x',kind:'application-data',sha256:'0'.repeat(64)}]},
  {name:'sftpgo',pool:'local',confirm:'PRESERVE_VERIFIED_APP',artifacts:[]},
  {name:'../../bad',pool:'local',confirm:'PRESERVE_VERIFIED_APP',artifacts:[{jobId:'x',kind:'application-data',sha256:'0'.repeat(64)}]}
 ];
 for(const item of items)await assert.rejects(preserveVerifiedApplication(item),/required/);
});
test('database consistency required before any destination write',async()=>{
 await assert.rejects(preserveVerifiedApplication({name:'sftpgo',pool:'local',confirm:'PRESERVE_VERIFIED_APP',databaseConsistencyVerified:false,dependenciesReviewed:true,artifacts:[{jobId:'x',kind:'application-data',sha256:'0'.repeat(64)}]}),/Consistent database backup/);
});
