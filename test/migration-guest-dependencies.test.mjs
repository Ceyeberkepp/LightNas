import test from 'node:test';import assert from 'node:assert/strict';
import {reviewGuestDependencies} from '../src/migration-guest-dependencies.mjs';
const base={type:'container',inventoryComplete:true,dependencies:[
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
