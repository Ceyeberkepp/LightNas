import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {ProtectionAdapter} from '../src/storage-agent/protection.js';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import {digest} from '../src/storage-agent/storage.js';

const created='tank/data@lightnas-BackupTask-1700000000';
const older=['tank/data@lightnas-BackupTask-1699999998','tank/data@lightnas-BackupTask-1699999999'];
const FIXTURE_DIR=mkdtempSync(join(tmpdir(),'lightnas-retention-replication-'));
const FIXTURE_KEY='isolated replication private key fixture';
const FIXTURE_HOST_KEY='backup.example ssh-ed25519 isolated pinned host key fixture';
mkdirSync(join(FIXTURE_DIR,'protection'),{mode:0o700});
chmodSync(join(FIXTURE_DIR,'protection'),0o700);
writeFileSync(join(FIXTURE_DIR,'protection','RemoteBackup.key'),FIXTURE_KEY,{mode:0o600});
writeFileSync(join(FIXTURE_DIR,'protection','RemoteBackup.known_hosts'),FIXTURE_HOST_KEY,{mode:0o600});
after(()=>rmSync(FIXTURE_DIR,{recursive:true,force:true}));

function isolatedJob({visible=[true],replication=false,prune=older,failSend=false,sourceGuid='81234567',targetGuid='81234567',sourceCheckOk=true,targetCheckOk=true,datasetGuid='12345',datasetCheckOk=true}={}){
 const commands=[],events=[];
 let inventoryReads=0,sourceGuidReads=0,datasetGuidReads=0;
 const datasets={inventory:async()=>{
  const present=visible[Math.min(inventoryReads++,visible.length-1)];
  events.push('inventory:'+present);
  return {available:true,snapshots:present?[{name:created}]:[]};
 }};
 const adapter=new ProtectionAdapter({
  dir:FIXTURE_DIR,
  datasets,
  run:async(bin,args)=>{
   if(args[0]==='get'&&args.includes('guid')&&args.at(-1)==='tank/data'){
    events.push('verify-dataset-guid');
    const value=Array.isArray(datasetGuid)?datasetGuid[Math.min(datasetGuidReads++,datasetGuid.length-1)]:datasetGuid;
    return {ok:datasetCheckOk,stdout:String(value)+'\n'};
   }
   if(args[0]==='get'&&args.includes('guid')){
    events.push('verify-source-guid');
    const value=Array.isArray(sourceGuid)?sourceGuid[Math.min(sourceGuidReads++,sourceGuid.length-1)]:sourceGuid;
    return {ok:sourceCheckOk,stdout:value+'\n'};
   }
   if(bin==='/usr/bin/ssh'&&args.at(-1).startsWith('zfs get ')){
    events.push('verify-target-guid');
    return {ok:targetCheckOk,stdout:targetGuid+'\n'};
   }
   commands.push({bin,args});
   events.push(args[0]+':'+args[1]);
   return {ok:true};
  },
  pipeline:async()=>{
   events.push('remote-send');
   if(failSend)throw Error('Injected remote send failure');
  }
 });
 adapter.init=async()=>{};
 const impact={
  type:'protection.run',
  context:{
   task:{id:'BackupTask',kind:replication?'replication':'snapshot',source:'tank/data',...(replication?{profile:'RemoteBackup'}:{})},
   source:{name:'tank/data',guid:'12345'},
   snapshot:created,
   prune,
   ...(replication?{credentialState:{key:digest(FIXTURE_KEY),hostKey:digest(FIXTURE_HOST_KEY)},pipeline:[{bin:'zfs',args:['send',created]},{bin:'/usr/bin/ssh',args:['-F','/dev/null','-o','UserKnownHostsFile='+join(FIXTURE_DIR,'protection','RemoteBackup.known_hosts'),'-i',join(FIXTURE_DIR,'protection','RemoteBackup.key'),'receive']}],remoteVerification:{source:{bin:'/usr/sbin/zfs',args:['get','-H','-o','value','guid',created]},target:{bin:'/usr/bin/ssh',args:['-F','/dev/null','-o','UserKnownHostsFile='+join(FIXTURE_DIR,'protection','RemoteBackup.known_hosts'),'-i',join(FIXTURE_DIR,'protection','RemoteBackup.key'),'zfs get -H -o value guid backup/data@lightnas-BackupTask-1700000000']},snapshot:'backup/data@lightnas-BackupTask-1700000000'}}:{})
  },
  commands:[{bin:'/usr/sbin/zfs',args:['snapshot',created]}],
  result:{id:'BackupTask',kind:replication?'replication':'snapshot'}
 };
 return {adapter,impact,commands,events,reads:()=>inventoryReads};
}

test('backup source dataset GUID is verified before snapshot and each retention deletion',async()=>{
 const {adapter,impact,commands,events}=isolatedJob();
 await adapter.apply(impact);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot','destroy','destroy']);
 assert.equal(events.filter(e=>e==='verify-dataset-guid').length,3);
 assert.ok(events.indexOf('verify-dataset-guid')<events.indexOf('snapshot:'+created));
});

