import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,chmod,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProtectionAdapter,replicate} from '../src/storage-agent/protection.js';
import {digest} from '../src/storage-agent/storage.js';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'lightnas-backup-identity-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const config=join(dir,'protection');
 await mkdir(config,{recursive:true,mode:0o700});
 await chmod(config,0o700);
 const calls=[];
 const adapter=new ProtectionAdapter({
  dir,
  datasets:{inventory:async()=>({snapshots:[]})},
  run:async(bin,args)=>{calls.push({bin,args});return {ok:true,stdout:'12345\n'};}
 });
 return {adapter,config,calls};
}

test('cloud backup rejects credentials rotated after preview without running rclone',async t=>{
 const {adapter,config,calls}=await fixture(t);
 const file=join(config,'rclone.conf');
 await writeFile(file,'[Remote]\ntype = s3\naccess_key_id = first\n', {mode:0o600});
 const expected=digest('[Remote]\ntype = s3\naccess_key_id = first\n');
 const impact={type:'protection.run',context:{task:{kind:'cloud'},credentialState:expected},
  commands:[{bin:'/usr/bin/rclone',args:['copy','--config',join(config,'rclone.conf'),'--','/data/source','Remote:archive']}],result:{id:'Backup'}};
 await writeFile(file,'[Remote]\ntype = s3\naccess_key_id = second\n', {mode:0o600});
 await assert.rejects(adapter.apply(impact),/Cloud backup credentials changed since preview/);
 assert.deepEqual(calls,[],'No transfer may start with a different remote identity');
});

test('cloud backup requires a pinned preview identity and allows an unchanged one',async t=>{
 const {adapter,config,calls}=await fixture(t);
 const value='[Remote]\ntype = s3\naccess_key_id = pinned\n';
 await writeFile(join(config,'rclone.conf'),value, {mode:0o600});
 const impact={type:'protection.run',context:{task:{kind:'cloud'}},
  commands:[{bin:'/usr/bin/rclone',args:['copy','--config',join(config,'rclone.conf'),'--','/data/source','Remote:archive']}],result:{id:'Backup'}};
 await assert.rejects(adapter.apply(impact),/credential identity missing/);
 assert.deepEqual(calls,[]);
 impact.context.credentialState=digest(value);
 await assert.doesNotReject(adapter.apply(impact));
 assert.deepEqual(calls.map(x=>x.bin),['/usr/bin/rclone']);
});

test('replication refuses changed pinned SSH key or host key before ZFS mutation',async t=>{
 const {adapter,config,calls}=await fixture(t);
 const key=join(config,'RemoteBackup.key');
 const known=join(config,'RemoteBackup.known_hosts');
 await writeFile(key,'original private key fixture', {mode:0o600});
 await writeFile(known,'backup.example ssh-ed25519 original-host-key-fixture', {mode:0o600});
 const impact={type:'protection.run',context:{
  task:{kind:'replication',profile:'RemoteBackup',source:'tank/data'},
  source:{name:'tank/data',guid:'12345'},
  credentialState:{key:digest('original private key fixture'),hostKey:digest('backup.example ssh-ed25519 original-host-key-fixture')}
 },commands:[{bin:'/usr/sbin/zfs',args:['snapshot','tank/data@lightnas-Backup-1']}],result:{id:'Backup'}};
 await writeFile(known,'backup.example ssh-ed25519 substituted-host-key', {mode:0o600});
 await assert.rejects(adapter.apply(impact),/Replication SSH identity changed since preview/);
 assert.deepEqual(calls,[]);
 await writeFile(known,'backup.example ssh-ed25519 original-host-key-fixture', {mode:0o600});
 await writeFile(key,'substituted private key', {mode:0o600});
 await assert.rejects(adapter.apply(impact),/Replication SSH identity changed since preview/);
 assert.deepEqual(calls,[]);
});

test('failure injection: absent or incomplete replication preview identity cannot create a snapshot',async t=>{
 const {adapter,config,calls}=await fixture(t);
 await writeFile(join(config,'RemoteBackup.key'),'original private key fixture', {mode:0o600});
 await writeFile(join(config,'RemoteBackup.known_hosts'),'backup.example ssh-ed25519 original-host-key-fixture', {mode:0o600});
 const impact={type:'protection.run',context:{
  task:{kind:'replication',profile:'RemoteBackup',source:'tank/data'},
  source:{name:'tank/data',guid:'12345'}
 },commands:[{bin:'/usr/sbin/zfs',args:['snapshot','tank/data@lightnas-Backup-1']}],result:{id:'Backup'}};
 for(const state of [undefined,{}, {key:digest('original private key fixture')}, {hostKey:digest('backup.example ssh-ed25519 original-host-key-fixture')}]){
  impact.context.credentialState=state;
  await assert.rejects(adapter.apply(impact),/Replication credential identity missing or invalid/);
  assert.deepEqual(calls,[],'No ZFS operation is authorized without both pinned credentials');
 }
});

