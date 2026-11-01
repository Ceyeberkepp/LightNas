import {readFile,mkdir,realpath,lstat} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {atomic} from './persistence.js';
import {command,digest} from './storage.js';
import {dataPath,datasetName,snapshotName} from './datasets.js';
import {assertSeparateRsyncTrees} from './mount-identity.js';
export const PROTECTION_TYPES=['protection.task.save','protection.task.delete','protection.run','cloud.remote.save','replication.profile.save'];
const name=value=>{if(typeof value!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{1,47}$/.test(value))throw Error('Use a 2–48 character task/profile name');return value;};
const remoteFields={s3:['provider','access_key_id','secret_access_key','region','endpoint'],drive:['token','root_folder_id','service_account_credentials','client_id','client_secret'],googlephotos:['token','client_id','client_secret','read_only'],dropbox:['token'],azureblob:['account','key','sas_url'],b2:['account','key'],tardigrade:['access_grant']};
async function json(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return structuredClone(fallback);throw error;}}
export function nextRun(schedule,now=new Date()){
 if(schedule.frequency==='on-demand')return null;
 if(!['hourly','daily','weekly'].includes(schedule.frequency)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time||'')||schedule.frequency==='weekly'&&(!Number.isInteger(schedule.weekday)||schedule.weekday<0||schedule.weekday>6))throw Error('Use an hourly/daily/weekly UTC schedule with a valid time');
 const next=new Date(now),[hour,minute]=schedule.time.split(':').map(Number);next.setUTCSeconds(0,0);
 if(schedule.frequency==='hourly'){next.setUTCMinutes(minute);if(next<=now)next.setUTCHours(next.getUTCHours()+1);}
 else{next.setUTCHours(hour,minute);if(schedule.frequency==='weekly'){let days=(schedule.weekday-next.getUTCDay()+7)%7;if(days===0&&next<=now)days=7;next.setUTCDate(next.getUTCDate()+days);}else if(next<=now)next.setUTCDate(next.getUTCDate()+1);}
 return next.toISOString();
}
export async function replicate(commands,timeout=1800000){
 return new Promise((resolve,reject)=>{
  const sender=spawn(commands[0].bin,commands[0].args,{stdio:['ignore','pipe','pipe']}),receiver=spawn(commands[1].bin,commands[1].args,{stdio:['pipe','ignore','pipe']});let completed=0,failed=false;const codes=[];
  const fail=()=>{if(failed)return;failed=true;clearTimeout(timer);sender.kill('SIGKILL');receiver.kill('SIGKILL');reject(Error('Replication failed; inspect source snapshot and destination before retrying'));};
  const timer=setTimeout(fail,timeout);sender.stdout.on('error',fail);receiver.stdin.on('error',fail);sender.stdout.pipe(receiver.stdin);sender.stderr.resume();receiver.stderr.resume();
  for(const [index,child] of [sender,receiver].entries()){child.on('error',fail);child.on('close',code=>{codes[index]=code;if(++completed===2){clearTimeout(timer);if(codes.some(c=>c!==0))fail();else if(!failed)resolve();}});}
 });
}
export class ProtectionAdapter{
 constructor({dir='/var/lib/lightnas-storage',datasets,run=command,pipeline=replicate,mountInfo=()=>readFile('/proc/self/mountinfo','utf8')}={}){this.dir=join(dir,'protection');this.dataDir=dirname(resolve(process.env.NAS_DATA_FILE||'/var/lib/lightnas/state.json'));this.datasets=datasets;this.run=run;this.pipeline=pipeline;this.mountInfo=mountInfo;}
 async rsyncTopology(source,target){return assertSeparateRsyncTrees(source,target,await this.mountInfo());}
 async init(){await mkdir(this.dir,{recursive:true,mode:0o700});}
 async registry(){return json(join(this.dir,'registry.json'),{tasks:[],cloudRemotes:[],replicationProfiles:[]});}
 async liveRemotes(){let text;try{text=await readFile(join(this.dir,'rclone.conf'),'utf8');}catch(error){if(error.code==='ENOENT')return json(join(this.dir,'remotes.json'),{});throw error;}const remotes={};let current;for(const raw of text.split('\n')){const line=raw.trim();if(!line||line.startsWith('#')||line.startsWith(';'))continue;const section=line.match(/^\[([^\]]+)\]$/);if(section){current=name(section[1]);remotes[current]={};continue;}const field=line.match(/^([a-z_]+)\s*=\s*(.*)$/);if(!current||!field)throw Error('Cloud configuration cannot be safely parsed');remotes[current][field[1]]=field[2];}for(const fields of Object.values(remotes)){const provider=fields.type==='google photos'?'googlephotos':fields.type;const allowed=remoteFields[provider];if(!allowed||Object.keys(fields).some(k=>k!=='type'&&!allowed.includes(k)))throw Error('Cloud configuration contains unsupported options');}return remotes;}
 async runtime(){return json(join(this.dir,'runtime.json'),{});}
 async inventory(){const registry=await this.registry(),runtime=await this.runtime();return {...registry,tasks:registry.tasks.map(t=>({...t,runtime:Object.hasOwn(runtime,t.id)?runtime[t.id]:{},nextRun:t.enabled?((Object.hasOwn(runtime,t.id)?runtime[t.id]?.nextRun:null)||nextRun(t.schedule)):null}))};}
 async directory(path){try{path=dataPath(path);}catch(error){const managed=[join(this.dataDir,'files'),join(this.dataDir,'storage')];if(typeof path!=='string'||resolve(path)!==path||/[\r\n\0]/.test(path)||!managed.some(root=>path===root||path.startsWith(root+'/')))throw error;}if(await realpath(path)!==path)throw Error('Source/destination must not traverse a symlink');const st=await lstat(path);if(!st.isDirectory())throw Error('Choose an existing directory');return {path,ino:st.ino,dev:st.dev};}
 prepare(input){return input.type==='protection.run'?{...input,runStamp:input.runStamp||Date.now()}:input;}
 async normalizeTask(input,registry){
  if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw Error('Task enabled state must be a boolean');const id=name(input.id),kind=String(input.kind||'');if(!['snapshot','rsync','cloud','replication'].includes(kind))throw Error('Choose snapshot, rsync, cloud or ZFS replication');const schedule=input.schedule||{frequency:'on-demand'};nextRun(schedule);const task={id,kind,schedule,enabled:input.enabled!==false,source:String(input.source||''),target:String(input.target||''),retention:input.retention===undefined?7:Number(input.retention),mode:input.mode||'copy',direction:input.direction||'push'};if(!['copy','mirror'].includes(task.mode)||!['push','pull'].includes(task.direction))throw Error('Choose copy/mirror and push/pull');if(kind!=='cloud'&&task.direction!=='push')throw Error('Download direction is available only for cloud tasks');if(['snapshot','replication'].includes(kind)&&(task.mode!=='copy'||task.direction!=='push'))throw Error('Snapshot/replication jobs do not use copy direction or mirror mode');
  if(!Number.isInteger(task.retention)||task.retention<1||task.retention>1000)throw Error('Snapshot retention must be 1–1000');
  let source,target,mountTopology;
  if(['snapshot','replication'].includes(kind)){datasetName(task.source);const inv=await this.datasets.inventory();source=inv.datasets.find(d=>d.name===task.source);if(!source)throw Error('Source dataset not found');source={name:source.name,guid:source.guid};if(kind==='replication'){datasetName(task.target);task.profile=name(input.profile);if(!registry.replicationProfiles.some(p=>p.name===task.profile))throw Error('Select an SSH replication profile');}}
  else{source=await this.directory(task.source);if(kind==='rsync'){target=await this.directory(task.target);if(source.path===target.path||source.path.startsWith(target.path+'/')||target.path.startsWith(source.path+'/')||(source.dev===target.dev&&source.ino===target.ino))throw Error('Source and destination must be separate directory trees, including bind-mounted aliases');mountTopology=await this.rsyncTopology(source.path,target.path);const check=await this.run('/usr/bin/rsync',['--version']);if(!check.ok)throw Error('rsync is not installed');}
   else{if(!/^[A-Za-z][A-Za-z0-9_-]{1,47}:[A-Za-z0-9_./-]*$/.test(task.target)||task.target.split('/').some(p=>p==='..'||p==='.')||!registry.cloudRemotes.some(r=>r.name===task.target.split(':')[0]))throw Error('Choose a configured remote:path without traversal');const check=await this.run('/usr/bin/rclone',['version']);if(!check.ok)throw Error('rclone is not installed');}}
  return {task,source,target,mountTopology};
 }
 async plan(raw){
  const input=this.prepare(raw),{type}=input;if(!PROTECTION_TYPES.includes(type))throw Error('Unsupported protection operation');const before=await this.registry(),after=structuredClone(before),commands=[];let context={},result,privateValues={},files=[];
  if(type==='cloud.remote.save'){
   const remote=name(input.name),provider=String(input.provider||'');const fields=remoteFields[provider];const credentials=input.private?.credentials;if(!fields||!credentials||typeof credentials!=='object'||Array.isArray(credentials)||Object.entries(credentials).some(([k,v])=>!fields.includes(k)||typeof v!=='string'||v.length>20000||/[\r\n\0]/.test(v))||!Object.keys(credentials).length)throw Error('Provide supported cloud provider credentials with one-line values');
   const previousFile=await this.liveRemotes();privateValues={credentials,previousFile};files=[join(this.dir,'rclone.conf')];result={name:remote,provider,credentialFingerprint:digest(credentials)};after.cloudRemotes=after.cloudRemotes.filter(r=>r.name!==remote).concat(result);
  }else if(type==='replication.profile.save'){
   const profile=name(input.name),host=String(input.host||''),user=String(input.user||'');if(!/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(host)||! /^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(user))throw Error('Enter a hostname/IP and Unix SSH user');const port=Number(input.port||22);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid SSH port');const key=String(input.private?.privateKey||''),hostKey=String(input.private?.hostKey||'').trim();if(!key.includes('PRIVATE KEY')||key.length>20000||! /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]{40,2048}$/.test(hostKey))throw Error('Provide an unencrypted SSH private key and pinned host public key (algorithm base64)');
   privateValues={privateKey:key,hostKey};result={name:profile,host,user,port,keyFingerprint:digest(key),hostKeyFingerprint:digest(hostKey)};after.replicationProfiles=after.replicationProfiles.filter(p=>p.name!==profile).concat(result);files=[join(this.dir,profile+'.key'),join(this.dir,profile+'.known_hosts')];
  }else if(type==='protection.task.save'){
   const normalized=await this.normalizeTask(input,before);context={source:normalized.source,target:normalized.target,mountTopology:normalized.mountTopology};result=normalized.task;after.tasks=after.tasks.filter(t=>t.id!==result.id).concat(result);
  }else if(type==='protection.task.delete'){
   const id=name(input.id);if(!before.tasks.some(t=>t.id===id))throw Error('Task not found');after.tasks=after.tasks.filter(t=>t.id!==id);result={id,removed:true};
  }else{
   const task=before.tasks.find(t=>t.id===name(input.id));if(!task)throw Error('Task not found');const normalized=await this.normalizeTask(task,before);context={source:normalized.source,target:normalized.target,mountTopology:normalized.mountTopology,task};result={id:task.id,kind:task.kind};
   if(['snapshot','replication'].includes(task.kind)){
    if(!Number.isSafeInteger(input.runStamp)||input.runStamp<1)throw Error('Invalid task run stamp');const snap=snapshotName(task.source+'@lightnas-'+task.id+'-'+input.runStamp);const inv=await this.datasets.inventory();if(inv.snapshots.some(s=>s.name===snap))throw Error('Task snapshot already exists');context.snapshot=snap;
    commands.push({bin:'/usr/sbin/zfs',args:['snapshot',snap]});
    // Retention only touches snapshots created for this exact task/dataset.
    const owned=inv.snapshots.filter(s=>s.name.startsWith(task.source+'@lightnas-'+task.id+'-')&&/^\d+$/.test(s.name.slice((task.source+'@lightnas-'+task.id+'-').length))).sort((a,b)=>a.created-b.created);context.prune=owned.slice(0,Math.max(0,owned.length+1-task.retention)).map(s=>s.name);
    if(task.kind==='replication'){
     const profile=before.replicationProfiles.find(p=>p.name===task.profile);context.profile=profile;
     context.credentialState={key:digest(await readFile(join(this.dir,profile.name+'.key'),'utf8')),hostKey:digest(await readFile(join(this.dir,profile.name+'.known_hosts'),'utf8'))};
     // A successful SSH receive exit is not evidence that the expected replica
     // snapshot exists. Compare the immutable ZFS snapshot GUID at both ends.
     const remoteDataset=datasetName(task.target+'/lightnas-'+task.id+'-'+input.runStamp);
     const remoteSnapshot=snapshotName(remoteDataset+'@'+snap.split('@')[1]);
     const sshArgs=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-o','UserKnownHostsFile='+join(this.dir,profile.name+'.known_hosts'),'-i',join(this.dir,profile.name+'.key'),'-p',String(profile.port),profile.user+'@'+profile.host];
     context.pipeline=[{bin:'/usr/sbin/zfs',args:['send',snap]},{bin:'/usr/bin/ssh',args:[...sshArgs,'zfs receive -u '+remoteDataset]}];
     context.remoteVerification={
      source:{bin:'/usr/sbin/zfs',args:['get','-H','-o','value','guid',snap]},
      target:{bin:'/usr/bin/ssh',args:[...sshArgs,'zfs get -H -o value guid '+remoteSnapshot]},
      snapshot:remoteSnapshot
     };
    }
   }else if(task.kind==='rsync')commands.push({bin:'/usr/bin/rsync',args:['-a','--safe-links','--numeric-ids',...(task.mode==='mirror'?['--delete']:[]),'--',task.source+'/',task.target+'/']});
   else {context.credentialState=digest(await readFile(join(this.dir,'rclone.conf'),'utf8'));commands.push({bin:'/usr/bin/rclone',args:[task.mode==='mirror'?'sync':'copy','--config',join(this.dir,'rclone.conf'),'--',...(task.direction==='pull'?[task.target,task.source]:[task.source,task.target])]});}
  }
  const fileState=[];for(const path of files){try{const bytes=await readFile(path);fileState.push({path,exists:true,bytes:bytes.length,fingerprint:digest(bytes.toString('base64'))});}catch(error){if(error.code!=='ENOENT')throw error;fileState.push({path,exists:false});}}
  const policy=type==='protection.run'?context.task:type==='protection.task.save'?result:null;const mirror=policy?.mode==='mirror';const destination=policy?.kind==='cloud'&&policy.direction==='pull'?policy.source:policy?.target;
  return {type,input,before,after,context,result,private:privateValues,commands,files,fileState,dataErased:!!context.prune?.length||!!mirror,confirmation:mirror?(type==='protection.task.save'?'AUTHORIZE MIRROR '+policy.id:'MIRROR '+destination):undefined,permissionChanges:false,affectedServices:[],warning:mirror?'Mirror policy can delete destination-only files and overwrite matching files. The approved schedule authorizes future deletions at this exact destination.':type==='protection.task.save'?'Approves this recurring policy. Future runs include files present at execution time. Snapshot retention can remove only this task’s own old snapshots.':type==='protection.run'?'Copies may replace destination files of the same name. Copy jobs do not delete unrelated destination files. A remote receive creates a new unmounted dataset.':'Stores only this task/profile configuration.',rollback:type==='protection.run'?'No automatic file/remote rollback. Inspect partially copied data or received datasets after failure.':'Restore saved configuration; already executed task runs cannot be undone.'};
 }
 async validate(impact){if(digest(await this.plan(impact.input))!==digest(impact))throw Error('Protection policy or data source changed; request another preview');}
 async apply(impact){await this.init();
  if(impact.type==='protection.run'){
   if(impact.context?.task?.kind==='rsync'){
    // A bind mount can alias one directory through unrelated absolute paths.
    // Recheck both inodes immediately before a destructive mirror command,
    // not only at preview time; never run rsync against a changed target.
    const source=await this.directory(impact.context.task.source);
    const target=await this.directory(impact.context.task.target);
    const priorSource=impact.context.source,priorTarget=impact.context.target;
    if(source.dev===target.dev&&source.ino===target.ino)throw Error('Backup source and target resolve to the same directory; refusing to run');
    const topology=await this.rsyncTopology(source.path,target.path);
    if(!impact.context.mountTopology||digest(topology)!==digest(impact.context.mountTopology))
     throw Error('Backup mount topology changed since preview; refusing to run');
    if(!priorSource||!priorTarget||source.dev!==priorSource.dev||source.ino!==priorSource.ino||target.dev!==priorTarget.dev||target.ino!==priorTarget.ino)
     throw Error('Backup source or target changed since preview; refusing to run');
   }
   for(const c of impact.commands){const result=await this.run(c.bin,c.args,1800000);if(!result.ok)throw Error('Protection command failed; inspect task destination and operation history');}
   // Do not destroy the last usable recovery points when a snapshot command
   // reports success but ZFS inventory does not contain the new snapshot.
   const verifyCreatedSnapshot=async()=>{
    if(!impact.context.snapshot)return;
    const inv=await this.datasets.inventory();
    if(!inv.snapshots.some(s=>s.name===impact.context.snapshot))
     throw Error('Created snapshot not verified; existing recovery snapshots retained');
   };
   await verifyCreatedSnapshot();
   if(impact.context.pipeline){
    await this.pipeline(impact.context.pipeline);
    if(impact.context.task?.kind==='replication'){
     const verification=impact.context.remoteVerification;
     if(!verification?.source||!verification?.target||!verification.snapshot)
      throw Error('Remote replica verification missing; existing recovery snapshots retained');
     const source=await this.run(verification.source.bin,verification.source.args,120000);
     const target=await this.run(verification.target.bin,verification.target.args,120000);
     const guid=result=>result?.ok&&/^\\d+$/.test(String(result.stdout||'').trim())?result.stdout.trim():null;
     if(!guid(source)||guid(source)!==guid(target))
      throw Error('Remote replica snapshot GUID not verified; existing recovery snapshots retained');
    }
    // Recheck after a potentially long remote transfer before retention.
    await verifyCreatedSnapshot();
   }
   for(const snap of impact.context.prune||[]){
    await verifyCreatedSnapshot();
    const result=await this.run('/usr/sbin/zfs',['destroy',snap],120000);
    if(!result.ok)throw Error('Task completed, but snapshot retention failed; inspect the snapshot list');
   }
   return {...impact.result,snapshot:impact.context.snapshot||null};
  }
  const restore=[];const write=async(path,value)=>{let old=null;try{old=await readFile(path);}catch(e){if(e.code!=='ENOENT')throw e;}restore.push({path,old});await atomic(path,value);};
  try{
   if(impact.type==='cloud.remote.save'){const remotes={...impact.private.previousFile,[impact.result.name]:{type:impact.result.provider==='googlephotos'?'google photos':impact.result.provider,...impact.private.credentials}};await write(join(this.dir,'remotes.json'),JSON.stringify(remotes));await write(join(this.dir,'rclone.conf'),Object.entries(remotes).map(([id,fields])=>'['+name(id)+']\n'+Object.entries(fields).map(([k,v])=>k+' = '+v).join('\n')).join('\n\n')+'\n');}
   if(impact.type==='replication.profile.save'){const profile=impact.result;await write(join(this.dir,profile.name+'.key'),impact.private.privateKey);await write(join(this.dir,profile.name+'.known_hosts'),(profile.port===22?profile.host:'['+profile.host+']:'+profile.port)+' '+impact.private.hostKey+'\n');const check=await this.run('/usr/bin/ssh-keygen',['-y','-P','','-f',join(this.dir,profile.name+'.key')]);if(!check.ok)throw Error('SSH key must be valid and unencrypted');}
   await write(join(this.dir,'registry.json'),JSON.stringify(impact.after,null,2));
   if(impact.type==='protection.task.save'||impact.type==='protection.task.delete'){const runtime=await this.runtime();delete runtime[impact.input.id];await write(join(this.dir,'runtime.json'),JSON.stringify(runtime));}
   return impact.result;
  }catch(error){const {rm}=await import('node:fs/promises');for(const saved of restore.reverse())try{if(saved.old===null)await rm(saved.path,{force:true});else await atomic(saved.path,saved.old);}catch{error.recovery='Protection configuration restoration incomplete';}throw error;}
 }
 async record(id,values){const runtime=await this.runtime();runtime[id]={...(Object.hasOwn(runtime,id)?runtime[id]:{}),...values};await atomic(join(this.dir,'runtime.json'),JSON.stringify(runtime));}
}
