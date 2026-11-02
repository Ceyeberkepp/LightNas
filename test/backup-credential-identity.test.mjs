import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProtectionAdapter} from '../src/storage-agent/protection.js';
import {digest} from '../src/storage-agent/storage.js';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'lightnas-backup-identity-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const config=join(dir,'protection');
 await mkdir(config,{recursive:true});
 const calls=[];
 const adapter=new ProtectionAdapter({
  dir,
  datasets:{inventory:async()=>({snapshots:[]})},
  run:async(bin,args)=>{calls.push({bin,args});return {ok:true,stdout:'12345\\n'};}
 });
 return {adapter,config,calls};
}

test('cloud backup rejects credentials rotated after preview without running rclone',async t=>{
 const {adapter,config,calls}=await fixture(t);
 const file=join(config,'rclone.conf');
 await writeFile(file,'[Remote]\\ntype = s3\\naccess_key_id = first\\n');
 const expected=digest('[Remote]\\ntype = s3\\naccess_key_id = first\\n');
 const impact={type:'protection.run',context:{task:{kind:'cloud'},credentialState:expected},
  commands:[{bin:'/usr/bin/rclone',args:['copy','/data/source','Remote:archive']}],result:{id:'Backup'}};
 await writeFile(file,'[Remote]\\ntype = s3\\naccess_key_id = second\\n');
 await assert.rejects(adapter.apply(impact),/Cloud backup credentials changed since preview/);
 assert.deepEqual(calls,[],'No transfer may start with a different remote identity');
});

test('cloud backup requires a pinned preview identity and allows an unchanged one',async t=>{
 const {adapter,config,calls}=await fixture(t);
 const value='[Remote]\\ntype = s3\\naccess_key_id = pinned\\n';
 await writeFile(join(config,'rclone.conf'),value);
 const impact={type:'protection.run',context:{task:{kind:'cloud'}},
  commands:[{bin:'/usr/bin/rclone',args:['copy','/data/source','Remote:archive']}],result:{id:'Backup'}};
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
 await writeFile(key,'original private key fixture');
 await writeFile(known,'backup.example ssh-ed25519 original-host-key-fixture');
 const impact={type:'protection.run',context:{
  task:{kind:'replication',profile:'RemoteBackup',source:'tank/data'},
  source:{name:'tank/data',guid:'12345'},
  credentialState:{key:digest('original private key fixture'),hostKey:digest('backup.example ssh-ed25519 original-host-key-fixture')}
 },commands:[{bin:'/usr/sbin/zfs',args:['snapshot','tank/data@lightnas-Backup-1']}],result:{id:'Backup'}};
 await writeFile(known,'backup.example ssh-ed25519 substituted-host-key');
 await assert.rejects(adapter.apply(impact),/Replication SSH identity changed since preview/);
 assert.deepEqual(calls,[]);
 await writeFile(known,'backup.example ssh-ed25519 original-host-key-fixture');
 await writeFile(key,'substituted private key');
 await assert.rejects(adapter.apply(impact),/Replication SSH identity changed since preview/);
 assert.deepEqual(calls,[]);
});
