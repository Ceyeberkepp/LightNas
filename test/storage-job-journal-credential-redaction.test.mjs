import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Operations,safeJournalSnapshot} from '../src/storage-agent/operations.js';

const CLOUD_SECRET='ISOLATED-AWS-ACCESS-DO-NOT-PERSIST-123';
const SSH_SECRET='-----BEGIN PRIVATE KEY-----ISOLATED-TEST-NOT-A-KEY';
const TOKEN_SECRET='ISOLATED-OAUTH-ACCESS-TOKEN-9876';

async function instance(t){
 const dir=await mkdtemp(join(tmpdir(),'lightnas-job-secret-journal-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const ops=new Operations({dir,adapter:{},discover:async()=>({disks:[],filesystems:[]})});
 await ops.init();
 return {ops,dir};
}
const sampleJob=()=>({
 id:'credentials-preview-1',status:'preview',logs:[],
 approvalHash:'expected-checksum',createdAt:'2026-11-02T12:00:00Z',
 expiresAt:Date.now()+300000,
 impact:{
  type:'cloud.remote.save',
  input:{type:'cloud.remote.save',name:'RemoteBackup',
   private:{credentials:{secret_access_key:CLOUD_SECRET,access_key_id:'SHOULD-NOT-STORE-ACCESS-KEY'}}},
  private:{credentials:{clientSecret:TOKEN_SECRET},previousFile:{RemoteBackup:{token:TOKEN_SECRET}}},
  before:{tasks:[]},after:{tasks:[]},
  result:{name:'RemoteBackup',credentialFingerprint:'hash-not-secret'}
 },
 progress:0,events:[]
});

test('credential-bearing job previews are volatile and never written to jobs.json',async t=>{
 const {ops,dir}=await instance(t);
 const job=sampleJob();
 ops.jobs.set(job.id,job);
 await ops.save();
 const disk=await readFile(join(dir,'jobs.json'),'utf8');
 for(const secret of [CLOUD_SECRET,TOKEN_SECRET,'SHOULD-NOT-STORE-ACCESS-KEY'])
  assert.equal(disk.includes(secret),false,'credential leaked into persistent job history');
 const saved=JSON.parse(disk)[0];
 assert.equal(saved.impact.private,undefined);
 assert.equal(saved.impact.input.private,undefined);
 assert.equal(saved.impact.result.credentialFingerprint,undefined);
 assert.equal(saved.approvalHash,'expected-checksum');
 // The active approval still holds secret material in RAM until completed.
 assert.equal(ops.jobs.get(job.id).impact.private.credentials.clientSecret,TOKEN_SECRET);
});

test('restart expires unsatisfied approvals rather than trying to run without ephemeral secrets',async t=>{
 const {ops,dir}=await instance(t);
 const job=sampleJob();
 ops.jobs.set(job.id,job);
 await ops.save();
 const restarted=new Operations({dir,adapter:{},discover:async()=>({disks:[],filesystems:[]})});
 await restarted.init();
 assert.equal(restarted.jobs.get(job.id).status,'interrupted');
 assert.equal(restarted.jobs.get(job.id).impact.private,undefined);
 await assert.rejects(restarted.approve(job.id,job.approvalHash),/Invalid, expired or already used approval/);
});

test('old journals are scrubbed on recovery without exposing the stale private key',async t=>{
 const {dir}=await instance(t);
 const legacy=sampleJob();
 legacy.impact.input.private={privateKey:SSH_SECRET};
 await writeFile(join(dir,'jobs.json'),JSON.stringify([legacy]),{mode:0o600});
 const restarted=new Operations({dir,adapter:{},discover:async()=>({disks:[],filesystems:[]})});
 await restarted.init();
 const disk=await readFile(join(dir,'jobs.json'),'utf8');
 assert.equal(disk.includes(SSH_SECRET),false);
 assert.equal(disk.includes(TOKEN_SECRET),false);
 assert.equal(restarted.jobs.get(legacy.id).impact.input.private,undefined);
 assert.equal(restarted.jobs.get(legacy.id).status,'interrupted');
});

test('safe journal filter redacts credential fields recursively but preserves nonsecret operational evidence',()=>{
 const value={id:'run-1',status:'succeeded',
  context:{endpoint:'backup.example.org',apiKey:'demo',password:'secret',
   network:{token:'access',privateKey:'key',result:{expected:'ok'}}}};
 assert.deepEqual(safeJournalSnapshot(value),{
  id:'run-1',status:'succeeded',
  context:{endpoint:'backup.example.org',network:{result:{expected:'ok'}}}
 });
});
