import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {atomic} from '../src/storage-agent/persistence.js';

async function fixture(fn){
 const dir=await mkdtemp(join(tmpdir(),'lightnas-atomic-'));
 const file=join(dir,'license-receipt.json');
 await writeFile(file,'old-signed-receipt',{mode:0o600});
 try{await fn({dir,file});}finally{await rm(dir,{recursive:true,force:true});}
}
const assertClean=async({dir,file})=>{
 assert.equal(await readFile(file,'utf8'),'old-signed-receipt');
 assert.deepEqual((await readdir(dir)).sort(),['license-receipt.json']);
};

test('failed temp-file write preserves previous receipt and removes partial sensitive temp file',()=>fixture(async ctx=>{
 await assert.rejects(atomic(ctx.file,'new-receipt',{openFile:async(...args)=>{
  const fd=await open(...args);
  if(args[1]==='wx')return {writeFile:async()=>{throw Error('injected write failure');},sync:()=>fd.sync(),close:()=>fd.close()};
  return fd;
 }}),/injected write failure/);
 await assertClean(ctx);
}));

test('failed fsync preserves previous receipt and removes partial sensitive temp file',()=>fixture(async ctx=>{
 await assert.rejects(atomic(ctx.file,'new-receipt',{openFile:async(...args)=>{
  const fd=await open(...args);
  if(args[1]==='wx')return {writeFile:data=>fd.writeFile(data),sync:async()=>{throw Error('injected fsync failure');},close:()=>fd.close()};
  return fd;
 }}),/injected fsync failure/);
 await assertClean(ctx);
}));

test('failed rename preserves previous receipt and removes staged temp file',()=>fixture(async ctx=>{
 await assert.rejects(atomic(ctx.file,'new-receipt',{renameFile:async()=>{throw Error('injected rename failure');}}),/injected rename failure/);
 await assertClean(ctx);
}));

test('successful atomic replacement durably replaces the complete receipt without temp files',()=>fixture(async ctx=>{
 await atomic(ctx.file,'new-signed-receipt');
 assert.equal(await readFile(ctx.file,'utf8'),'new-signed-receipt');
 assert.deepEqual(await readdir(ctx.dir),['license-receipt.json']);
}));
