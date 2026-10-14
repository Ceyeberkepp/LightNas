import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProviderAdapter,validateProviderConfig} from '../src/storage-agent/providers.js';
import {ResourceAdapter,mountedSourceId} from '../src/storage-agent/resources.js';
import {STORAGE_PROVIDERS} from '../public/storage-providers.js';
import https from 'node:https';
import {execFileSync} from 'node:child_process';
import {X509Certificate} from 'node:crypto';
import {RemoteStorage,remoteRequest} from '../src/storage-agent/remote-storage.js';
import {publicJob} from '../src/storage-agent/operations.js';
const source={id:'disk',path:'/mnt/data',device:'/dev/sdb1',type:'ext4',readOnly:false};
const success=stdout=>({ok:true,stdout,stderr:''});
test('all fourteen provider choices are retained with provider-specific configuration',()=>{
 assert.equal(STORAGE_PROVIDERS.length,14);for(const provider of STORAGE_PROVIDERS)assert.equal(new Set(provider.fields).size,provider.fields.length);
 for(const config of [{server:'host\n[Service]'},{server:'host',exportPath:'/export%h'},{server:'host',exportPath:'/../../etc'},{password:'exposed'}])assert.throws(()=>validateProviderConfig('nfs',config));
 assert.throws(()=>validateProviderConfig('esxi',{server:'user:password@host'}));assert.throws(()=>validateProviderConfig('cephfs',{username:'user%h'}));assert.throws(()=>validateProviderConfig('cephfs',{username:'user\\x2cother'}));
});
test('LVM and thin LVM validate actual LV metadata rather than saving an arbitrary provider label',async()=>{
 let segtype='linear';const adapter=new ProviderAdapter({resolvePath:async()=>'/dev/dm-0',run:async()=>success(JSON.stringify({report:[{lv:[{lv_path:'/dev/vg/data',vg_name:'vg',lv_name:'data',segtype,pool_lv:segtype==='thin'?'thinpool':''}]}]}))});const mounted={...source,device:'/dev/mapper/vg-data'};
 assert.equal((await adapter.describe('lvm',mounted,{})).config.vgName,'vg');await assert.rejects(adapter.describe('lvm-thin',mounted,{}),/thin logical volume/);segtype='thin';assert.equal((await adapter.describe('lvm-thin',mounted,{})).config.thinPool,'thinpool');await assert.rejects(adapter.describe('lvm',mounted,{vgName:'wrong'}),/does not match/);
});
test('mounted network providers reject mismatched endpoints and wrong filesystems',async()=>{
 const adapter=new ProviderAdapter();const nfs={...source,type:'nfs4',device:'nas:/export'};assert.equal((await adapter.describe('nfs',nfs,{})).config.exportPath,'/export');await assert.rejects(adapter.describe('nfs',nfs,{server:'wrong'}),/does not match/);
 assert.equal((await adapter.describe('smb-cifs',{...source,type:'cifs',device:'//nas/share'},{})).config.share,'share');assert.equal((await adapter.describe('glusterfs',{...source,type:'fuse.glusterfs',device:'nas:/volume'},{})).config.volume,'volume');await assert.rejects(adapter.describe('nfs',source,{}),/actual NFS/);await adapter.describe('cephfs',{...source,type:'ceph'},{});
});
test('ZFS, RBD and iSCSI use native dataset/device identities',async()=>{
 const adapter=new ProviderAdapter({resolvePath:async p=>p==='/sys/class/block/sdb1'?'/sys/devices/session2/target2/block/sdb/sdb1':p,read:async p=>p.endsWith('/pool')?'rbd':p.endsWith('/name')?'image':p.endsWith('/targetname')?'iqn.2026-01.test:disk':p.endsWith('/address')?'10.0.0.1':'3260',run:async()=>success('tank/data\t/mnt/data\n')});
 assert.equal((await adapter.describe('zfs',{...source,type:'zfs',device:'tank/data'},{})).config.dataset,'tank/data');await assert.rejects(adapter.describe('zfs',{...source,type:'zfs',device:'tank/data'},{dataset:'tank/wrong'}),/does not match/);
 assert.equal((await adapter.describe('rbd',{...source,device:'/dev/rbd0'},{})).config.image,'image');assert.equal((await adapter.describe('iscsi',source,{})).config.portal,'10.0.0.1:3260');await assert.rejects(adapter.describe('iscsi',source,{portal:'10.0.0.2'}),/does not match/);await adapter.describe('zfs-over-iscsi',source,{zfsPool:'tank'});
});
test('remote mount previews contain exact units and root-private credentials, never shell commands or plaintext public secrets',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nas-provider-plan-'));try{const adapter=new ProviderAdapter({dir,exists:async()=>{}});
 for(const [provider,config,credentials,type] of [['nfs',{server:'nas',exportPath:'/data'},{},'nfs'],['smb-cifs',{server:'nas',share:'data',username:'lightnas'},{password:'private-value'},'cifs'],['glusterfs',{server:'nas',volume:'data'},{},'glusterfs'],['cephfs',{monitors:'10.0.0.1',filesystem:'data',username:'lightnas'},{secret:'private-value'},'ceph']]){
  const plan=await adapter.connectionPlan(provider,'testdata',config,credentials);assert.equal(plan.fsType,type);assert.match(plan.unit,/Where=\/mnt\/lightnas\/testdata/);assert.deepEqual(plan.commands[1],['/usr/bin/systemctl','enable','--now','mnt-lightnas-testdata.mount']);assert.doesNotMatch(JSON.stringify(publicJob(plan)),/private-value/);assert.doesNotMatch(plan.unit,/private-value/);
 }
 await assert.rejects(adapter.connectionPlan('smb-cifs','testdata',{server:'nas',share:'data',username:'lightnas'},{}),/password/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('native PBS connection validates capacity and browses snapshots, ESXi validates its SDK and datastore',async()=>{
 const calls=[];const remote=new RemoteStorage(async(url,options)=>{calls.push({url:String(url),options});if(url.pathname.endsWith('/status'))return JSON.stringify({data:{total:100,used:40,avail:60}});if(url.pathname.endsWith('/snapshots'))return JSON.stringify({data:[{'backup-type':'host','backup-id':'nas','backup-time':1700000000}]});if(url.pathname==='/sdk')return '<RetrieveServiceContentResponse><apiType>HostAgent</apiType></RetrieveServiceContentResponse>';return '<html>Index of datastore <a href="/folder/test.iso?dsName=data">test.iso</a><a href="/folder/sub/">sub</a></html>';});
 const config={server:'pbs.local',datastore:'data',username:'user@pbs!token'};assert.equal((await remote.status('proxmox-backup-server',config,{secret:'secret-value'})).availableBytes,60);assert.equal(calls[0].options.headers.Authorization,'PBSAPIToken=user@pbs!token:secret-value');assert.match(calls[0].url,/:8007/);assert.equal((await remote.list('proxmox-backup-server',config,{secret:'secret-value'},'backup')).entries[0].name,'host/nas/1700000000');
 const esxi={server:'esxi.local',datastore:'data',username:'admin'};assert.equal((await remote.status('esxi',esxi,{password:'pw'})).capacityKnown,false);assert.equal((await remote.list('esxi',esxi,{password:'pw'},'iso')).entries[0].name,'test.iso');
 await assert.rejects(remote.status('proxmox-backup-server',{...config,username:'admin'},{secret:'pw'}),/API token/);
 const invalid=new RemoteStorage(async()=>'<html>Sign in</html>');await assert.rejects(invalid.status('esxi',esxi,{password:'pw'}),/ESXi host/);
});
test('native remote pool creation persists no secrets in the public registry and never creates filesystem directories',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'nas-remote-pool-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const providers=new ProviderAdapter({dir,remote:{status:async(provider,config)=>({identity:{provider,server:config.server,datastore:config.datastore},online:true,totalBytes:100,usedBytes:20,availableBytes:80})}});
 const resources=new ResourceAdapter({dataDir:dir,providers,sources:async()=>[],canTraverse:async()=>true});const input={type:'pool.definition.create',name:'pbsdata',provider:'proxmox-backup-server',providerConfig:{server:'pbs.local',datastore:'data',username:'user@pbs!token'},private:{credentials:{secret:'private-value'}},content:['backup']};
 const impact=await resources.plan(input);assert.deepEqual(impact.directoryState,[]);assert.equal(impact.after.pools[0].root,null);assert.doesNotMatch(JSON.stringify(publicJob(impact)),/private-value/);await resources.validate(impact);await resources.apply(impact);const saved=await readFile(join(dir,'storage-pools.json'),'utf8');assert.doesNotMatch(saved,/private-value/);assert.match(await readFile(join(dir,'provider-credentials','pbsdata.json'),'utf8'),/private-value/);await assert.rejects(resources.plan({...input,name:'badpbs',content:['iso']}),/content supported/);await resources.rollback(impact);
});
test('managed mount identities remain stable if a helper canonicalizes its remote device string',()=>{assert.equal(mountedSourceId('mon:/','/mnt/lightnas/cephdata'),mountedSourceId('user@fsid.fs=mon:/','/mnt/lightnas/cephdata'));});

test('a pinned HTTPS connection checks the certificate before sending credentials',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'nas-provider-tls-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem')],{stdio:'ignore'});
 const cert=await readFile(join(dir,'cert.pem')),key=await readFile(join(dir,'key.pem'));let requests=0;
 const server=https.createServer({cert,key},(req,res)=>{requests++;assert.equal(req.headers.authorization,'private-authorization');res.end('ok');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const url=new URL('https://127.0.0.1:'+server.address().port+'/');await assert.rejects(remoteRequest(url,{pin:'00'.repeat(32),headers:{Authorization:'private-authorization'}}),/fingerprint does not match/);assert.equal(requests,0);
 assert.equal(await remoteRequest(url,{pin:new X509Certificate(cert).fingerprint256,headers:{Authorization:'private-authorization'}}),'ok');assert.equal(requests,1);
});
