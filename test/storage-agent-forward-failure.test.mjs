import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {forwardStorageAgent} from '../src/storage-agent-client.mjs';

// Isolated Unix-socket fixture; never connects to a real storage agent.
async function fixture(t,handler,timeoutMs=1000){
 const dir=await mkdtemp(join(tmpdir(),'lightnas-forward-'));
 const socket=join(dir,'agent.sock'), token=join(dir,'token');
 await writeFile(token,'a'.repeat(64));
 const agent=http.createServer(handler);
 await new Promise((resolve,reject)=>{agent.once('error',reject);agent.listen(socket,resolve);});
 const priorSocket=process.env.LIGHTNAS_STORAGE_AGENT_SOCKET;
 const priorToken=process.env.LIGHTNAS_STORAGE_AGENT_TOKEN_FILE;
 process.env.LIGHTNAS_STORAGE_AGENT_SOCKET=socket;
 process.env.LIGHTNAS_STORAGE_AGENT_TOKEN_FILE=token;
 const broker=http.createServer((req,res)=>{
  forwardStorageAgent(req,res,new URL(req.url,'http://localhost'),undefined,{timeoutMs})
   .catch(error=>{if(!res.headersSent){res.writeHead(error.status||500);res.end(error.message);}else res.destroy(error);});
 });
 await new Promise(resolve=>broker.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{
  if(priorSocket===undefined)delete process.env.LIGHTNAS_STORAGE_AGENT_SOCKET;
  else process.env.LIGHTNAS_STORAGE_AGENT_SOCKET=priorSocket;
  if(priorToken===undefined)delete process.env.LIGHTNAS_STORAGE_AGENT_TOKEN_FILE;
  else process.env.LIGHTNAS_STORAGE_AGENT_TOKEN_FILE=priorToken;
  broker.closeAllConnections();agent.closeAllConnections();
  await Promise.all([new Promise(resolve=>broker.close(resolve)),new Promise(resolve=>agent.close(resolve))]);
  await rm(dir,{recursive:true,force:true});
 });
 return {base:'http://127.0.0.1:'+broker.address().port};
}

test('forwarding preserves complete JSON and explicit upstream error status',async t=>{
 const {base}=await fixture(t,(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer '+'a'.repeat(64));
  if(req.url==='/v1/inventory'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');}
  else{res.writeHead(409,{'Content-Type':'application/json'});res.end('{"error":"conflict"}');}
 });
 const response=await fetch(base+'/api/storage/agent/inventory');
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
 const rejected=await fetch(base+'/api/storage/agent/preview');
 assert.equal(rejected.status,409);assert.deepEqual(await rejected.json(),{error:'conflict'});
});

test('truncated 200 response destroys client stream instead of accepting partial success',async t=>{
 const {base}=await fixture(t,(req,res)=>{
  res.writeHead(200,{'Content-Type':'application/json','Content-Length':'100'});
  res.write('{"partial":');
  setImmediate(()=>res.socket.destroy());
 });
 await assert.rejects(async()=>{const response=await fetch(base+'/api/storage/agent/inventory');await response.text();});
});

test('trickling non-SSE response cannot extend absolute deadline',async t=>{
 const {base}=await fixture(t,(req,res)=>{
  res.writeHead(200,{'Content-Type':'application/json'});
  const interval=setInterval(()=>res.write(' '),10);
  res.on('close',()=>clearInterval(interval));
 },90);
 const start=Date.now();
 await assert.rejects(async()=>{const response=await fetch(base+'/api/storage/agent/inventory');await response.text();});
 assert.ok(Date.now()-start<1000);
});

test('upstream unavailable before headers returns 503',async t=>{
 const {base}=await fixture(t,(req,res)=>res.end('ok'));
 process.env.LIGHTNAS_STORAGE_AGENT_SOCKET+='.missing';
 const response=await fetch(base+'/api/storage/agent/inventory');
 assert.equal(response.status,503);
});

test('SSE keeps streaming past JSON deadline while heartbeat continues',async t=>{
 const {base}=await fixture(t,(req,res)=>{
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8'});
  const interval=setInterval(()=>res.write('data: heartbeat\n\n'),20);
  res.on('close',()=>clearInterval(interval));
 },90);
 const abort=new AbortController();
 const response=await fetch(base+'/api/storage/agent/jobs/00000000-0000-0000-0000-000000000000/stream',{signal:abort.signal});
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-type'),/text\/event-stream/);
 const reader=response.body.getReader();
 const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/heartbeat/);
 await new Promise(resolve=>setTimeout(resolve,160));
 const second=await reader.read();assert.equal(second.done,false);
 abort.abort();
});


test('an agent cannot bypass the absolute deadline by claiming inventory is SSE',async t=>{
 const {base}=await fixture(t,(req,res)=>{
  assert.equal(req.url,'/v1/inventory');
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8'});
  const interval=setInterval(()=>res.write('data: fake-progress\n\n'),15);
  res.on('close',()=>clearInterval(interval));
 },120);
 await assert.rejects(async()=>{
  const response=await fetch(base+'/api/storage/agent/inventory');
  await response.text();
 },/terminated|aborted|fetch failed|premature|network|socket/i);
});

test('POST preview cannot inherit the SSE deadline exemption',async t=>{
 const {base}=await fixture(t,(req,res)=>{
  assert.equal(req.method,'POST');
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const interval=setInterval(()=>res.write('data: fake-progress\n\n'),15);
  res.on('close',()=>clearInterval(interval));
 },120);
 await assert.rejects(async()=>{
  const response=await fetch(base+'/api/storage/agent/preview',{method:'POST'});
  await response.text();
 },/terminated|aborted|fetch failed|premature|network|socket/i);
});

test('job events SSE route still streams beyond the ordinary deadline',async t=>{
 const {base}=await fixture(t,(req,res)=>{
  assert.equal(req.url,'/v1/jobs/00000000-0000-0000-0000-000000000000/events');
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8'});
  const interval=setInterval(()=>res.write('data: heartbeat\n\n'),20);
  res.on('close',()=>clearInterval(interval));
 },120);
 const abort=new AbortController();
 const response=await fetch(base+'/api/storage/agent/jobs/00000000-0000-0000-0000-000000000000/events',{signal:abort.signal});
 assert.equal(response.status,200);
 const reader=response.body.getReader();
 const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/heartbeat/);
 await new Promise(resolve=>setTimeout(resolve,230));
 const second=await reader.read();assert.equal(second.done,false);
 abort.abort();
});
