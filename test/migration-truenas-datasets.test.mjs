import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateDatasetTransfer} from '../src/migration-truenas-datasets.mjs';
const storage={pools:[{id:'pool',online:true,writable:true,content:['files'],capacityKnown:true,availableBytes:10000}]};
const sample={datasets:[{name:'tank/documents',usedBytes:5000}],mappings:{'tank/documents':{pool:'pool'}}};
test('valid datasets remain blocked until ACL and share semantics review',()=>{
 const r=evaluateDatasetTransfer(sample,storage);
 assert.equal(r.results[0].targetPool,'pool');
 assert.equal(r.results[0].readyForTransfer,false);
 assert.equal(r.approvedForExecution,false);
});
test('insufficient destination space is flagged',()=>{
 const r=evaluateDatasetTransfer(sample,{pools:[{...storage.pools[0],availableBytes:1}]});
 assert.match(r.results[0].issues.join(' '),/Insufficient/);
});
test('encrypted sources require separate keys and unlock review',()=>{
 const r=evaluateDatasetTransfer({ ...sample,datasets:[{...sample.datasets[0],encrypted:true}]},storage);
 assert.match(r.results[0].issues.join(' '),/Encrypted/);
});
test('path traversal and duplicate names are rejected',()=>{
 assert.throws(()=>evaluateDatasetTransfer({...sample,datasets:[{name:'tank/../root',usedBytes:1}]},storage),/Invalid or duplicate/);
 assert.throws(()=>evaluateDatasetTransfer({...sample,datasets:[sample.datasets[0],sample.datasets[0]]},storage),/Invalid or duplicate/);
});