test('failure injection: cloud config rotated immediately before subprocess cannot redirect approved transfer',async t=>{
 const {config,adapter}=await fixture(t);
 const original='[Remote]\ntype = s3\naccess_key_id = approved\n';
 const changed='[Remote]\ntype = s3\naccess_key_id = attacker\n';
 const source=join(config,'rclone.conf');
 await writeFile(source,original,{mode:0o600});
 let observed,stagedPath;
 adapter.run=async(bin,args)=>{
  assert.equal(bin,'/usr/bin/rclone');
  await writeFile(source,changed);
  const staged=args[args.indexOf('--config')+1];
  stagedPath=staged;
  assert.ok(staged.startsWith('/dev/shm/lightnas-credential-run-'),'cloud credentials must use tmpfs');
  assert.notEqual(staged,source,'subprocess must not read mutable original credentials');
  observed=await readFile(staged,'utf8');
  return {ok:true,stdout:''};
 };
 const impact={type:'protection.run',context:{task:{kind:'cloud'},credentialState:digest(original)},
  commands:[{bin:'/usr/bin/rclone',args:['copy','--config',source,'--','/data/source','Remote:archive']}],
  result:{id:'Backup'}};
 await adapter.apply(impact);
 assert.equal(observed,original);
 assert.equal(await readFile(source,'utf8'),changed);
 await assert.rejects(readFile(stagedPath,'utf8'),{code:'ENOENT'},'ephemeral credential copy must be removed');
 assert.deepEqual((await readdir(config)).filter(n=>n.startsWith('.credential-run-')),[],'private credentials must be removed after execution');
});

test('failure injection: replication uses pinned SSH identity even when originals rotate before receive',async t=>{
 const {config}=await fixture(t);
 const key=join(config,'RemoteBackup.key'),known=join(config,'RemoteBackup.known_hosts');
 const approvedKey='approved private key',approvedHost='backup.example ssh-ed25519 approved-host-key';
 await writeFile(key,approvedKey,{mode:0o600});
 await writeFile(known,approvedHost,{mode:0o600});
 const snapshot='tank/data@lightnas-Backup-123';
 let pipelineChecked=false,remoteChecked=false,stagedSSHKey;
 const adapter=new ProtectionAdapter({
  dir:join(config,'..'),
  datasets:{inventory:async()=>({snapshots:[{name:snapshot}]})},
  run:async(bin,args)=>{
   if(bin==='/usr/bin/ssh'){
    remoteChecked=true;
    const sshKey=args[args.indexOf('-i')+1];
    assert.equal(await readFile(sshKey,'utf8'),approvedKey);
    return {ok:true,stdout:'7777\n'};
   }
   return {ok:true,stdout:args.at(-1)==='tank/data'?'12345\n':'7777\n'};
  },
  pipeline:async commands=>{
   pipelineChecked=true;
   await writeFile(key,'rotated private key');
   await writeFile(known,'backup.example ssh-ed25519 rotated-host-key');
   const ssh=commands[1].args;
   stagedSSHKey=ssh[ssh.indexOf('-i')+1];
   assert.ok(stagedSSHKey.startsWith('/dev/shm/lightnas-credential-run-'),'SSH credentials must use tmpfs');
   assert.equal(await readFile(stagedSSHKey,'utf8'),approvedKey);
   assert.equal(await readFile(ssh.find(a=>a.startsWith('UserKnownHostsFile=')).split('=')[1],'utf8'),approvedHost);
  }
 });
 const sshArgs=['-F','/dev/null','-o','UserKnownHostsFile='+known,'-i',key,'backup@backup.example'];
 const impact={type:'protection.run',context:{
  task:{kind:'replication',profile:'RemoteBackup',source:'tank/data'},
  source:{name:'tank/data',guid:'12345'},snapshot,prune:[],
  credentialState:{key:digest(approvedKey),hostKey:digest(approvedHost)},
  pipeline:[{bin:'/usr/sbin/zfs',args:['send',snapshot]},{bin:'/usr/bin/ssh',args:[...sshArgs,'zfs receive -u backup/target']}],
  remoteVerification:{source:{bin:'/usr/sbin/zfs',args:['get','-H','-o','value','guid',snapshot]},target:{bin:'/usr/bin/ssh',args:[...sshArgs,'zfs get -H -o value guid backup/target@Backup']},snapshot:'backup/target@Backup'}
 },commands:[{bin:'/usr/sbin/zfs',args:['snapshot',snapshot]}],result:{id:'Backup'}};
 await adapter.apply(impact);
 assert.ok(pipelineChecked&&remoteChecked);
 await assert.rejects(readFile(stagedSSHKey,'utf8'),{code:'ENOENT'});
 assert.deepEqual((await readdir(config)).filter(n=>n.startsWith('.credential-run-')),[]);
});

test('symlinked or world-readable cloud credentials fail before any transfer',async t=>{
 const {adapter,config,calls}=await fixture(t);
 const file=join(config,'rclone.conf'),value='[Remote]\ntype = s3\n';
 await writeFile(file,value,{mode:0o600});
 const impact={type:'protection.run',context:{task:{kind:'cloud'},credentialState:digest(value)},
  commands:[{bin:'/usr/bin/rclone',args:['copy','--config',file,'--','/data','Remote:backup']}],result:{id:'Backup'}};
 await chmod(file,0o644);
 await assert.rejects(adapter.apply(impact),/permissions or size are unsafe/);
 assert.deepEqual(calls,[]);
});

test('real replication subprocesses do not inherit ambient secrets or SSH overrides',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'lightnas-replication-env-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const output=join(dir,'environment.txt');
 const previous=process.env.LIGHTNAS_TEST_SECRET;
 process.env.LIGHTNAS_TEST_SECRET='must-never-reach-ssh-or-zfs';
 try{
  await replicate([{bin:'/usr/bin/env',args:[]},{bin:'/usr/bin/tee',args:[output]}],10000);
  const captured=await readFile(output,'utf8');
  assert.doesNotMatch(captured,/LIGHTNAS_TEST_SECRET|must-never-reach-ssh-or-zfs/);
  assert.match(captured,/LANG=C/);
 }finally{
  if(previous===undefined)delete process.env.LIGHTNAS_TEST_SECRET;
  else process.env.LIGHTNAS_TEST_SECRET=previous;
 }
});
