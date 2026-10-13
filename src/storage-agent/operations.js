import {readFile,writeFile,rename,mkdir,realpath,lstat,open,unlink} from 'node:fs/promises';
import {fingerprint,planVolume,VolumeAdapter} from './volumes.js';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {digest,validateShares,renderShares,command} from './storage.js';
export async function atomic(path,text){
 const temporary=path+'.'+randomUUID()+'.tmp';const file=await open(temporary,'wx',0o600);
 try{await file.writeFile(text);await file.sync();}finally{await file.close();}
 try{await rename(temporary,path);const directory=await open(path.slice(0,path.lastIndexOf('/'))||'.','r');try{await directory.sync();}finally{await directory.close();}}catch(e){await unlink(temporary).catch(()=>{});throw e;}
}
export class Operations extends EventEmitter {
 constructor({dir,adapter,discover,volumes=new VolumeAdapter(),allowInitialization=false}){super();this.dir=dir;this.adapter=adapter;this.discover=discover;this.volumes=volumes;this.allowInitialization=allowInitialization;this.jobs=new Map();this.busy=false;}
 async init(){await mkdir(this.dir,{recursive:true,mode:0o700});try{const jobs=JSON.parse(await readFile(this.dir+'/jobs.json','utf8'));for(const j of jobs){if(['queued','running'].includes(j.status)){j.status='interrupted';j.logs.push('Service restarted; inspect rollback metadata before retrying.');}this.jobs.set(j.id,j);}await this.save();}catch(e){if(e.code!=='ENOENT')throw e;}}
 async save(){const text=JSON.stringify([...this.jobs.values()]);this.saving=(this.saving||Promise.resolve()).catch(()=>{}).then(()=>atomic(this.dir+'/jobs.json',text));await this.saving;}
 async preview(input){
  if(this.jobs.size>=1000)throw Error('Job retention limit reached; archive old jobs before continuing');
  if(input.type!=='shares.replace'){if(!['filesystem.create','pool.create'].includes(input.type))throw Error('Unsupported mutation');return this.previewVolume(input);}
  const shares=validateShares(input.shares);await this.adapter.validatePaths(shares);
  const before=await this.adapter.snapshot();const hardware=await this.discover();
  const impact={type:input.type,shares,before,after:{...renderShares(shares),manifest:JSON.stringify(shares)+'\n'},disks:hardware.disks.map(d=>({id:d.id,path:d.path,size:d.size,serial:d.serial})),filesystems:hardware.filesystems,hardwareHash:fingerprint(hardware),affectedServices:['smbd','nfs-server'],dataErased:false,permissionChanges:false,warning:'Replaces all LightNAS-managed shares. Existing client connections may be interrupted.',rollback:'Restore saved managed configuration and reload services; client sessions cannot be restored.'};
  const j={id:randomUUID(),status:'preview',createdAt:new Date().toISOString(),expiresAt:Date.now()+300000,impact,approvalHash:digest(impact),progress:0,logs:[],events:[],cancelRequested:false,rollback:{available:false}};
  this.jobs.set(j.id,j);await this.save();return j;
 }
 async previewRollback(id){const previous=this.jobs.get(id);if(!previous?.rollback?.available||!previous.rollback.before?.manifest)throw Error('No share configuration rollback available');return this.preview({type:'shares.replace',shares:JSON.parse(previous.rollback.before.manifest)});}
 async previewVolume(input){
  if(!this.allowInitialization)throw Error('Disk initialization is disabled by host policy');
  const hardware=await this.discover();const impact={...planVolume(input,hardware),hardwareHash:fingerprint(hardware)};
  await this.volumes.validate(impact);
  const j={id:randomUUID(),status:'preview',createdAt:new Date().toISOString(),expiresAt:Date.now()+300000,impact,approvalHash:digest(impact),progress:0,logs:[],events:[],cancelRequested:false,rollback:{available:false,reason:impact.rollback}};
  this.jobs.set(j.id,j);await this.save();return j;
 }
 async recheck(j){
  const hardware=await this.discover();if(fingerprint(hardware)!==j.impact.hardwareHash)throw Error('Storage changed; request a new preview');
  if(j.impact.type==='shares.replace'){
   if(digest(await this.adapter.snapshot())!==digest(j.impact.before))throw Error('Configuration changed; request a new preview');
   await this.adapter.validatePaths(j.impact.shares);
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
  setImmediate(()=>this.execute(j));return j;
 }
 async event(j,message,progress){j.logs.push(message);j.progress=progress;j.events.push({sequence:j.events.length+1,time:new Date().toISOString(),message,progress,status:j.status});await this.save();this.emit('progress',j);}
 async cancel(id){const j=this.jobs.get(id);if(!j||!['queued','running'].includes(j.status)||j.commitStarted)throw Error('Cancellation unavailable after configuration commit begins');j.cancelRequested=true;await this.event(j,'Cancellation requested before commit',j.progress);return j;}
 async execute(j){
  if(j.impact.type!=='shares.replace')return this.executeVolume(j);
  try{j.status='running';await this.event(j,'Validating proposed configuration',10);await this.adapter.validate(j.impact.after);if(j.cancelRequested){j.status='cancelled';await this.event(j,'Cancelled before commit',100);return;}
   await this.recheck(j);
   if(j.cancelRequested){j.status='cancelled';await this.event(j,'Cancelled before commit',100);return;}
   if(digest(j.impact.before)===digest(j.impact.after)){j.status='succeeded';j.noop=true;await this.event(j,'Managed configuration already matches; no reload required',100);return;}
   j.rollback={available:true,before:j.impact.before,restored:false};j.commitStarted=true;await this.event(j,'Saved rollback configuration; entering non-cancellable commit',40);
   await this.adapter.apply(j.impact.after);await this.event(j,'Configuration committed; reloading services',70);await this.adapter.reload();j.status='succeeded';await this.event(j,'Share services configured',100);
  }catch(e){j.status='failed';j.logs.push(e.message);if(j.commitStarted){try{await this.adapter.apply(j.impact.before);await this.adapter.reload();j.rollback.restored=true;}catch(r){j.rollback.error=r.message;}}await this.event(j,'Operation failed; inspect rollback result',100);}finally{this.busy=false;}
 }
 async executeVolume(j){
  try{
   j.status='running';await this.event(j,'Checking exact disk identities and dependencies',10);await this.recheck(j);
   if(j.cancelRequested){j.status='cancelled';await this.event(j,'Cancelled before irreversible disk write',100);return;}
   j.commitStarted=true;await this.event(j,'Entering irreversible filesystem initialization; cancellation closed',30);
   const output=await this.volumes.apply(j.impact);j.commandOutput=output;
   await this.event(j,'Verifying resulting filesystem inventory',90);
   const hardware=await this.discover();const matches=hardware.filesystems.filter(f=>f.label===j.impact.label&&f.type===j.impact.filesystem);
   if(!j.impact.disks.every(d=>matches.some(f=>f.device===d.path)))throw Error('Filesystem initialization result could not be verified');
   j.result={filesystemIds:[...new Set(matches.map(f=>f.id))],diskIds:j.impact.disks.map(d=>d.id)};
   j.status='succeeded';await this.event(j,'Filesystem initialized; mount and access setup still required',100);
  }catch(e){j.status='failed';j.logs.push(e.message);j.rollback={available:false,reason:j.impact.rollback,inspectionRequired:!!j.commitStarted};await this.event(j,'Initialization failed; inspect disks before further work',100);}finally{this.busy=false;}
 }

}
export class ShareAdapter {
 constructor({smb='/etc/samba/lightnas-storage-agent.conf',nfs='/etc/exports.d/lightnas-storage-agent.exports',manifest='/var/lib/lightnas-storage/shares.json',run=command}={}){this.smb=smb;this.nfs=nfs;this.manifest=manifest;this.run=run;}
 async validatePaths(shares){for(const s of shares){const actual=await realpath(s.path);if(actual!==s.path||!(await lstat(actual)).isDirectory())throw Error('Share must be an existing directory without symlink traversal');}}
 async snapshot(){const read=async p=>{try{return await readFile(p,'utf8');}catch(e){if(e.code==='ENOENT')return '';throw e;}};return {smb:await read(this.smb),nfs:await read(this.nfs),manifest:await read(this.manifest)||'[]\n'};}
 async checked(bin,args){const r=await this.run(bin,args);if(!r.ok)throw Error(r.stderr||'Command failed');return r;}
 async validate(config){
  const main=await readFile('/etc/samba/smb.conf','utf8');
  const shares=validateShares(JSON.parse(config.manifest||'[]'));
  let legacy='';try{legacy=await readFile('/etc/samba/smb.conf.d/lightnas-shares.conf','utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  const sections=[...(main+'\n'+legacy).matchAll(/^\s*\[([^\]]+)\]/gm)].map(m=>m[1].toLowerCase());
  for(const share of shares)if(share.protocol==='smb'){if(sections.includes(share.name.toLowerCase()))throw Error('Share conflicts with administrator-managed Samba section');for(const user of share.users)await this.checked('/usr/bin/getent',['passwd',user]);}
  if(!main.split('\n').some(l=>/^\s*include\s*=\s*\/etc\/samba\/lightnas-storage-agent.conf\s*$/i.test(l)))throw Error('Samba must include /etc/samba/lightnas-storage-agent.conf');
  const p=this.smb+'.validate';const candidate=this.smb+'.main.validate';
  await writeFile(p,config.smb,{mode:0o600});
  await writeFile(candidate,main.replace(/^(\s*include\s*=\s*)\/etc\/samba\/lightnas-storage-agent.conf\s*$/im,'$1'+p),{mode:0o600});
  try{await this.checked('/usr/bin/testparm',['--suppress-prompt',candidate]);}finally{await unlink(p).catch(()=>{});await unlink(candidate).catch(()=>{});}
 }
 async apply(config){const previous=await this.snapshot();this.nfsReloadNeeded=Boolean(previous.nfs.trim()||config.nfs.trim());await atomic(this.smb,config.smb);await atomic(this.nfs,config.nfs);await atomic(this.manifest,config.manifest||'[]\n');}
 async shares(){try{return validateShares(JSON.parse(await readFile(this.manifest,'utf8')));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 async reload(){await this.checked('/usr/bin/testparm',['--suppress-prompt','/etc/samba/smb.conf']);if(this.nfsReloadNeeded)await this.checked('/usr/sbin/exportfs',['-ra']);await this.checked('/usr/bin/systemctl',['reload','smbd']);}
}
