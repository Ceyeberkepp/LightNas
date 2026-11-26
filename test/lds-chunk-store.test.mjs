import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LdsChunkStore} from '../src/lds-chunk-store.mjs';
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'lds-'));try{await fn(root,await new LdsChunkStore(root).init())}finally{await rm(root,{recursive:true,force:true})}}
test('immutable data survives reopen',()=>fixture(async(root,s)=>{const b=Buffer.from('LDS');const id=await s.put(b);assert.deepEqual(await (await new LdsChunkStore(root).init()).get(id),b);assert.equal(await s.put(b),id)}));
test('cleans interrupted staging',()=>fixture(async(root,s)=>{await writeFile(join(root,'staging','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),'partial');await new LdsChunkStore(root).init();assert.deepEqual(await readdir(join(root,'staging')),[])}));
test('detects corruption',()=>fixture(async(root,s)=>{const b=Buffer.from('original'),id=await s.put(b);await writeFile(join(root,'chunks',id),'corrupt');await assert.rejects(s.get(id),/checksum/);await assert.rejects(s.put(b),/corrupted/)}));
test('rejects unsafe input',()=>fixture(async(root,s)=>{await assert.rejects(s.get('../etc/passwd'),/invalid/);await assert.rejects(s.put(Buffer.alloc(0)),/invalid/);await assert.rejects(s.put(Buffer.alloc(8388609)),/invalid/)}));
test('concurrent identical writes',()=>fixture(async(root,s)=>{const b=Buffer.from('same');const ids=await Promise.all(Array.from({length:8},()=>s.put(b)));assert.equal(new Set(ids).size,1);assert.deepEqual(await s.get(ids[0]),b)}));
