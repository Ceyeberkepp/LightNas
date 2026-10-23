import test from 'node:test';
import assert from 'node:assert/strict';
import {checkMigrationDestinations} from '../src/migration-destination.mjs';
const providers={
 runtimeInventory:async()=>({virtualization:{available:true,enabled:true,networks:['lan0']},containers:{available:true,enabled:true,networks:['lan0']}}),
 listStoragePools:async()=>({pools:[{id:'pool1',online:true,writable:true,content:['images','rootdir']}]})
};
test('validates real destination resource names',async()=>{
 const result=await checkMigrationDestinations({source:'proxmox',items:[{id:'1',name:'VM 1',type:'vm'},{id:'2',name:'LAN',type:'network'}],mappings:{'1':{target:'pool1'},'2':{target:'lan0'}}},providers);
 assert.equal(result.ready,2);assert.equal(result.blocked,0);assert.equal(result.approvedForExecution,false);
});
test('unmapped networks and offline storage fail closed',async()=>{
 const result=await checkMigrationDestinations({source:'vmware',items:[{id:'1',name:'VM',type:'vm'},{id:'2',name:'Network',type:'network'}],mappings:{'1':{target:'missing'},'2':{target:'vmbr0',vlan:5000}}},providers);
 assert.equal(result.blocked,2);assert.ok(result.results[0].issues.some(x=>x.includes('writable')));assert.ok(result.results[1].issues.some(x=>x.includes('VLAN')));
});
test('shares and user identities require manual review even when mapped',async()=>{
 const result=await checkMigrationDestinations({source:'truenas',items:[{id:'1',name:'SMB',type:'share'},{id:'2',name:'ACL',type:'identity'}],mappings:{'1':{target:'pool1'},'2':{target:'pool1'}}},providers);
 assert.equal(result.blocked,2);
});
