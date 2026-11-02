import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatasetAdapter,PRESETS,datasetName,dataPath,snapshotName} from '../src/storage-agent/datasets.js';
import {ProtectionAdapter,nextRun} from '../src/storage-agent/protection.js';
import {CertificateAdapter} from '../src/storage-agent/certificates.js';
import {FeatureAdapter} from '../src/storage-agent/features.js';
import {Operations,publicJob} from '../src/storage-agent/operations.js';
import {command} from '../src/storage-agent/storage.js';
function datasetFixture(){
 const datasets=[{name:'tank',type:'filesystem',guid:'1',mountpoint:'/mnt/tank',compression:'lz4',quota:'none',atime:'off'}],snapshots=[],calls=[];let failSet=false;
 const adapter=new DatasetAdapter({run:async(bin,args)=>{calls.push([bin,...args]);if(args[0]==='set'&&failSet){failSet=false;return {ok:false,stderr:'write failed'};}if(args[0]==='create'){const target=args.at(-1);datasets.push({name:target,guid:'2',type:args.includes('-V')?'volume':'filesystem',mountpoint:'/mnt/'+target});}if(args[0]==='snapshot')snapshots.push({name:args[1],used:0,created:1});if(args[0]==='get')return {ok:true,stdout:args.includes('value,source')?'none\tlocal\n':args[args.length-2].startsWith('userquota@')?'none\n':'100G\n'};return {ok:true,stdout:'alice:x:1000:1000:Alice:/home/alice:/bin/sh\n'};}});
 adapter.inventory=async()=>({available:true,datasets:structuredClone(datasets),snapshots:structuredClone(snapshots)});adapter.directory=async d=>({path:d.mountpoint,uid:0,gid:0,mode:'770',ino:1,dev:1});
 return {adapter,calls,datasets,snapshots,failSet:()=>{failSet=true;}};
}
test('dataset presets generate typed commands, expose encryption inheritance and verify creation',async()=>{
 const f=datasetFixture();for(const preset of Object.keys(PRESETS)){const impact=await f.adapter.plan({type:'dataset.create',parent:'tank',name:preset,preset,quotaGiB:100});assert.equal(impact.after.encryption,'Inherited from parent');assert.ok(impact.commands[0].args.includes('compression=lz4'));assert.ok(impact.commands[0].args.includes('quota=100G'));await f.adapter.validate(impact);await f.adapter.apply(impact);}
 assert.ok(f.calls.some(c=>c.includes('casesensitivity=mixed')));assert.ok(f.calls.some(c=>c.includes('acltype=posixacl')));
});
test('zvol creation is bounded, snapshots do not invoke recursive or destructive flags',async()=>{
 const f=datasetFixture();const volume=await f.adapter.plan({type:'zvol.create',parent:'tank',name:'disk',sizeGiB:20,sparse:true});assert.ok(volume.commands[0].args.includes('-V'));assert.ok(volume.commands[0].args.includes('-s'));assert.ok(!volume.commands[0].args.some(a=>a.startsWith('atime=')||a.startsWith('acltype=')));await f.adapter.apply(volume);
 const snap=await f.adapter.plan({type:'snapshot.create',dataset:'tank',name:'manual'});assert.deepEqual(snap.commands[0].args,['snapshot','tank@manual']);await f.adapter.apply(snap);assert.equal(f.snapshots.length,1);
 await assert.rejects(f.adapter.plan({type:'zvol.create',parent:'tank',name:'too-big',sizeGiB:-1}));
});
test('dataset identity or property drift invalidates approval; rejected writes retain rollback attempts',async()=>{
 const f=datasetFixture();const impact=await f.adapter.plan({type:'dataset.update',dataset:'tank',property:'quota',value:'100G'});f.datasets[0].guid='changed';await assert.rejects(f.adapter.validate(impact),/changed/);f.datasets[0].guid='1';f.failSet();await assert.rejects(f.adapter.apply(impact),error=>error.recovery.length===1);assert.ok(f.calls.some(c=>c.includes('quota=none')));
});
test('directory permission changes are nonrecursive and injection/system paths fail closed',async()=>{
 const f=datasetFixture();const impact=await f.adapter.plan({type:'dataset.permissions',dataset:'tank',uid:1000,gid:1000,mode:'770'});assert.ok(impact.commands.every(c=>!c.args.includes('-R')));
 for(const value of ['tank/../root','-tank','tank;reboot'])assert.throws(()=>datasetName(value));for(const path of ['/etc','/mnt/../etc','/mnt/data\nreboot'])assert.throws(()=>dataPath(path));assert.throws(()=>snapshotName('tank@bad;name'));
 await assert.rejects(f.adapter.plan({type:'dataset.update',dataset:'tank',property:'mountpoint',value:'/etc'}));await assert.rejects(f.adapter.plan({type:'dataset.quota',dataset:'tank',kind:'user',subject:'alice;whoami',quotaGiB:1}));
});
test('UTC schedules handle hour/day/week boundaries and reject invalid times',()=>{
 assert.equal(nextRun({frequency:'hourly',time:'04:15'},new Date('2026-10-13T23:20:00Z')),'2026-10-14T00:15:00.000Z');assert.equal(nextRun({frequency:'daily',time:'04:00'},new Date('2026-10-13T05:00:00Z')),'2026-10-14T04:00:00.000Z');assert.equal(nextRun({frequency:'weekly',time:'04:00',weekday:2},new Date('2026-10-13T05:00:00Z')),'2026-10-20T04:00:00.000Z');assert.equal(nextRun({frequency:'on-demand'}),null);assert.throws(()=>nextRun({frequency:'daily',time:'25:00'}));
});
async function protectionFixture(){const dir=await mkdtemp(join(tmpdir(),'nas-protection-')),f=datasetFixture();const calls=[];const adapter=new ProtectionAdapter({dir,datasets:f.adapter,run:async(bin,args)=>{calls.push([bin,...args]);if(args[0]==='get'&&args.includes('guid'))return {ok:true,stdout:'81234567\n'};if(bin==='/usr/bin/ssh'&&args.at(-1).startsWith('zfs get '))return {ok:true,stdout:'81234567\n'};if(args[0]==='snapshot')f.snapshots.push({name:args[1],created:10});if(args[0]==='destroy')f.snapshots.splice(f.snapshots.findIndex(s=>s.name===args[1]),1);return {ok:true,stdout:''};},pipeline:async()=>{}});await adapter.init();adapter.directory=async path=>({path:dataPath(path),ino:1,dev:path.includes('source')?1:2});return {dir,f,calls,adapter};}
test('approved recurring snapshot retention never deletes another task’s snapshots',async()=>{
 const p=await protectionFixture();await p.adapter.apply(await p.adapter.plan({type:'protection.task.save',id:'daily',kind:'snapshot',source:'tank',retention:1,schedule:{frequency:'daily',time:'04:00'}}));
 p.f.snapshots.push({name:'tank@lightnas-daily-1',created:1},{name:'tank@lightnas-daily-other-1',created:0},{name:'tank@manual',created:0});const impact=await p.adapter.plan({type:'protection.run',id:'daily',runStamp:100});assert.deepEqual(impact.context.prune,['tank@lightnas-daily-1']);assert.equal(impact.dataErased,true);await p.adapter.apply(impact);assert.ok(p.f.snapshots.some(s=>s.name==='tank@manual'));assert.ok(p.f.snapshots.some(s=>s.name==='tank@lightnas-daily-other-1'));
});
test('rsync copies use argv, safe links and no deletion; nested destinations are rejected',async()=>{
 const p=await protectionFixture();await assert.rejects(p.adapter.plan({type:'protection.task.save',id:'copy',kind:'rsync',source:'/mnt/source',target:'/mnt/source/backups'}),/separate/);await p.adapter.apply(await p.adapter.plan({type:'protection.task.save',id:'copy',kind:'rsync',source:'/mnt/source',target:'/mnt/target'}));const run=await p.adapter.plan({type:'protection.run',id:'copy',runStamp:1});assert.ok(run.commands[0].args.includes('--safe-links'));assert.ok(!run.commands[0].args.includes('--delete'));await p.adapter.apply(run);
});
test('cloud credentials are root-only, redacted from public previews and restricted to supported fields',async()=>{
 const p=await protectionFixture();const impact=await p.adapter.plan({type:'cloud.remote.save',name:'remote',provider:'s3',private:{credentials:{provider:'AWS',access_key_id:'key',secret_access_key:'PRIVATE_VALUE'}}});assert.ok(!JSON.stringify(publicJob(impact)).includes('PRIVATE_VALUE'));await p.adapter.apply(impact);assert.equal((await stat(join(p.adapter.dir,'rclone.conf'))).mode&0o777,0o600);
 await assert.rejects(p.adapter.plan({type:'cloud.remote.save',name:'evil',provider:'s3',private:{credentials:{remote:'/etc'}}}));
 await p.adapter.apply(await p.adapter.plan({type:'protection.task.save',id:'cloudcopy',kind:'cloud',source:'/mnt/source',target:'remote:backup'}));const plan=await p.adapter.plan({type:'protection.run',id:'cloudcopy',runStamp:1});assert.equal(plan.commands[0].args[0],'copy');await writeFile(join(p.adapter.dir,'rclone.conf'),'changed');await assert.rejects(p.adapter.validate(plan),/changed/);
});
test('SSH replication pins host keys and uses a new non-force destination',async()=>{
 const p=await protectionFixture();const profile=await p.adapter.plan({type:'replication.profile.save',name:'sshhost',host:'backup.example.test',user:'backup',private:{privateKey:'-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----',hostKey:'ssh-ed25519 '+ 'A'.repeat(48)}});await p.adapter.apply(profile);
 await p.adapter.apply(await p.adapter.plan({type:'protection.task.save',id:'replica',kind:'replication',source:'tank',target:'backup/incoming',profile:'sshhost'}));const run=await p.adapter.plan({type:'protection.run',id:'replica',runStamp:100});assert.ok(run.context.pipeline[1].args.includes('StrictHostKeyChecking=yes'));assert.match(run.context.pipeline[1].args.at(-1),/^zfs receive -u backup\/incoming\/lightnas-replica-100$/);assert.ok(!run.context.pipeline[1].args.includes('-F'));await p.adapter.apply(run);assert.ok(p.calls.some(c=>c[0]==='/usr/sbin/zfs'&&c[1]==='get'&&c.includes('guid')));assert.ok(p.calls.some(c=>c[0]==='/usr/bin/ssh'&&c.at(-1).startsWith('zfs get -H -o value guid ')));
});
test('certificate import verifies matching key, preserves secrets and provides valid CSR download',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nas-certificates-'));const key=join(dir,'key.pem'),pem=join(dir,'cert.pem');const generated=await command('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',pem,'-days','1','-subj','/CN=nas.example.test']);assert.equal(generated.ok,true);
 const certs=new CertificateAdapter({dir});await certs.init();const input={type:'certificate.import',name:'imported',private:{certificate:await readFile(pem,'utf8'),privateKey:await readFile(key,'utf8')}};const impact=await certs.plan(input);assert.match(impact.after.subject,/nas.example.test/);assert.ok(!JSON.stringify(publicJob(impact)).includes('PRIVATE KEY'));await certs.apply(impact);assert.equal((await stat(certs.path('imported','.key'))).mode&0o777,0o600);
 await assert.rejects(certs.plan({...input,private:{...input.private,privateKey:'bad key'}}),/match/);
 const csr=await certs.plan({type:'certificate.csr',name:'request',domains:['nas.example.test']});await certs.apply(csr);assert.match((await certs.download('request')).csr,/BEGIN CERTIFICATE REQUEST/);await assert.rejects(certs.plan({type:'certificate.csr',name:'request',domains:['nas.example.test']}),/new name/);
});
test('ACME uses DNS authenticator and confined paths without exposing its token',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nas-acme-'));const certs=new CertificateAdapter({dir,run:async()=>({ok:true,stdout:'dns-cloudflare'})});await certs.init();const profile=await certs.plan({type:'dns.profile.save',name:'zone',provider:'cloudflare',private:{apiToken:'A'.repeat(40)}});await certs.apply(profile);assert.ok(!JSON.stringify(publicJob(profile)).includes('A'.repeat(40)));
 const plan=await certs.plan({type:'certificate.acme',name:'nas-cert',domains:['nas.example.test'],email:'admin@example.test',profile:'zone'});assert.ok(plan.commands[0].args.includes('--dns-cloudflare'));assert.ok(plan.commands[0].args.includes('--config-dir'));assert.ok(!plan.commands[0].args.includes('--install-cert'));await assert.rejects(certs.plan({type:'certificate.csr',name:'bad-csr',domains:['nas.example.test;reboot']}));
});
test('feature jobs require approval and support cancellation before executing root work',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nas-feature-job-'));let applied=0;const features={prepare:i=>i,plan:async i=>({type:i.type,input:i,rollback:'inspection'}),validate:async()=>{},apply:async()=>{applied++;return {ok:true};}};const ops=new Operations({dir,features,adapter:{},discover:async()=>({})});await ops.init();const preview=await ops.preview({type:'snapshot.create'});await assert.rejects(ops.approve(preview.id,'bad'));const done=new Promise(resolve=>ops.on('progress',j=>{if(j.status==='cancelled')resolve();}));await ops.approve(preview.id,preview.approvalHash);await ops.cancel(preview.id);await done;assert.equal(applied,0);
});
test('scheduler persists next runs and executes only approved enabled recurring policies',async()=>{
 const p=await protectionFixture();await p.adapter.apply(await p.adapter.plan({type:'protection.task.save',id:'scheduled',kind:'snapshot',source:'tank',schedule:{frequency:'daily',time:'04:00'}}));await p.adapter.record('scheduled',{nextRun:'2020-01-01T00:00:00Z'});
 const features=new FeatureAdapter({datasets:p.f.adapter,protection:p.adapter,certificates:{registry:async()=>({certificates:[]})}});let previews=0,approvals=0;const ops={busy:false,jobs:new Map(),preview:async input=>{assert.equal(input.id,'scheduled');previews++;return {id:'job',approvalHash:'hash'};},approve:async()=>{approvals++;ops.busy=true;}};const scheduler=features.startScheduler(ops);await scheduler.tick();scheduler.stop();assert.equal(previews,1);assert.equal(approvals,1);const runtime=await p.adapter.runtime();assert.equal(runtime.scheduled.lastJob,'job');assert.ok(Date.parse(runtime.scheduled.nextRun)>Date.now());
});
test('mirror and cloud pull policies expose deletion confirmation and reversed transfer arguments',async()=>{
 const p=await protectionFixture();await p.adapter.apply(await p.adapter.plan({type:'cloud.remote.save',name:'remote',provider:'s3',private:{credentials:{provider:'AWS',access_key_id:'key',secret_access_key:'secret'}}}));
 const policy=await p.adapter.plan({type:'protection.task.save',id:'mirrorjob',kind:'cloud',source:'/mnt/source',target:'remote:backup',mode:'mirror',direction:'pull'});assert.equal(policy.confirmation,'AUTHORIZE MIRROR mirrorjob');assert.equal(policy.dataErased,true);await p.adapter.apply(policy);
 const run=await p.adapter.plan({type:'protection.run',id:'mirrorjob',runStamp:2});assert.equal(run.confirmation,'MIRROR /mnt/source');assert.equal(run.commands[0].args[0],'sync');assert.deepEqual(run.commands[0].args.slice(-2),['remote:backup','/mnt/source']);
});
test('root feature reads require authentication and never expose private material',async t=>{
 const {createServer}=await import('../src/storage-agent/server.js');const token='a'.repeat(32);const ops={jobs:new Map(),features:{inventory:async()=>({certificates:{private:{privateKey:'DO_NOT_EXPOSE'},certificates:[]}}),datasetDetail:async name=>({name:datasetName(name)}),certificates:{download:async name=>({name,csr:'PUBLIC CSR'})}}};const server=createServer({token,ops,discover:async()=>({}),agent:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+'/v1/features')).status,401);const headers={Authorization:'Bearer '+token};const response=await fetch(base+'/v1/features',{headers});assert.equal(response.status,200);assert.ok(!(await response.text()).includes('DO_NOT_EXPOSE'));assert.equal((await fetch(base+'/v1/dataset?name=tank%3Bbad',{headers})).status,400);assert.equal((await fetch(base+'/v1/csr?name=request',{headers})).status,200);
});
test('protection allows managed NAS files while refusing state/configuration directories',async()=>{
 const {mkdir}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'nas-protection-paths-'));const previous=process.env.NAS_DATA_FILE;process.env.NAS_DATA_FILE=join(dir,'state.json');
 try{await mkdir(join(dir,'files'));const adapter=new ProtectionAdapter({dir,datasets:datasetFixture().adapter});assert.equal((await adapter.directory(join(dir,'files'))).path,join(dir,'files'));await assert.rejects(adapter.directory(dir));await assert.rejects(adapter.directory(join(dir,'files','..')));}
 finally{if(previous===undefined)delete process.env.NAS_DATA_FILE;else process.env.NAS_DATA_FILE=previous;}
});
test('saving another cloud connection preserves OAuth credentials refreshed by rclone',async()=>{
 const p=await protectionFixture();await p.adapter.apply(await p.adapter.plan({type:'cloud.remote.save',name:'drive',provider:'drive',private:{credentials:{token:'{"access_token":"OLD"}'}}}));await writeFile(join(p.adapter.dir,'rclone.conf'),'[drive]\ntype = drive\ntoken = {"access_token":"REFRESHED"}\n');
 await p.adapter.apply(await p.adapter.plan({type:'cloud.remote.save',name:'second',provider:'s3',private:{credentials:{provider:'AWS',access_key_id:'key',secret_access_key:'secret'}}}));assert.match(await readFile(join(p.adapter.dir,'rclone.conf'),'utf8'),/REFRESHED/);
});
