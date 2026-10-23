import test from 'node:test';
import assert from 'node:assert/strict';
import {checkShareMigration} from '../src/migration-share-preflight.mjs';
const base={shares:[{id:'share1',name:'Engineering',protocol:'smb',acl:[{identityId:'staff',permission:'read',deny:false}]}],
 identities:[{id:'staff',type:'group'}],
 mappings:{share1:{pool:'tank',name:'Engineering'},staff:{target:'engineering',type:'group'}}};
test('mapped share still requires administrator filesystem ACL review',()=>{
 const p=checkShareMigration(base);
 assert.equal(p.results[0].ready,false);
 assert.equal(p.canApplyAutomatically,false);
 assert.equal(p.readOnly,true);
});
test('missing identity mappings fail closed',()=>{
 const p=checkShareMigration({...base,mappings:{share1:{pool:'tank',name:'Engineering'}}});
 assert.match(p.results[0].issues.join(' '),/Missing or mismatched destination identity/);
});
test('deny entries require manual semantics review',()=>{
 const p=checkShareMigration({...base,shares:[{...base.shares[0],acl:[{identityId:'staff',permission:'full',deny:true}]}]});
 assert.match(p.results[0].issues.join(' '),/Explicit deny/);
});
test('NFS exports require client and squash review',()=>{
 const p=checkShareMigration({...base,shares:[{...base.shares[0],protocol:'nfs'}]});
 assert.match(p.results[0].issues.join(' '),/root squash/);
});
test('duplicate share IDs are rejected',()=>assert.throws(()=>checkShareMigration({...base,shares:[base.shares[0],base.shares[0]]}),/duplicate share/));
test('inherited identity mapping cannot count as explicit mapping',()=>{
 const input={...base,mappings:Object.create({staff:{target:'admin',type:'group'}})};
 input.mappings.share1={pool:'tank',name:'Engineering'};
 assert.match(checkShareMigration(input).results[0].issues.join(' '),/Missing or mismatched/);
});
