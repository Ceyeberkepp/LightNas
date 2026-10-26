import test from 'node:test';
import assert from 'node:assert/strict';
import {planMigration} from '../src/migration-planner.mjs';
test('TrueNAS app, container, shares and storage render in review',()=>{
 const items=[
  {id:'truenas-app:sftpgo',name:'sftpgo',type:'app'},
  {id:'truenas-instance:STD',name:'STD',type:'container'},
  {id:'truenas-pool:SSDD01',name:'SSDD01',type:'storage'},
  {id:'truenas-smb:dds01',name:'dds01',type:'share'}
 ];
 const plan=planMigration({source:'truenas',items});
 assert.equal(plan.steps.length,4);
 assert.equal(plan.steps[0].status,'needs-app-migration-adapter');
 assert.equal(plan.steps[1].status,'needs-mapping');
 assert.equal(plan.blockers.length,4);
 assert.equal(plan.migrationStarted,false);
});
test('app is never approved merely by supplying a destination',()=>{
 const plan=planMigration({source:'truenas',items:[{id:'a',name:'sftpgo',type:'app'}],mappings:{a:{target:'Apps'}}});
 assert.equal(plan.steps[0].status,'needs-app-migration-adapter');
 assert.deepEqual(plan.blockers,['a']);
});
