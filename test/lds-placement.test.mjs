import test from 'node:test';
import assert from 'node:assert/strict';
import {placeReplicas} from '../src/lds-placement.mjs';
const nodes=()=>['a','b','c','d'].map((id,i)=>({id,domains:{host:id,rack:`rack${i}`},freeBytes:1024,healthy:true}));
test('deterministic and order-independent',()=>{const a=placeReplicas({objectId:'volume/1',nodes:nodes()});const b=placeReplicas({objectId:'volume/1',nodes:nodes().reverse()});assert.deepEqual(a,b);assert.equal(a.nodes.length,3)});
test('never places two replicas in one failure domain',()=>{const ns=nodes();ns[1].domains.rack='rack0';const result=placeReplicas({objectId:'x',nodes:ns,failureDomain:'rack'});assert.equal(result.ok,true);assert.equal(new Set(result.nodes.map(id=>ns.find(n=>n.id===id).domains.rack)).size,3)});
test('fails closed when independent domains insufficient',()=>{const ns=nodes();ns.forEach(n=>n.domains.rack='same');const r=placeReplicas({objectId:'x',nodes:ns,failureDomain:'rack'});assert.equal(r.ok,false);assert.deepEqual(r.nodes,[])});
test('excludes unhealthy and full nodes',()=>{const ns=nodes();ns[0].healthy=false;ns[1].freeBytes=0;assert.equal(placeReplicas({objectId:'x',nodes:ns}).ok,false)});
test('rejects duplicate IDs and invalid capacity',()=>{const ns=nodes();ns[1].id='a';assert.throws(()=>placeReplicas({objectId:'x',nodes:ns}),/duplicate/);const bad=nodes();bad[0].freeBytes=-1;assert.throws(()=>placeReplicas({objectId:'x',nodes:bad}),/capacity/)});