test('failure injection: replaced source dataset before execution prevents any ZFS operation',async()=>{
 const {adapter,impact,commands}=isolatedJob({datasetGuid:'99999'});
 await assert.rejects(adapter.apply(impact),/Backup source dataset identity changed/);
 assert.deepEqual(commands,[]);
});

test('failure injection: unavailable source dataset identity prevents snapshot creation',async()=>{
 const {adapter,impact,commands}=isolatedJob({datasetCheckOk:false});
 await assert.rejects(adapter.apply(impact),/Backup source dataset identity changed/);
 assert.deepEqual(commands,[]);
});

test('failure injection: missing planned dataset identity cannot authorize snapshot creation',async()=>{
 const {adapter,impact,commands}=isolatedJob();
 delete impact.context.source;
 await assert.rejects(adapter.apply(impact),/Backup source dataset identity missing/);
 assert.deepEqual(commands,[]);
});

test('failure injection: source dataset replacement before first retention preserves all old snapshots',async()=>{
 const {adapter,impact,commands}=isolatedJob({datasetGuid:['12345','99999']});
 await assert.rejects(adapter.apply(impact),/Backup source dataset identity changed/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: source dataset replacement between retention deletes stops further pruning',async()=>{
 const {adapter,impact,commands}=isolatedJob({datasetGuid:['12345','12345','99999']});
 await assert.rejects(adapter.apply(impact),/Backup source dataset identity changed/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot','destroy']);
 assert.deepEqual(commands[1].args,['destroy',older[0]]);
});

test('failure injection: source dataset changes before remote send and replication never starts',async()=>{
 const {adapter,impact,commands,events}=isolatedJob({replication:true,datasetGuid:['12345','99999']});
 await assert.rejects(adapter.apply(impact),/Backup source dataset identity changed/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
 assert.equal(events.includes('remote-send'),false);
});

test('failure injection: successful snapshot command without ZFS inventory proof never prunes older recovery points',async()=>{
 const {adapter,impact,commands,events}=isolatedJob({visible:[false]});
 await assert.rejects(adapter.apply(impact),/Created snapshot not verified/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
 assert.equal(events.some(e=>e.startsWith('destroy:')),false);
});

test('verified snapshot can complete retention only after inventory checks',async()=>{
 const {adapter,impact,commands,events,reads}=isolatedJob();
 const result=await adapter.apply(impact);
 assert.equal(result.snapshot,created);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot','destroy','destroy']);
 assert.equal(reads(),3,'verify before retention and before each destructive prune');
 assert.ok(events.indexOf('inventory:true')<events.indexOf('destroy:'+older[0]));
});

test('failure injection: snapshot disappearing during remote transfer prevents any retention deletion',async()=>{
 const {adapter,impact,commands,events}=isolatedJob({visible:[true,false],replication:true});
 await assert.rejects(adapter.apply(impact),/Created snapshot not verified/);
 assert.ok(events.includes('remote-send'));
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: remote send error retains every older snapshot',async()=>{
 const {adapter,impact,commands}=isolatedJob({replication:true,failSend:true});
 await assert.rejects(adapter.apply(impact),/Injected remote send failure/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: snapshot loss between retention deletions stops remaining pruning',async()=>{
 const {adapter,impact,commands}=isolatedJob({visible:[true,true,false]});
 await assert.rejects(adapter.apply(impact),/Created snapshot not verified/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot','destroy']);
 assert.deepEqual(commands[1].args,['destroy',older[0]]);
});



test('local retention requires a stable created snapshot GUID before deleting recovery points',async()=>{
 const {adapter,impact,commands,events}=isolatedJob();
 await adapter.apply(impact);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot','destroy','destroy']);
 assert.equal(events.filter(e=>e==='verify-source-guid').length,3);
 assert.ok(events.indexOf('verify-source-guid')<events.indexOf('destroy:'+older[0]));
});

test('failure injection: snapshot GUID lookup failure prevents all local retention',async()=>{
 const {adapter,impact,commands}=isolatedJob({sourceCheckOk:false});
 await assert.rejects(adapter.apply(impact),/Created snapshot GUID not verified/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: replaced snapshot identity before first prune retains every older snapshot',async()=>{
 const {adapter,impact,commands}=isolatedJob({sourceGuid:['81234567','99999999']});
 await assert.rejects(adapter.apply(impact),/Created snapshot identity changed before retention/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: snapshot identity replacement between local retention deletes stops remaining pruning',async()=>{
 const {adapter,impact,commands}=isolatedJob({sourceGuid:['81234567','81234567','99999999']});
 await assert.rejects(adapter.apply(impact),/Created snapshot identity changed before retention/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot','destroy']);
 assert.deepEqual(commands[1].args,['destroy',older[0]]);
});

test('failure injection: malformed created snapshot GUID cannot authorize local retention',async()=>{
 const {adapter,impact,commands}=isolatedJob({sourceGuid:'81234567\\nUnexpected output'});
 await assert.rejects(adapter.apply(impact),/Created snapshot GUID not verified/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('verified remote replica GUID permits retention only after the receive and both GUID checks',async()=>{
 const {adapter,impact,commands,events}=isolatedJob({replication:true});
 await adapter.apply(impact);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot','destroy','destroy']);
 assert.ok(events.indexOf('remote-send')<events.indexOf('verify-source-guid'));
 assert.ok(events.indexOf('verify-source-guid')<events.indexOf('verify-target-guid'));
 assert.ok(events.indexOf('verify-target-guid')<events.indexOf('destroy:'+older[0]));
});

test('failure injection: successful remote receive with a different snapshot GUID retains older recovery points',async()=>{
 const {adapter,impact,commands}=isolatedJob({replication:true,targetGuid:'81234568'});
 await assert.rejects(adapter.apply(impact),/Remote replica snapshot GUID not verified/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: remote replica GUID lookup fails after receive and no retention is attempted',async()=>{
 const {adapter,impact,commands}=isolatedJob({replication:true,targetCheckOk:false});
 await assert.rejects(adapter.apply(impact),/Remote replica snapshot GUID not verified/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: local snapshot GUID lookup fails and no retention is attempted',async()=>{
 const {adapter,impact,commands}=isolatedJob({replication:true,sourceCheckOk:false});
 await assert.rejects(adapter.apply(impact),/Remote replica snapshot GUID not verified/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: malformed remote GUID output cannot authorize destructive retention',async()=>{
 const {adapter,impact,commands}=isolatedJob({replication:true,targetGuid:'81234567\nUnexpected banner'});
 await assert.rejects(adapter.apply(impact),/Remote replica snapshot GUID not verified/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: missing replica verification plan cannot authorize retention',async()=>{
 const {adapter,impact,commands}=isolatedJob({replication:true});
 delete impact.context.remoteVerification;
 await assert.rejects(adapter.apply(impact),/Remote replica verification missing/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: source snapshot replacement during retention stops further pruning',async()=>{
 const {adapter,impact,commands}=isolatedJob({replication:true,sourceGuid:['81234567','81234567','99999999']});
 await assert.rejects(adapter.apply(impact),/Replicated source snapshot changed before retention/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot','destroy']);
 assert.deepEqual(commands[1].args,['destroy',older[0]]);
});

test('replication plan pins SSH host identity and verifies the exact received ZFS snapshot GUID',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lightnas-replica-plan-'));
 try{
  const config=join(dir,'protection');
  await mkdir(config,{recursive:true});
  await writeFile(join(config,'RemoteBackup.key'),'isolated-fake-key');
  await writeFile(join(config,'RemoteBackup.known_hosts'),'backup.example ssh-ed25519 isolated-fake-host-key');
  const datasets={inventory:async()=>({available:true,datasets:[{name:'tank/data',guid:'12345'}],snapshots:[]})};
  const adapter=new ProtectionAdapter({dir,datasets});
  adapter.registry=async()=>({
   tasks:[{id:'BackupTask',kind:'replication',source:'tank/data',target:'backup/data',retention:7,mode:'copy',direction:'push',profile:'RemoteBackup',schedule:{frequency:'on-demand'},enabled:true}],
   cloudRemotes:[],
   replicationProfiles:[{name:'RemoteBackup',host:'backup.example',user:'backup',port:22}]
  });
  const impact=await adapter.plan({type:'protection.run',id:'BackupTask',runStamp:1700000000});
  assert.equal(impact.context.remoteVerification.snapshot,'backup/data/lightnas-BackupTask-1700000000@lightnas-BackupTask-1700000000');
  assert.deepEqual(impact.context.remoteVerification.source.args,['get','-H','-o','value','guid',created]);
  const ssh=impact.context.remoteVerification.target.args;
  assert.deepEqual(ssh.slice(0,2),['-F','/dev/null'],'Ignore ambient user/system SSH config');
  assert.ok(ssh.includes('StrictHostKeyChecking=yes'));
  assert.ok(ssh.includes('GlobalKnownHostsFile=/dev/null'),'Never trust ambient global host keys');
  assert.ok(ssh.includes('VerifyHostKeyDNS=no'),'DNS SSHFP must not override the pinned host key');
  assert.ok(ssh.includes('UpdateHostKeys=no'),'Do not silently expand host key trust');
  assert.ok(ssh.includes('UserKnownHostsFile='+join(config,'RemoteBackup.known_hosts')));
  assert.equal(ssh.at(-1),'zfs get -H -o value guid '+impact.context.remoteVerification.snapshot);
  assert.equal(impact.context.pipeline[1].args.at(-1),'zfs receive -u backup/data/lightnas-BackupTask-1700000000');
 }finally{await rm(dir,{recursive:true,force:true});}
});
