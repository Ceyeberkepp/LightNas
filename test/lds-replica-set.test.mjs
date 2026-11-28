import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LdsChunkStore} from '../src/lds-chunk-store.mjs';
import {LdsReplicaSet} from '../src/lds-replica-set.mjs';
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'lds-replicas-'));try{const nodes=await Promise.all(['a','b','c'].map(async id=>({id,domain:id,store:await new LdsChunkStore(join(root,id)).init()})));await fn(nodes,root)}finally{await rm(root,{recursive:true,force:true})}}
const offline={async put(){throw Error('offline')},async get(){throw Error('offline')}};
test('three durable copies',()=>fixture(async nodes=>{const set=new LdsReplicaSet(nodes),b=Buffer.from('replicated');const r=await set.put(b);assert.equal(r.acknowledged.length,3);for(const n of nodes)assert.deepEqual(await n.store.get(r.id),b)}));
test('one failure permits degraded quorum and subsequent repair',()=>fixture(async nodes=>{const b=Buffer.from('degraded');const r=await new LdsReplicaSet([nodes[0],nodes[1],{...nodes[2],store:offline}]).put(b);assert.equal(r.degraded,true);assert.equal((await new LdsReplicaSet(nodes).repair(r.id)).degraded,false);assert.deepEqual(await nodes[2].store.get(r.id),b)}));
test('two failures reject write',()=>fixture(async nodes=>{await assert.rejects(new LdsReplicaSet([nodes[0],...nodes.slice(1).map(n=>({...n,store:offline}))]).put(Buffer.from('minority')),/quorum/)}));
test('read survives corrupt replica',()=>fixture(async(nodes,root)=>{const s=new LdsReplicaSet(nodes),b=Buffer.from('healthy'),r=await s.put(b);await writeFile(join(root,'a','chunks',r.id),'corrupt');assert.deepEqual(await s.get(r.id),b)}));
test('reject shared failure domain',()=>fixture(async nodes=>{assert.throws(()=>new LdsReplicaSet([nodes[0],{...nodes[1],domain:'a'},nodes[2]]),/independent/)}));
