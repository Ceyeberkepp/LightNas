import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {X509Certificate,createHash} from 'node:crypto';
import {createReplicaServer,LdsRemoteStore} from '../src/lds-transport.mjs';

test('authenticated replica round trip, allowlist rejection and deadline', async t=>{
 const dir=await mkdtemp(join(tmpdir(),'lds-tls-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const ssl=(...args)=>execFileSync('openssl',args,{cwd:dir,stdio:'ignore'});
 ssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.crt','-subj','/CN=LDS test CA','-days','1');
 for(const name of ['server','client','other']){
  ssl('req','-newkey','rsa:2048','-nodes','-keyout',name+'.key','-out',name+'.csr','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost');
  ssl('x509','-req','-in',name+'.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-out',name+'.crt','-days','1','-copy_extensions','copy');
 }
 const read=n=>readFile(join(dir,n));
 const tls=async n=>({ca:await read('ca.crt'),cert:await read(n+'.crt'),key:await read(n+'.key')});
 const client=await tls('client');
 const chunks=new Map();
 const store={async put(b){const id=createHash('sha256').update(b).digest('hex');chunks.set(id,b);return id},async get(id){if(id==='0'.repeat(64))return new Promise(()=>{});return chunks.get(id)}};
 const server=createReplicaServer({store,tls:await tls('server'),allowedFingerprints:[new X509Certificate(client.cert).fingerprint256],timeoutMs:2000});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,resolve)});
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}));
 const url='https://localhost:'+server.address().port;
 const remote=new LdsRemoteStore({url,tls:client,timeoutMs:1000});
 const payload=Buffer.from('replica integrity test');
 const id=await remote.put(payload);
 assert.equal(id,createHash('sha256').update(payload).digest('hex'));
 assert.deepEqual(await remote.get(id),payload);
 const denied=new LdsRemoteStore({url,tls:await tls('other')});
 await assert.rejects(denied.get(id),/403/);
 chunks.set(id,Buffer.from('corrupt'));
 await assert.rejects(remote.get(id),/500/);
 const bounded=new LdsRemoteStore({url,tls:client,timeoutMs:200});
 await assert.rejects(bounded.get('0'.repeat(64)),/deadline/);
});
