import {readFile,realpath,access,mkdir,writeFile,chmod,unlink,lstat,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,basename,dirname} from 'node:path';
import {STORAGE_PROVIDERS,providerDefinition,acceptsSource} from '../../public/storage-providers.js';
import {command,digest} from './storage.js';
import {atomic} from './persistence.js';
import {RemoteStorage} from './remote-storage.js';
const binaries={nfs:'/usr/sbin/mount.nfs','smb-cifs':'/usr/sbin/mount.cifs',glusterfs:'/usr/sbin/mount.glusterfs',cephfs:'/usr/sbin/mount.ceph'};
const oneLine=value=>typeof value==='string'&&value.length<=512&&!/[\r\n\0]/.test(value);
const host=value=>/^(?:[A-Za-z0-9][A-Za-z0-9.-]{0,252}|\[[0-9a-fA-F:]+\])$/.test(value);
const component=value=>/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
export function validateProviderConfig(provider,raw={}){
 const definition=providerDefinition(provider);if(!raw||Array.isArray(raw)||typeof raw!=='object'||Object.keys(raw).some(key=>!definition.fields.includes(key)||!oneLine(raw[key])))throw Error('Invalid '+definition.label+' connection fields');
 if(provider==='cephfs'&&raw.username&&!/^(?:client\.)?[A-Za-z0-9_.-]{1,127}$/.test(raw.username))throw Error('Invalid Ceph client name');
 const config=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,v.trim()]).filter(([,v])=>v));
 for(const field of ['vgName','thinPool','filesystem','rbdPool','image','zfsPool','datastore','volume','share'])if(config[field]&&!component(config[field]))throw Error('Invalid '+field);
 if(config.server){const parsed=definition.remote?new URL('https://'+config.server):null;if(parsed){if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw Error('Use a hostname/IP and optional port');}else if(!host(config.server))throw Error('Use a hostname or IP address');}
 if(config.monitors&&!config.monitors.split(',').every(h=>host(h.replace(/:\d+$/,''))))throw Error('Invalid Ceph monitor addresses');
 if(config.exportPath&&(!config.exportPath.startsWith('/')||/[\s,%\\]/.test(config.exportPath)||config.exportPath.split('/').some(s=>s==='..'||s==='.')||config.exportPath.includes('//')))throw Error('Invalid NFS export path');
 if(config.dataset&&!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/.test(config.dataset))throw Error('Invalid ZFS dataset');
 if(config.portal&&!/^(?:[A-Za-z0-9][A-Za-z0-9.-]*|\[[0-9a-fA-F:]+\])(?::\d{1,5})?$/.test(config.portal))throw Error('Invalid iSCSI portal');
 if(config.target&&!/^iqn\.[A-Za-z0-9_.:-]{1,220}$/.test(config.target))throw Error('Invalid iSCSI target IQN');
 if(config.certificatePem){if(typeof config.certificatePem!=='string'||config.certificatePem.length>16384||!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(config.certificatePem))throw Error('Invalid PEM certificate');if(!config.fingerprint)throw Error('Certificate fingerprint is required for custom certificate trust');}
 if(config.fingerprint&&!/^(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$|^[0-9A-Fa-f]{64}$/.test(config.fingerprint))throw Error('Invalid SHA-256 certificate fingerprint');
 for(const field of ['username','domain'])if(config[field]&&/[\s,=%]/.test(config[field]))throw Error('Invalid '+field);
 return config;
}
export class ProviderAdapter{
 constructor({dir=process.env.NAS_JOB_DIR||'/var/lib/lightnas-storage',run=command,remote=new RemoteStorage(),resolvePath=realpath,read=readFile,exists=async path=>access(path,constants.X_OK)}={}){Object.assign(this,{dir,run,remote,resolvePath,read,exists});this.statusCache=new Map();}
 async checked(bin,args){const result=await this.run(bin,args);if(!result.ok)throw Error('Provider validation failed: '+(result.stderr||bin));return result.stdout;}
 async describe(provider,source,raw){
  const config=validateProviderConfig(provider,raw);
  if(!acceptsSource(provider,source))throw Error('Select an actual '+providerDefinition(provider).label+' backing filesystem');
  let identity={device:source.device,filesystem:source.type};
  if(['lvm','lvm-thin'].includes(provider)){
   const result=JSON.parse(await this.checked('/usr/sbin/lvs',['--reportformat','json','-o','lv_path,vg_name,lv_name,segtype,pool_lv',source.device]));const lv=result.report?.flatMap(r=>r.lv||[])[0];if(!lv)throw Error('Selected device is not an LVM logical volume');
   const values=Object.fromEntries(Object.entries(lv).map(([k,v])=>[k,String(v).trim()]));if(await this.resolvePath(values.lv_path)!==await this.resolvePath(source.device))throw Error('LVM device identity does not match');
   if(config.vgName&&config.vgName!==values.vg_name)throw Error('Volume group does not match selected volume');
   if(provider==='lvm-thin'&&values.segtype!=='thin')throw Error('Select a thin logical volume, not a regular LVM volume or the thin-pool device');
   if(config.thinPool&&config.thinPool!==values.pool_lv)throw Error('Thin pool does not match selected volume');
   identity={...identity,...values};return {config:{...config,vgName:values.vg_name,...(provider==='lvm-thin'?{thinPool:values.pool_lv}:{})},identity};
  }
  if(provider==='zfs'){
   const lines=(await this.checked('/usr/sbin/zfs',['list','-H','-o','name,mountpoint',source.device])).trim().split('\n');const pair=lines.map(line=>line.split('\t')).find(([,path])=>path===source.path);if(!pair||config.dataset&&config.dataset!==pair[0])throw Error('ZFS dataset does not match selected mount');config.dataset=pair[0];identity.dataset=pair[0];
  }
  if(provider==='nfs'||provider==='glusterfs'){
   const split=source.device.lastIndexOf(':');const server=source.device.slice(0,split),path=provider==='glusterfs'?source.device.slice(split+1).replace(/^\//,''):source.device.slice(split+1);const key=provider==='nfs'?'exportPath':'volume';if(split<1||config.server&&config.server!==server||config[key]&&config[key]!==path)throw Error('Server or '+key+' does not match selected mount');config.server=server;config[key]=path;
  }
  if(provider==='smb-cifs'){
   const match=source.device.match(/^\/\/([^/]+)\/([^/]+)$/);if(!match||config.server&&config.server.toLowerCase()!==match[1].toLowerCase()||config.share&&config.share!==match[2])throw Error('SMB server/share does not match selected mount');config.server=match[1];config.share=match[2];
  }
  if(provider==='cephfs'){
   const hints=source.providerHints||{},filesystem=hints.mds_namespace||hints.fs,username=hints.name;
   if(filesystem&&config.filesystem&&config.filesystem!==filesystem||username&&config.username&&config.username!==username)throw Error('Ceph filesystem or client does not match selected mount');
   if(filesystem)config.filesystem=filesystem;if(username)config.username=username;identity={...identity,...hints};
  }
  if(provider==='rbd'){
   const device=await this.resolvePath(source.device),number=basename(device).match(/^rbd(\d+)/)?.[1];if(!number)throw Error('Select a kernel-mapped RBD image');
   const pool=(await this.read('/sys/bus/rbd/devices/'+number+'/pool','utf8')).trim(),image=(await this.read('/sys/bus/rbd/devices/'+number+'/name','utf8')).trim();if(config.rbdPool&&config.rbdPool!==pool||config.image&&config.image!==image)throw Error('RBD pool/image does not match selected device');Object.assign(config,{rbdPool:pool,image});identity={...identity,pool,image};
  }
  if(provider==='iscsi'||provider==='zfs-over-iscsi'){
   const device=basename(await this.resolvePath(source.device));const sysPath=await this.resolvePath('/sys/class/block/'+device);const session=sysPath.match(/\/(session\d+)\//)?.[1];if(!session)throw Error('Select a filesystem on an active iSCSI LUN');const target=(await this.read('/sys/class/iscsi_session/'+session+'/targetname','utf8')).trim();if(config.target&&config.target!==target)throw Error('iSCSI target does not match selected LUN');const connection='/sys/class/iscsi_connection/connection'+session.slice(7)+':0/';const address=(await this.read(connection+'address','utf8')).trim(),port=(await this.read(connection+'port','utf8')).trim();const portal=(address.includes(':')?'['+address+']':address)+':'+port;if(config.portal&&config.portal!==address&&config.portal!==portal)throw Error('iSCSI portal does not match selected LUN');config.portal=portal;config.target=target;identity={...identity,session,target,portal};
   if(provider==='zfs-over-iscsi'&&!config.zfsPool)throw Error('Enter the ZFS pool name on the exporting server');
  }
  return {config,identity};
 }
 async connectionPlan(provider,name,raw,credentials={}){
  if(!/^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(name))throw Error('Invalid storage name');
  const definition=providerDefinition(provider),config=validateProviderConfig(provider,raw);if(!definition.connect)throw Error('This provider uses an existing mounted volume');
  for(const field of definition.fields.filter(f=>!['domain','username'].includes(f)))if(!config[field])throw Error('Enter '+field+' for '+definition.label);
  if(Object.keys(credentials).some(k=>k!==definition.credential)||Object.values(credentials).some(v=>!oneLine(v)))throw Error('Invalid provider credentials');
  if(definition.credential&&(!config.username||!credentials[definition.credential]))throw Error('Enter '+definition.label+' username and '+definition.credential);
  try{await this.exists(binaries[provider]);}catch{throw Error(definition.label+' client is not installed or executable ('+binaries[provider]+'). Run the updated one-click installer.');}const path='/mnt/lightnas/'+name,credentialFile=join(this.dir,'provider-credentials',name+'.conf');
  let device,fsType,options=['rw','nosuid','nodev','_netdev'];
  if(provider==='nfs'){device=config.server+':'+config.exportPath;fsType='nfs';options.push('vers=4');}
  if(provider==='smb-cifs'){device='//'+config.server+'/'+config.share;fsType='cifs';options.push('vers=3.1.1','credentials='+credentialFile,'uid=0','gid='+process.getgid(),'file_mode=0660','dir_mode=0770');}
  if(provider==='glusterfs'){device=config.server+':/'+config.volume;fsType='glusterfs';}
  if(provider==='cephfs'){device=config.monitors+':/';fsType='ceph';options.push('name='+config.username,'fs='+config.filesystem,'secretfile='+credentialFile);}
  const unitName='mnt-lightnas-'+name.replaceAll('-','\\x2d')+'.mount',unitPath='/etc/systemd/system/'+unitName;
  const unit='[Unit]\nDescription=LightNAS '+definition.label+' '+name+'\nWants=network-online.target\nAfter=network-online.target\n\n[Mount]\nWhat='+device+'\nWhere='+path+'\nType='+fsType+'\nOptions='+options.join(',')+'\nTimeoutSec=45\n\n[Install]\nWantedBy=remote-fs.target\n';
  for(const target of [path,unitPath,credentialFile]){try{await lstat(target);throw Error('Managed mount/credential path already exists; choose a different storage name');}catch(error){if(error.code!=='ENOENT')throw error;}}
  return {provider,name,config,path,device,fsType,unitName,unitPath,unit,credentialFile:definition.credential?credentialFile:null,credentialFingerprint:digest(credentials),private:{credentials},commands:[['/usr/bin/systemctl','daemon-reload'],['/usr/bin/systemctl','enable','--now',unitName]]};
 }
 async connect(plan){
  this.active={name:plan.name,unitWritten:false,credentialWritten:false};
  const parent=dirname(plan.path);let madeParent=false;await mkdir(parent,{mode:0o755}).then(()=>{madeParent=true;}).catch(e=>{if(e.code!=='EEXIST')throw e;});if(madeParent)await chmod(parent,0o755);
  const parentInfo=await lstat(parent);if(!parentInfo.isDirectory()||parentInfo.isSymbolicLink()||parentInfo.uid!==0||(parentInfo.mode&0o022))throw Error('Managed mount parent must be a root-owned directory without group/other write access');
  if(await realpath(parent)!==parent)throw Error('Managed mount parent must not traverse symlinks');
  await mkdir(plan.path,{mode:0o755});await chmod(plan.path,0o755);
  if(plan.credentialFile){await mkdir(dirname(plan.credentialFile),{recursive:true,mode:0o700});let text;if(plan.provider==='smb-cifs')text='username='+plan.config.username+'\npassword='+plan.private.credentials.password+'\n'+(plan.config.domain?'domain='+plan.config.domain+'\n':'');else text=plan.private.credentials.secret+'\n';await writeFile(plan.credentialFile,text,{mode:0o600,flag:'wx'});this.active.credentialWritten=true;await chmod(plan.credentialFile,0o600);}
  await writeFile(plan.unitPath,plan.unit,{mode:0o644,flag:'wx'});this.active.unitWritten=true;for(const [bin,...args] of plan.commands)await this.checked(bin,args);
 }
 async disconnect(plan){
  // Do not remove any data from the remote filesystem. Stop only our own unit.
  const active=this.active;if(!active||active.name!==plan.name)return;
  if(active.unitWritten){const stopped=await this.run('/usr/bin/systemctl',['disable','--now',plan.unitName]);if(!stopped.ok)throw Error('Remote mount cleanup failed; inspect '+plan.unitName);await unlink(plan.unitPath);}
  if(active.credentialWritten)await unlink(plan.credentialFile);
  if(active.unitWritten)await this.checked('/usr/bin/systemctl',['daemon-reload']);

 }
 async remotePlan(provider,name,raw,credentials){if(!/^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(name))throw Error('Invalid storage name');const config=validateProviderConfig(provider,raw);if(!providerDefinition(provider).remote)throw Error('Not a remote repository provider');for(const field of ['server','datastore','username'])if(!config[field])throw Error('Enter '+field);const credential=providerDefinition(provider).credential;if(!credentials||Object.keys(credentials).some(k=>k!==credential)||!oneLine(credentials[credential])||!credentials[credential])throw Error('Enter '+credential);const status=await this.remote.status(provider,config,credentials);this.statusCache.set(name,{value:status,time:Date.now()});return {provider,name,config,identity:status.identity,credentialFingerprint:digest(credentials),private:{credentials}};}
 async saveRemote(plan){const dir=join(this.dir,'provider-credentials');await mkdir(dir,{recursive:true,mode:0o700});await atomic(join(dir,plan.name+'.json'),JSON.stringify({provider:plan.provider,config:plan.config,credentials:plan.private.credentials})+'\n');await chmod(join(dir,plan.name+'.json'),0o600);}
 async remoteRecord(name){if(!/^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(name))throw Error('Invalid storage name');return JSON.parse(await readFile(join(this.dir,'provider-credentials',name+'.json'),'utf8'));}
 async remoteStatus(name){const cached=this.statusCache.get(name);const refresh=async()=>{const record=await this.remoteRecord(name);const value=await this.remote.status(record.provider,record.config,record.credentials);this.statusCache.set(name,{value,time:Date.now()});return value;};if(cached){if(Date.now()-cached.time>30000&&!cached.refreshing){cached.refreshing=true;refresh().catch(()=>{cached.value={...cached.value,online:false};cached.time=Date.now();}).finally(()=>{cached.refreshing=false;});}return cached.value;}return refresh();}
 async remoteContent(name,type){const record=await this.remoteRecord(name);return this.remote.list(record.provider,record.config,record.credentials,type);}
}
