import {lstat,realpath} from 'node:fs/promises';
import {command,digest} from './storage.js';
export const DATASET_TYPES=['dataset.create','dataset.update','dataset.quota','dataset.permissions','zvol.create','snapshot.create'];
export const PRESETS={generic:{compression:'lz4',atime:'off',casesensitivity:'sensitive'},smb:{compression:'lz4',atime:'off',casesensitivity:'mixed',acltype:'posixacl',xattr:'sa'},apps:{compression:'lz4',atime:'off',casesensitivity:'sensitive'},multiprotocol:{compression:'lz4',atime:'off',casesensitivity:'sensitive',acltype:'posixacl',xattr:'sa'}};
const properties=['name','type','guid','mountpoint','used','available','referenced','usedbychildren','usedbysnapshots','compression','compressratio','encryption','keystatus','sync','atime','dedup','casesensitivity','quota','refquota','reservation','readonly','volsize'];
export function datasetName(value){if(typeof value!=='string'||value.length>240||!value.split('/').every(p=>/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(p)))throw Error('Invalid dataset name');return value;}
export function snapshotName(value){const [dataset,name,...rest]=String(value||'').split('@');datasetName(dataset);if(rest.length||!name||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(name))throw Error('Invalid snapshot name');return value;}
export function dataPath(value){if(typeof value!=='string'||!/^\/(storage|mnt|media|srv|data)(\/|$)/.test(value)||value.length>1024||value.includes('\0')||value.split('/').some(p=>p==='..'||p==='.')||value.includes('//')||/[\r\n]/.test(value))throw Error('Choose an absolute mounted data directory');return value.replace(/\/$/,'');}
function quota(value){const n=Number(value);if(!Number.isInteger(n)||n<0||n>1048576)throw Error('Quota must be 0–1048576 GiB');return n?n+'G':'none';}
const editable={compression:['off','lz4','zstd','gzip'],sync:['standard','always'],atime:['on','off'],dedup:['off','on'],readonly:['on','off']};
export class DatasetAdapter{
 constructor({run=command}={}){this.run=run;}
 async checked(args){const result=await this.run('/usr/sbin/zfs',args);if(!result.ok)throw Error('ZFS command failed: '+result.stderr);return result.stdout;}
 async inventory(){
  const result=await this.run('/usr/sbin/zfs',['list','-H','-p','-t','filesystem,volume','-o',properties.join(',')]);
  if(!result.ok)return {available:false,reason:'ZFS tools or datasets are unavailable on this host.',datasets:[],snapshots:[]};
  const datasets=result.stdout.trim().split('\n').filter(Boolean).map(line=>Object.fromEntries(properties.map((p,i)=>[p,line.split('\t')[i]])));
  const snapshotsResult=await this.run('/usr/sbin/zfs',['list','-H','-p','-t','snapshot','-o','name,used,referenced,creation','-s','creation']);
  if(!snapshotsResult.ok)throw Error('Snapshot inventory unavailable');
  const snapshots=snapshotsResult.stdout.trim().split('\n').filter(Boolean).map(line=>{const [name,used,referenced,created]=line.split('\t');return {name,used:Number(used),referenced:Number(referenced),created:Number(created)};});
  return {available:true,datasets,snapshots};
 }
 async directory(dataset){let path;try{path=dataPath(dataset.mountpoint);}catch{path=String(dataset.mountpoint||'');if(!/^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)||/^\/(etc|usr|bin|sbin|boot|dev|proc|sys|run|var|home|root|opt)(\/|$)/.test(path)||path.split('/').some(p=>p==='.'||p==='..'))throw Error('System datasets cannot be changed through this data-storage workflow');}if(await realpath(path)!==path)throw Error('Dataset mount has symlink traversal');const st=await lstat(path);if(!st.isDirectory())throw Error('Dataset is not a mounted directory');return {path,uid:st.uid,gid:st.gid,mode:(st.mode&0o7777).toString(8),ino:st.ino,dev:st.dev};}
 async detail(name){datasetName(name);const inventory=await this.inventory();const dataset=inventory.datasets.find(d=>d.name===name);if(!dataset)throw Error('Dataset not found');
  const result={...dataset,snapshots:inventory.snapshots.filter(s=>s.name.startsWith(name+'@')),children:inventory.datasets.filter(d=>d.name.startsWith(name+'/'))};
  if(dataset.type==='filesystem'&&dataset.mountpoint!=='none'&&dataset.mountpoint!=='legacy'){
   try{result.permissions=await this.directory(dataset);}catch(error){result.permissionWarning=error.message;return result;}
   const acl=await this.run('/usr/bin/getfacl',['-c','-p','--',result.permissions.path]);result.permissions.acl=acl.ok?acl.stdout:null;
   for(const [field,cmd] of [['userQuotas','userspace'],['groupQuotas','groupspace']]){const q=await this.run('/usr/sbin/zfs',[cmd,'-H','-p','-o','name,used,quota',name]);result[field]=q.ok?q.stdout.trim().split('\n').filter(Boolean).map(l=>{const [name,used,quota]=l.split('\t');return {name,used,quota};}):[];}
  }return result;
 }
 async plan(input){
  const {type}=input;if(!DATASET_TYPES.includes(type))throw Error('Unsupported dataset operation');const inventory=await this.inventory();if(!inventory.available)throw Error(inventory.reason);
  const name=datasetName(input.dataset||input.parent);const current=inventory.datasets.find(d=>d.name===name);if(!current)throw Error('Dataset is not present');
  if(['dataset.update','dataset.quota','dataset.permissions'].includes(type)&&current.type==='filesystem')await this.directory(current);
  const commands=[],undo=[];let after,identity={name:current.name,guid:current.guid,type:current.type,mountpoint:current.mountpoint};let confirmation;
  if(type==='dataset.create'||type==='zvol.create'){
   if(current.type!=='filesystem')throw Error('Parent must be a filesystem dataset');const parent=await this.directory(current);const leaf=String(input.name||'');if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(leaf))throw Error('Invalid child name');const full=name+'/'+leaf;if(inventory.datasets.some(d=>d.name===full))throw Error('Dataset already exists');
   const preset=input.preset||'generic';if(!Object.hasOwn(PRESETS,preset))throw Error('Choose a supported dataset preset');const options={...PRESETS[preset],compression:input.compression||PRESETS[preset].compression};if(!editable.compression.includes(options.compression))throw Error('Unsupported compression');
   const args=['create'];if(type==='zvol.create'){const size=Number(input.sizeGiB);if(!Number.isInteger(size)||size<1||size>1048576)throw Error('Volume size must be 1–1048576 GiB');if(input.sparse===true)args.push('-s');args.push('-V',size+'G');for(const property of ['casesensitivity','atime','acltype','xattr'])delete options[property];after={name:full,type:'volume',sizeGiB:size,sparse:input.sparse===true};}
   else{options.quota=quota(input.quotaGiB||0);options.mountpoint=parent.path+'/'+leaf;after={name:full,preset,type:'filesystem',properties:options,encryption:'Inherited from parent'};}
   for(const [key,value] of Object.entries(options))args.push('-o',key+'='+value);args.push(full);commands.push({bin:'/usr/sbin/zfs',args});identity={...identity,childAbsent:full};
  }else if(type==='snapshot.create'){
   const full=snapshotName(name+'@'+String(input.name||''));if(inventory.snapshots.some(s=>s.name===full))throw Error('Snapshot already exists');commands.push({bin:'/usr/sbin/zfs',args:['snapshot',full]});after={snapshot:full};identity={...identity,snapshotAbsent:full};
  }else if(type==='dataset.update'){
   const property=String(input.property||'');let value=String(input.value||'');if(['quota','refquota','reservation'].includes(property)){if(value!=='none'&&!/^[1-9][0-9]{0,6}G$/.test(value))throw Error('Use a quota in GiB or none');if(current.type==='volume')throw Error('Use volume size for a zvol');}
   else if(!editable[property]?.includes(value))throw Error('Unsupported dataset property/value');
   const [before,source]=(await this.checked(['get','-H','-p','-o','value,source',property,name])).trim().split('\t');
   commands.push({bin:'/usr/sbin/zfs',args:['set',property+'='+value,name]});undo.push({bin:'/usr/sbin/zfs',args:source==='received'?['inherit','-S',property,name]:source==='default'||source?.startsWith('inherited from ')?['inherit',property,name]:['set',property+'='+before,name]});after={property,value};identity={...identity,property,before,source};
  }else if(type==='dataset.quota'){
   if(current.type!=='filesystem')throw Error('User/group quotas require a filesystem');const subject=String(input.subject||'');if(!/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(subject)||!['user','group'].includes(input.kind))throw Error('Choose a Unix user or group');const lookup=await this.run('/usr/bin/getent',[input.kind==='user'?'passwd':'group',subject]);if(!lookup.ok)throw Error('Unix account does not exist');
   const property=(input.kind==='user'?'userquota@':'groupquota@')+subject;const before=(await this.checked(['get','-H','-p','-o','value',property,name])).trim();const value=quota(input.quotaGiB);
   commands.push({bin:'/usr/sbin/zfs',args:['set',property+'='+value,name]});undo.push({bin:'/usr/sbin/zfs',args:['set',property+'='+before,name]});after={property,value};identity={...identity,property,before};
  }else{
   if(current.type!=='filesystem')throw Error('Permissions require a filesystem');const original=await this.directory(current);const uid=Number(input.uid),gid=Number(input.gid),mode=String(input.mode||'');if(!Number.isSafeInteger(uid)||uid<0||uid>2147483647||!Number.isSafeInteger(gid)||gid<0||gid>2147483647||!/^[0-7]{3}$/.test(mode))throw Error('Use numeric owner/group IDs and a three-digit Unix mode');
   const acl=await this.run('/usr/bin/getfacl',['-c','-p','--',original.path]);if(!acl.ok)throw Error('Current permissions cannot be read');identity={...identity,directory:original,acl:acl.stdout};after={path:original.path,uid,gid,mode,recursive:false};
   commands.push({bin:'/usr/bin/chown',args:['--',uid+':'+gid,original.path]},{bin:'/usr/bin/chmod',args:['--',mode,original.path]});undo.push({bin:'/usr/bin/chown',args:['--',original.uid+':'+original.gid,original.path]},{bin:'/usr/bin/chmod',args:['--',original.mode,original.path]});
  }
  return {type,input,identity,before:identity,after,commands,undo,affectedServices:[],dataErased:false,permissionChanges:type==='dataset.permissions',confirmation,warning:type==='dataset.permissions'?'Changes only this directory, never recursively. ACL masks can be affected by chmod.':type==='zvol.create'?'Allocates a block volume. Sparse volumes can exhaust available pool space.':input.property==='dedup'?'Deduplication can substantially increase memory consumption.':'Changes only the selected ZFS object. Child datasets are not recursively changed.',rollback:undo.length?'Restore the previous property/owner/mode; client activity cannot be rolled back.':'Created objects are not automatically destroyed on failure; inspect any partially created object.'};
 }
 async validate(impact){if(digest(await this.plan(impact.input))!==digest(impact))throw Error('Dataset state changed; request another preview');}
 async apply(impact){try{for(const c of impact.commands){const result=await this.run(c.bin,c.args,120000);if(!result.ok)throw Error('Dataset command failed: '+result.stderr);}
   const inv=await this.inventory();if(impact.after.snapshot){if(!inv.snapshots.some(s=>s.name===impact.after.snapshot))throw Error('Snapshot result not verified');}
   else if(impact.after.name&&!inv.datasets.some(d=>d.name===impact.after.name))throw Error('Created dataset not verified');
   else if(impact.after.property){const actual=(await this.checked(['get','-H','-o','value',impact.after.property,impact.identity.name])).trim();const equivalent=actual===impact.after.value||/^[1-9][0-9]*G$/.test(impact.after.value)&&Number(actual)===Number(impact.after.value.slice(0,-1))*1073741824;if(!equivalent)throw Error('Dataset property write not verified');}
   else if(impact.after.path){const actual=await this.directory(inv.datasets.find(d=>d.name===impact.identity.name));if(actual.uid!==impact.after.uid||actual.gid!==impact.after.gid||parseInt(actual.mode,8)!==parseInt(impact.after.mode,8))throw Error('Permission write not verified');}
   return impact.after;
  }catch(error){const recovery=[];for(const c of impact.undo){const result=await this.run(c.bin,c.args);recovery.push({restored:result.ok});}error.recovery=recovery;throw error;}
 }
}
