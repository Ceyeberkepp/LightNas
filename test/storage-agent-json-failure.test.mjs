import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {storageAgentJson} from '../src/storage-agent-client.mjs';

// All tests use an isolated Unix socket and fake token. No appliance agent,
// storage device, filesystem, or production network is touched.
async function withAgent(t,handler){
 const dir=await mkdtemp(join(tmpdir(),'lightnas-agent-json-'));
 const socket=join(dir,'agent.sock');
 const token=join(dir,'token');
 await writeFile(token,'a'.repeat(64));
 const server=http.createServer(handler);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});
 const priorSocket=process.env.LIGHTNAS_STORAGE_AGENT_SOCKET;
 const priorToken=process.env.LIGHTNAS_STORAGE_AGENT_TOKEN_FILE;
 process.env.LIGHTNAS_STORAGE_AGENT_SOCKET=socket;
 process.env.LIGHTNAS_STORAGE_AGENT_TOKEN_FILE=token;
 t.after(async()=>{
  if(priorSocket===undefined)delete process.env.LIGHTNAS_STORAGE_AGENT_SOCKET;
  else process.env.LIGHTNAS_STORAGE_AGENT_SOCKET=priorSocket;
  if(priorToken===undefined)delete process.env.LIGHTNAS_STORAGE_AGENT_TOKEN_FILE;
  else process.env.LIGHTNAS_STORAGE_AGENT_TOKEN_FILE=priorToken;
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  await rm(dir,{recursive:true,force:true});
 });
}

test('bounded agent JSON succeeds and preserves HTTP rejection',async t=>{
 await withAgent(t,(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer '+'a'.repeat(64));
  if(req.url==='/ok'){res.setHeader('Content-Type','application/json');res.end('{"ok":true}');}
  else{res.writeHead(409);res.end('{"error":"conflict"}');}
 });
 assert.deepEqual(await storageAgentJson('/ok'),{ok:true});
 await assert.rejects(storageAgentJson('/bad'),error=>error.status===409&&error.message==='conflict');
});

test('premature agent response disconnect fails instead of crashing or hanging',async t=>{
 await withAgent(t,(req,res)=>{
  res.writeHead(200,{'Content-Type':'application/json'});
  res.write('{"partial":');
  res.socket.destroy();
 });
 await assert.rejects(storageAgentJson('/broken',undefined,1000),error=>error.status===503);
});

test('oversized agent JSON is terminated at the byte cap',async t=>{
 await withAgent(t,(req,res)=>{res.writeHead(200);res.end('x'.repeat(4*1024*1024+1024));});
 await assert.rejects(storageAgentJson('/huge',undefined,3000),
  error=>error.status===503&&/too large/.test(error.message));
});

test('trickling agent responses cannot extend the absolute deadline',async t=>{
 await withAgent(t,(req,res)=>{
  res.writeHead(200);
  const interval=setInterval(()=>res.write(' '),10);
  res.on('close',()=>clearInterval(interval));
 });
 const started=Date.now();
 await assert.rejects(storageAgentJson('/slow',undefined,90),
  error=>error.status===503&&/timed out/.test(error.message));
 assert.ok(Date.now()-started<1000);
});

test('malformed JSON fails without accepting a partial agent result',async t=>{
 await withAgent(t,(req,res)=>{res.writeHead(200);res.end('{"ok":');});
 await assert.rejects(storageAgentJson('/malformed'),SyntaxError);
});
