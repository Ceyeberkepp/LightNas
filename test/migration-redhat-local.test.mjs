import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRedHatInventory,buildSourceExportManifest} from '../src/migration-redhat-local.mjs';
const data={source:'redhat',vms:[{id:'vm1',name:'WebServer'}],containers:[{id:'ct1',name:'AppServer'}]};
test('normalizes source host inventory',()=>{
 const result=normalizeRedHatInventory(data);
 assert.deepEqual(result.items.map(x=>x.type),['vm','container']);
 assert.equal(result.discoveryOnly,true);
 assert.equal(result.credentialsStored,false);
});
test('export manifest does not claim any exported disks',()=>{
 const result=buildSourceExportManifest(data);
 assert.equal(result.exportState,'manifest-only');
 assert.equal(result.imagesExported,false);
});
test('rejects duplicate item identifiers',()=>assert.throws(()=>normalizeRedHatInventory({...data,vms:[data.vms[0],data.vms[0]]}),/Duplicate/));
test('rejects invalid identity and source',()=>{
 assert.throws(()=>normalizeRedHatInventory({...data,source:'fake'}),/Expected Red Hat/);
 assert.throws(()=>normalizeRedHatInventory({...data,vms:[{id:'../escape',name:'bad\\nname'}]}),/Invalid Red Hat/);
});
