import test from 'node:test';
import assert from 'node:assert/strict';
import {placeReplicas} from '../src/lds-placement.mjs';
const nodes=()=>['a','b','c','d'].map((id,i)=>({id,domains:{host:id,rack:`rack${i}`},freeBytes:1024,healthy:true}));
test('deterministic and order-independent',()=>{const a=placeReplicas({objectId:'volume/1',nodes:nodes()});const b=placeReplicas({objectId:'volume/1',nodes:nodes().reverse()});assert.deepEqual(a,b);assert.equal(a.nodes.length,3)});
test('never places two replicas in one failure domain',()=>{const ns=nodes();ns[1].domains.rack='rack0';const result=placeReplicas({objectId:'x',nodes:ns,failureDomain:'rack'});assert.equal(result.ok,true);assert.equal(new Set(result.nodes.map(id=>ns.find(n=>n.id===id).domains.rack)).size,3)});
test('fails closed when independent domains insufficient',()=>{const ns=nodes();ns.forEach(n=>n.domains.rack='same');const r=placeReplicas({objectId:'x',nodes:ns,failureDomain:'rack'});assert.equal(r.ok,false);assert.deepEqual(r.nodes,[])});
test('excludes unhealthy and full nodes',()=>{const ns=nodes();ns[0].healthy=false;ns[1].freeBytes=0;assert.equal(placeReplicas({objectId:'x',nodes:ns}).ok,false)});
test('rejects duplicate IDs and invalid capacity',()=>{const ns=nodes();ns[1].id='a';assert.throws(()=>placeReplicas({objectId:'x',nodes:ns}),/duplicate/);const bad=nodes();bad[0].freeBytes=-1;assert.throws(()=>placeReplicas({objectId:'x',nodes:bad}),/capacity/)});

test('placement does not mutate caller inventory or depend on inventory permutations', () => {
  const original = nodes();
  const before = structuredClone(original);
  const expected = placeReplicas({objectId:'vm/disk/42',nodes:original,failureDomain:'rack'});
  assert.deepEqual(original,before);
  for (let rotation=0;rotation<original.length;rotation++) {
    const rotated=[...original.slice(rotation),...original.slice(0,rotation)];
    assert.deepEqual(placeReplicas({objectId:'vm/disk/42',nodes:rotated,failureDomain:'rack'}),expected);
  }
});
test('one replica selects one healthy node and rejects zero replicas', () => {
  const result=placeReplicas({objectId:'single',nodes:nodes(),replicas:1});
  assert.equal(result.ok,true);
  assert.equal(result.nodes.length,1);
  assert.throws(()=>placeReplicas({objectId:'single',nodes:nodes(),replicas:0}),/invalid placement/);
});
test('missing failure-domain labels fail closed rather than silently co-locating', () => {
  const inventory=nodes();
  delete inventory[0].domains.rack;
  assert.throws(()=>placeReplicas({objectId:'critical',nodes:inventory,failureDomain:'rack'}),/missing failure domain/);
});
test('fully unhealthy inventory returns no replica placements', () => {
  const inventory=nodes().map(node=>({...node,healthy:false}));
  const result=placeReplicas({objectId:'critical',nodes:inventory});
  assert.equal(result.ok,false);
  assert.deepEqual(result.nodes,[]);
});


test('replicas require sufficient capacity for the entire chunk', () => {
  const inventory = nodes();
  inventory[0].freeBytes = 511;
  inventory[1].freeBytes = 512;
  const result = placeReplicas({objectId:'chunk',nodes:inventory,requiredBytes:512});
  assert.equal(result.ok,true);
  assert.equal(result.nodes.includes('a'),false);
  assert.equal(result.nodes.includes('b'),true);
  assert.equal(placeReplicas({objectId:'chunk',nodes:inventory,requiredBytes:513}).ok,false);
  for (const requiredBytes of [0,-1,1.5,Infinity,NaN]) {
    assert.throws(()=>placeReplicas({objectId:'chunk',nodes:inventory,requiredBytes}),/invalid placement/);
  }
});
