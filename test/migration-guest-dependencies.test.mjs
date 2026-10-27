import test from 'node:test';import assert from 'node:assert/strict';
import {reviewGuestDependencies} from '../src/migration-guest-dependencies.mjs';
const verifiedCoverage=Object.fromEntries(['storage','database','configuration','identity','permissions','secrets','network','services'].map(key=>[key,'verified']));
const base={type:'container',inventoryComplete:true,coverage:verifiedCoverage,dependencies:[
 {id:'rootfs',kind:'disk',destinationVerified:true},
 {id:'postgres',kind:'database',destinationVerified:true,applicationConsistentBackup:false},
 {id:'external-data',kind:'bind-mount',external:true,destinationVerified:true}
]};
test('database and external data cannot be silently omitted',()=>{
 const result=reviewGuestDependencies(base);
 assert.deepEqual(result.blockers,['postgres','external-data']);
 assert.equal(result.guestActivationAuthorized,false);
});
test('complete review never directly activates guest',()=>{
 const dependencies=base.dependencies.map(x=>({...x,applicationConsistentBackup:true,explicitlyIncluded:true}));
 const result=reviewGuestDependencies({...base,dependencies});
 assert.equal(result.allDependenciesVerified,true);
 assert.equal(result.transferStarted,false);
});
test('requires complete source inventory',()=>assert.throws(()=>reviewGuestDependencies({...base,inventoryComplete:false}),/Full source inventory/));

test('missing coverage blocks every supported platform workload type',()=>{
 for(const type of ['vm','container','app']){
  const result=reviewGuestDependencies({type,inventoryComplete:true,coverage:{...verifiedCoverage,database:'unknown'},dependencies:[]});
  assert.ok(result.blockers.includes('coverage:database'));
  assert.equal(result.guestActivationAuthorized,false);
 }
});
test('missing coverage declaration is rejected',()=>assert.throws(()=>reviewGuestDependencies({type:'vm',inventoryComplete:true,dependencies:[]}),/coverage declaration/));

test('missing coverage blocks the review for every VM container and app',()=>{
 for(const type of ['vm','container','app']){
  const result=reviewGuestDependencies({...base,type,dependencies:[],coverage:{...coverage,database:'unknown'}});
  assert.ok(result.blockers.includes('coverage:database'));
 }
});
test('missing coverage fails rather than throwing reference error',()=>assert.throws(()=>reviewGuestDependencies({...base,coverage:undefined}),/coverage declaration/));
