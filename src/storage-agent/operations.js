import {readFile,writeFile,mkdir,realpath,lstat,readdir,mkdtemp,rm} from 'node:fs/promises';
import {ResourceAdapter,RESOURCE_TYPES} from './resources.js';
import {fingerprint,planVolume,VolumeAdapter} from './volumes.js';
import {dirname,basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {digest,validateShares,renderShares,command} from './storage.js';
export {atomic} from './persistence.js';
import {atomic} from './persistence.js';

export class Operations extends EventEmitter {
 constructor({dir,adapter,discover,volumes=new VolumeAdapter(),resources=new ResourceAdapter(),allowInitialization=false}){super();this.dir=dir;this.adapter=adapter;this.discover=discover;this.volumes=volumes;this.resources=resources;this.allowInitialization=allowInitialization;this.jobs=new Map();this.busy=false;}
 async init(){await mkdir(this.dir,{recursive:true,mode:0o700});try{const jobs=JSON.parse(await readFile(this.dir+'/jobs.json','utf8'));for(const j of jobs){if(['queued','running'].includes(j.status)){j.status='interrupted';j.logs.push('Service restarted; inspect rollback metadata before retrying.');}this.jobs.set(j.id,j);}await this.save();}catch(e){if(e.code!=='ENOENT')throw e;}}
 async save(){const text=JSON.stringify([...this.jobs.values()]);this.saving=(this.saving||Promise.resolve()).catch(()=>{}).then(()=>atomic(this.dir+'/jobs.json',text));await this.saving;}
 async preview(input){
  if(this.jobs.size>=1000)throw Error('Job retention limit reached; archive old jobs before continuing');
  if(RESOURCE_TYPES.includes(input.type))return this.previewResource(input);
  if(input.type!=='shares.replace'){if(!['filesystem.create','pool.create'].includes(input.type))throw Error('Unsupported mutation');return this.previewVolume(input);}
  const shares=validateShares(input.shares);await this.adapter.validatePaths(shares);
  const before=await this.adapter.snapshot();const after={...renderShares(shares),manifest:JSON.stringify(shares)+'\n'};await this.adapter.validate?.(after);const hardware=await this.discover();const activationRequired=this.adapter.verifyCurrent?!(await this.adapter.verifyCurrent()):false;
  const impact={type:input.type,shares,before,after,disks:hardware.disks.map(d=>({id:d.id,path:d.path,size:d.size,serial:d.serial})),filesystems:hardware.filesystems,hardwareHash:fingerprint(hardware),configurationContext:await this.adapter.context?.()||null,affectedServices:[...(before.smb!==after.smb||(activationRequired&&after.smb.trim())?['smbd']:[]),...(before.nfs.trim()!==after.nfs.trim()||(activationRequired&&after.nfs.trim())?['nfs-kernel-server']:[])],dataErased:false,permissionChanges:false,warning:'Replaces all LightNAS-managed shares. Existing client connections may be interrupted.',rollback:'Restore saved managed configuration and reload services; client sessions cannot be restored.'};
  const j={id:randomUUID(),status:'preview',createdAt:new Date().toISOString(),expiresAt:Date.now()+300000,impact,approvalHash:digest(impact),progress:0,logs:[],events:[],cancelRequested:false,rollback:{available:false}};
  this.jobs.set(j.id,j);await this.save();return j;
 }
 async previewResource(input){const impact=await this.resources.plan(input);const j={id:randomUUID(),status:'preview',createdAt:new Date().toISOString(),expiresAt:Date.now()+300000,impact,approvalHash:digest(impact),progress:0,logs:[],events:[],cancelRequested:false,rollback:{available:false}};this.jobs.set(j.id,j);await this.save();return j;}
 async previewRollback(id){const previous=this.jobs.get(id);if(!previous?.rollback?.available||!previous.rollback.before?.manifest)throw Error('No share configuration rollback available');return this.preview({type:'shares.replace',shares:JSON.parse(previous.rollback.before.manifest)});}
 async previewVolume(input){
  if(!this.allowInitialization)throw Error('Disk initialization is disabled by host policy');
  const hardware=await this.discover();const impact={...planVolume(input,hardware),hardwareHash:fingerprint(hardware)};
  await this.volumes.validate(impact);
  const j={id:randomUUID(),status:'preview',createdAt:new Date().toISOString(),expiresAt:Date.now()+300000,impact,approvalHash:digest(impact),progress:0,logs:[],events:[],cancelRequested:false,rollback:{available:false,reason:impact.rollback}};
  this.jobs.set(j.id,j);await this.save();return j;
 }
 async recheck(j){
  if(RESOURCE_TYPES.includes(j.impact.type)){await this.resources.validate(j.impact);return;}
  const hardware=await this.discover();if(fingerprint(hardware)!==j.impact.hardwareHash)throw Error('Storage changed; request a new preview');
  if(j.impact.type==='shares.replace'){
   if(digest(await this.adapter.snapshot())!==digest(j.impact.before))throw Error('Configuration changed; request a new preview');
   await this.adapter.validatePaths(j.impact.shares);
   if(j.impact.configurationContext&&digest(await this.adapter.context())!==digest(j.impact.configurationContext))throw Error('Host share configuration changed; request a new preview');
  }else{
   if(!this.allowInitialization)throw Error('Disk initialization is disabled by host policy');
   const expected=planVolume({type:j.impact.type,filesystem:j.impact.filesystem,label:j.impact.label,profile:j.impact.profile,diskIds:j.impact.disks.map(d=>d.id)},hardware);
   if(digest(expected)!==digest(Object.fromEntries(Object.entries(j.impact).filter(([k])=>k!=='hardwareHash'))))throw Error('Disk plan changed');
   await this.volumes.validate(j.impact);
  }
 }
 async approve(id,hash,confirmation){
  const j=this.jobs.get(id);if(!j||j.status!=='preview'||j.approvalHash!==hash||digest(j.impact)!==hash||Date.now()>j.expiresAt)throw Error('Invalid, expired or already used approval');
  if(j.impact.confirmation&&confirmation!==j.impact.confirmation)throw Error('Exact disk initialization confirmation required');
  if(this.busy)throw Error('Another mutation is active');
  this.busy=true;
  try{await this.recheck(j);j.status='queued';j.approvedAt=new Date().toISOString();await this.save();}catch(e){this.busy=false;throw e;}
  setImmediate(()=>this.execute(j).catch(error=>{this.busy=false;console.error('Storage job journal failure:',error.message);}));return j;
 }
 async event(j,message,progress){j.logs.push(message);j.progress=progress;j.events.push({sequence:j.events.length+1,time:new Date().toISOString(),message,progress,status:j.status});await this.save();this.emit('progress',j);}
 async cancel(id){const j=this.jobs.get(id);if(!j||!['queued','running'].includes(j.status)||j.commitStarted)throw Error('Cancellation unavailable after configuration commit begins');j.cancelRequested=true;await this.event(j,'Cancellation requested before commit',j.progress);return j;}
 async execute(j){
  if(RESOURCE_TYPES.includes(j.impact.type))return this.executeResource(j);
  if(j.impact.type!=='shares.replace')return this.executeVolume(j);
  try{j.status='running';await this.event(j,'Validating proposed configuration',10);await this.adapter.validate(j.impact.after);if(j.cancelRequested){j.status='cancelled';await this.event(j,'Cancelled before commit',100);return;}
   await this.recheck(j);
   if(j.cancelRequested){j.status='cancelled';await this.event(j,'Cancelled before commit',100);return;}
   if(digest(j.impact.before)===digest(j.impact.after)&&(!this.adapter.verifyCurrent||await this.adapter.verifyCurrent())){j.status='succeeded';j.noop=true;await this.event(j,'Managed configuration already matches; no reload required',100);return;}
   j.rollback={available:true,before:j.impact.before,restored:false};j.commitStarted=true;await this.event(j,'Saved rollback configuration; entering non-cancellable commit',40);
   await this.adapter.apply(j.impact.after);await this.event(j,'Configuration committed; reloading services',70);await this.adapter.reload();j.status='succeeded';await this.event(j,'Share services configured',100);
  }catch(e){j.status='failed';j.logs.push(e.message);if(j.commitStarted){try{await this.adapter.apply(j.impact.before);await this.adapter.reload();j.rollback.restored=true;}catch(r){j.rollback.error=r.message;}}await this.event(j,'Operation failed; inspect rollback result',100);}finally{this.busy=false;}
 }
 async executeResource(j){
  try{j.status='running';await this.event(j,'Rechecking mounted source, configuration and directories',10);await this.recheck(j);
   if(j.cancelRequested){j.status='cancelled';await this.event(j,'Cancelled before resource commit',100);return;}
   j.rollback={available:true,before:j.impact.before,restored:false};j.commitStarted=true;await this.event(j,'Saved prior definitions; cancellation boundary closed',40);
   j.result=await this.resources.apply(j.impact,async path=>{j.rollback.createdDirectories||=[];j.rollback.createdDirectories.push(path);await this.event(j,'Created managed directory '+path,60);});await this.event(j,'Verifying resulting resource definitions',80);
   if(digest(await this.resources.snapshot(j.impact.type))!==digest(j.impact.after))throw Error('Resource write verification failed');
   j.status='succeeded';await this.event(j,'Storage resource change completed',100);
  }catch(e){j.status='failed';j.logs.push(e.message);if(j.commitStarted){try{j.rollback.details=await this.resources.rollback(j.impact);j.rollback.restored=true;}catch(r){j.rollback.error=r.message;}}await this.event(j,'Resource operation failed; inspect rollback metadata',100);}finally{this.busy=false;}
 }
 async executeVolume(j){
  try{
   j.status='running';await this.event(j,'Checking exact disk identities and dependencies',10);await this.recheck(j);
   if(j.cancelRequested){j.status='cancelled';await this.event(j,'Cancelled before irreversible disk write',100);return;}
   j.commitStarted=true;await this.event(j,'Entering irreversible filesystem initialization; cancellation closed',30);
   const output=await this.volumes.apply(j.impact);j.commandOutput=output;
   await this.event(j,'Verifying resulting filesystem inventory',90);
   const hardware=await this.discover();const matches=hardware.filesystems.filter(f=>f.label===j.impact.label&&f.type===j.impact.filesystem);
   if(!j.impact.disks.every(d=>matches.some(f=>f.device===d.path||f.devices?.includes(d.path))))throw Error('Filesystem initialization result could not be verified');
   j.result={filesystemIds:[...new Set(matches.map(f=>f.id))],diskIds:j.impact.disks.map(d=>d.id)};
   j.status='succeeded';await this.event(j,'Filesystem initialized; mount and access setup still required',100);
  }catch(e){j.status='failed';j.logs.push(e.message);j.rollback={available:false,reason:j.impact.rollback,inspectionRequired:!!j.commitStarted};await this.event(j,'Initialization failed; inspect disks before further work',100);}finally{this.busy=false;}
 }

}
export class ShareAdapter {
 constructor({smb='/etc/samba/lightnas-storage-agent.conf',nfs='/etc/exports.d/lightnas-storage-agent.exports',manifest='/var/lib/lightnas-storage/shares.json',run=command,shareRoots=async()=>['/srv/lightnas'],main='/etc/samba/smb.conf',legacy='/etc/samba/smb.conf.d/lightnas-shares.conf',exports='/etc/exports',bootId=async()=>readFile('/proc/sys/kernel/random/boot_id','utf8')}={}){Object.assign(this,{smb,nfs,manifest,run,shareRoots,main,legacy,exports,bootId});this.activation=manifest+'.activation';}
 async validatePaths(shares){const roots=await this.shareRoots();for(const s of shares){if(!roots.some(root=>s.path.startsWith(root+'/')||(root!=='/srv/lightnas'&&s.path===root)))throw Error('Share must be below /srv/lightnas or a registered Files content directory');const actual=await realpath(s.path);if(actual!==s.path||!(await lstat(actual)).isDirectory())throw Error('Share must be an existing directory without symlink traversal');}}
 async read(path,fallback=''){try{return await readFile(path,'utf8');}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
 async snapshot(){return {smb:await this.read(this.smb),nfs:await this.read(this.nfs),manifest:await this.read(this.manifest,'[]\n')};}
 async checked(bin,args){const r=await this.run(bin,args);if(!r.ok)throw Error(r.stderr||'Command failed');return r;}
 async exportFragments(){let names;try{names=await readdir(dirname(this.nfs));}catch(e){if(e.code==='ENOENT')return {};throw e;}const entries=[];for(const name of names.sort())if(name.endsWith('.exports')&&!name.startsWith('.')&&name!==basename(this.nfs))entries.push([name,await this.read(join(dirname(this.nfs),name))]);return Object.fromEntries(entries);}
 async context(){return {samba:await this.read(this.main),legacy:await this.read(this.legacy),exports:await this.read(this.exports),exportsFragments:await this.exportFragments(),shareRoots:await this.shareRoots()};}
 async validate(config){
  const main=await this.read(this.main);const shares=validateShares(JSON.parse(config.manifest||'[]'));
  const sections=[...(main+'\n'+await this.read(this.legacy)).matchAll(/^\s*\[([^\]]+)\]/gm)].map(m=>m[1].toLowerCase());
  for(const share of shares)if(share.protocol==='smb'){
   if(sections.includes(share.name.toLowerCase()))throw Error('Share conflicts with administrator-managed Samba section');
   for(const user of share.users){await this.checked('/usr/bin/getent',['passwd',user]);const accounts=await this.checked('/usr/bin/pdbedit',['-L','-u',user]);if(!accounts.stdout.split('\n').some(line=>line.startsWith(user+':')))throw Error('Provision Samba credentials for '+user+' before sharing');for(const flag of ['-r','-x',...(share.readOnly?[]:['-w'])]){const access=await this.run('/usr/sbin/runuser',['-u',user,'--','/usr/bin/test',flag,share.path]);if(!access.ok)throw Error('Unix access permissions are missing for '+user+' on '+share.path);}}
  }
  if(shares.some(s=>s.protocol==='nfs')){await this.checked('/usr/bin/systemctl',['is-active','nfs-kernel-server']);const other=await this.read(this.exports)+'\n'+Object.values(await this.exportFragments()).join('\n');const paths=other.split('\n').filter(line=>!line.trim().startsWith('#')).map(line=>line.trim().split(/\s+/)[0].replace(/^"|"$/g,''));for(const share of shares.filter(s=>s.protocol==='nfs'))if(paths.includes(share.path))throw Error('Share conflicts with administrator-managed NFS export');}
  const lines=main.split('\n');const include=lines.findIndex(line=>line.match(/^\s*include\s*=\s*(.+?)\s*$/i)?.[1]===this.smb);
  if(include<0)throw Error('Samba must include '+this.smb);
  // Previews may run concurrently. Each candidate owns a private directory so
  // another request cannot replace its contents or remove them during testparm.
  const validationDir=await mkdtemp(join(dirname(this.smb),'.lightnas-share-validation-'));
  const fragment=join(validationDir,'fragment.conf'),candidate=join(validationDir,'main.conf'),baseline=join(validationDir,'existing.conf');
  try{
   lines[include]='# New agent fragment omitted for collision discovery';await writeFile(baseline,lines.join('\n'),{mode:0o600});
   const effective=await this.checked('/usr/bin/testparm',['--suppress-prompt',baseline]);const names=[...effective.stdout.matchAll(/^\s*\[([^\]]+)\]/gm)].map(m=>m[1].toLowerCase());for(const share of shares.filter(s=>s.protocol==='smb'))if(names.includes(share.name.toLowerCase()))throw Error('Share conflicts with an included Samba configuration');
   await writeFile(fragment,config.smb,{mode:0o600});lines[include]='include = '+fragment;await writeFile(candidate,lines.join('\n'),{mode:0o600});await this.checked('/usr/bin/testparm',['--suppress-prompt',candidate]);
  }finally{await rm(validationDir,{recursive:true,force:true});}
 }
 async activationRecord(){try{return JSON.parse(await this.read(this.activation,'null'));}catch{return null;}}
 async apply(config){const previous=await this.snapshot();const force=!(await this.verifyCurrent());this.nfsReloadNeeded=previous.nfs.trim()!==config.nfs.trim()||(force&&!!config.nfs.trim());this.smbReloadNeeded=previous.smb!==config.smb||(force&&!!config.smb.trim());await atomic(this.smb,config.smb);await atomic(this.nfs,config.nfs);await atomic(this.manifest,config.manifest||'[]\n');}
 async shares(){return validateShares(JSON.parse(await this.read(this.manifest,'[]')));}
 async verify(){const shares=await this.shares();if(shares.some(s=>s.protocol==='smb'))await this.checked('/usr/bin/systemctl',['is-active','smbd']);if(shares.some(s=>s.protocol==='nfs')){await this.checked('/usr/bin/systemctl',['is-active','nfs-kernel-server']);const active=await this.checked('/usr/sbin/exportfs',['-s']);for(const share of shares.filter(s=>s.protocol==='nfs'))if(!active.stdout.split('\n').some(line=>line.trim().split(/\s+/)[0]===share.path))throw Error('NFS export activation was not verified for '+share.path);}}
 async verifyCurrent(){const record=await this.activationRecord();if(!record||record.hash!==digest(await this.snapshot())||record.boot!==await this.bootId())return false;try{await this.verify();return true;}catch{return false;}}
 async reload(){if(this.smbReloadNeeded){await this.checked('/usr/bin/testparm',['--suppress-prompt',this.main]);await this.checked('/usr/bin/systemctl',['reload','smbd']);}if(this.nfsReloadNeeded)await this.checked('/usr/sbin/exportfs',['-ra']);await this.verify();await atomic(this.activation,JSON.stringify({hash:digest(await this.snapshot()),boot:await this.bootId(),verifiedAt:new Date().toISOString()}));}
}

export function publicJob(value){if(Array.isArray(value))return value.map(publicJob);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='private').map(([k,v])=>[k,/password|secret|token/i.test(k)?'[redacted]':publicJob(v)]));return value;}
