import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,readdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const exec = promisify(execFile);
export async function command(bin,args,timeout=15000){
  try {return {ok:true,...await exec(bin,args,{timeout,maxBuffer:2*1024*1024,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'}})};}
  catch(e){return {ok:false,stdout:e.stdout||'',stderr:e.stderr||e.message,code:e.code};}
}
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function normalize(blocks){
 const disks=[],filesystems=[],pools=[];
 function walk(b,parent=null){
  if(b.type==='disk') disks.push({id:b.wwn||b.serial||b.path,path:b.path,size:Number(b.size),model:b.model,serial:b.serial,wwn:b.wwn,transport:b.tran,readOnly:!!b.ro,mounts:(b.mountpoints||[]).filter(Boolean),children:(b.children||[]).map(c=>({path:c.path,type:c.type,size:Number(c.size),filesystem:c.fstype||null,uuid:c.uuid||null,mounts:(c.mountpoints||[]).filter(Boolean)}))});
  if(b.fstype) filesystems.push({id:b.uuid||b.path,device:b.path,parent,type:b.fstype,label:b.label,uuid:b.uuid,mounts:(b.mountpoints||[]).filter(Boolean),size:Number(b.size)});
  if(['raid0','raid1','raid5','raid6','raid10','md','lvm'].includes(b.type)) pools.push({id:b.path,type:b.type,device:b.path,parent});
  for(const child of b.children||[])walk(child,b.path);
 }
 blocks.forEach(b=>walk(b));
 const groups=new Map();for(const f of filesystems){if(f.type==='btrfs'&&f.uuid){const group=groups.get(f.uuid)||[];group.push(f.device);groups.set(f.uuid,group);}}
 for(const [id,devices] of groups)if(devices.length>1)pools.push({id,type:'btrfs',devices});
 const poolMap=new Map();for(const pool of pools){const previous=poolMap.get(pool.id);if(previous){previous.memberDevices=[...new Set([...(previous.memberDevices||[]),pool.parent].filter(Boolean))];previous.devices=[...new Set([...(previous.devices||[]),...(pool.devices||[])])];}else poolMap.set(pool.id,{...pool,memberDevices:pool.parent?[pool.parent]:[]});}
 const fsMap=new Map();for(const fs of filesystems){const previous=fsMap.get(fs.id);if(previous){previous.devices=[...new Set([...previous.devices,fs.device])];previous.mounts=[...new Set([...previous.mounts,...fs.mounts])];}else fsMap.set(fs.id,{...fs,devices:[fs.device]});}
 return {disks,pools:[...poolMap.values()],filesystems:[...fsMap.values()],shares:[],health:[]};
}
export async function inventory(run=command,{includeHealth=true}={}){
 const result=await run('/usr/bin/lsblk',['--json','--bytes','--paths','--output','NAME,PATH,TYPE,SIZE,MODEL,SERIAL,WWN,TRAN,RO,FSTYPE,LABEL,UUID,MOUNTPOINTS']);
 if(!result.ok)throw Error('Disk inventory unavailable: '+result.stderr);
 const data=normalize(JSON.parse(result.stdout).blockdevices);
 data.warnings=[];
 const ids=new Set();for(const d of data.disks){if(ids.has(d.id))throw Error('Ambiguous duplicate disk identity: '+d.id);ids.add(d.id);}
 for(const d of data.disks){
  try {d.sysfs=await realpath('/sys/class/block/'+d.path.split('/').pop());d.logicalBlockSize=Number(await readFile(d.sysfs+'/queue/logical_block_size','utf8'));d.holders=await readdir(d.sysfs+'/holders');}catch{data.warnings.push('sysfs unavailable for '+d.path);}
  const signatures=await run('/usr/sbin/wipefs',['--json','--no-act',d.path]);
  try{d.signatures=signatures.ok?JSON.parse(signatures.stdout).signatures:null;}catch{d.signatures=null;}
  const udev=await run('/usr/bin/udevadm',['info','--query=property','--name',d.path]);
  d.udev=udev.ok?Object.fromEntries(udev.stdout.trim().split('\n').filter(line=>line.includes('=')).map(line=>{const p=line.indexOf('=');return [line.slice(0,p),line.slice(p+1)];})):null;
  if(!includeHealth)continue;
  const smart=await run('/usr/sbin/smartctl',['--json','--all',d.path]);
  let status;try{status=JSON.parse(smart.stdout);}catch{}
  data.health.push({diskId:d.id,status:status?.smart_status?.passed===false||Number(status?.nvme_smart_health_information_log?.critical_warning)>0?'Critical':(status?.ata_smart_attributes?.table?.some(a=>[5,187,197,198].includes(a.id)&&Number(a.raw?.value)>0)||Number(status?.nvme_smart_health_information_log?.media_errors)>0)?'Attention':status?.smart_status?.passed===true?'Healthy':'Unknown',temperature:status?.temperature?.current??null,available:!!status?.smart_status,commandSucceeded:smart.ok,exitStatus:status?.smartctl?.exit_status??null,nvmeCriticalWarning:status?.nvme_smart_health_information_log?.critical_warning??null,nvmeMediaErrors:status?.nvme_smart_health_information_log?.media_errors??null,ataAttributes:status?.ata_smart_attributes?.table?.filter(a=>[5,187,197,198].includes(a.id)).map(a=>({id:a.id,name:a.name,value:a.raw?.value}))||[]});
 }
 return data;
}
export function validateShares(shares){
 if(!Array.isArray(shares)||shares.length>256)throw Error('Invalid share list');
 const names=new Set(),paths=new Set();
 return shares.map(s=>{
  if(!s||typeof s.name!=='string'||!/^[-a-zA-Z0-9_]{1,64}$/.test(s.name)||names.has(s.name.toLowerCase())||['global','homes','printers','ipc$','files'].includes(s.name.toLowerCase()))throw Error('Invalid or duplicate share name');names.add(s.name.toLowerCase());
  if(typeof s.path!=='string'||!/^\/[-a-zA-Z0-9_/.]+$/.test(s.path)||s.path.split('/').some(p=>p==='..'||p==='.')||s.path.includes('//')||s.path.endsWith('/'))throw Error('Share path must be an absolute normalized data path');
  if(!['smb','nfs'].includes(s.protocol)||typeof s.readOnly!=='boolean')throw Error('Invalid protocol or access mode');
  if(s.protocol==='smb'&&(!Array.isArray(s.users)||!s.users.length||s.users.length>64||s.users.some(u=>typeof u!=='string'||!/^[-a-zA-Z0-9_]{1,32}$/.test(u))))throw Error('SMB requires explicit Unix users');
  if(s.protocol==='nfs'&&(!Array.isArray(s.clients)||!s.clients.length||s.clients.length>256||s.clients.some(c=>!validClient(c))))throw Error('NFS requires IPv4 CIDR clients');
  const key=s.protocol+':'+s.path;if(paths.has(key))throw Error('Duplicate path for share protocol');paths.add(key);
  return {name:s.name,path:s.path,protocol:s.protocol,readOnly:s.readOnly,...(s.protocol==='smb'?{users:[...new Set(s.users)].sort()}:{clients:[...new Set(s.clients)].sort()})};
 }).sort((a,b)=>a.name.localeCompare(b.name));
}
function validClient(c){if(typeof c!=='string')return false;const m=c.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);return !!m&&m[1].split('.').every(n=>Number(n)<=255)&&Number(m[2])<=32;}
export function renderShares(shares){
 const clean=validateShares(shares);
 return {smb:clean.filter(s=>s.protocol==='smb').map(s=>`[${s.name}]\npath = ${s.path}\nread only = ${s.readOnly?'yes':'no'}\nguest ok = no\nvalid users = ${s.users.join(' ')}\n`).join('\n'),nfs:clean.filter(s=>s.protocol==='nfs').map(s=>`${s.path} ${s.clients.map(c=>`${c}(${s.readOnly?'ro':'rw'},sync,root_squash,no_subtree_check)`).join(' ')}`).join('\n')+'\n'};
}
