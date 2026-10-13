import {lstat,realpath} from 'node:fs/promises';
import {command,digest} from './storage.js';
export function fingerprint(hardware){
 return digest({disks:hardware.disks.map(d=>({id:d.id,path:d.path,size:d.size,serial:d.serial,wwn:d.wwn,readOnly:d.readOnly,children:d.children,mounts:d.mounts,holders:d.holders,signatures:d.signatures})),filesystems:hardware.filesystems,pools:hardware.pools});
}
export function planVolume(input,hardware){
 if(!['filesystem.create','pool.create'].includes(input.type))throw Error('Unsupported mutation');
 if(!['ext4','btrfs'].includes(input.filesystem))throw Error('Only ext4 and Btrfs are supported');
 if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,15}$/.test(input.label))throw Error('Label must be 1–16 safe characters starting with a letter');
 if(hardware.filesystems.some(f=>f.label===input.label))throw Error('Filesystem label already exists');
 if(!Array.isArray(input.diskIds)||new Set(input.diskIds).size!==input.diskIds.length||input.diskIds.length<1||input.diskIds.length>16)throw Error('Select distinct disk identities');
 if(input.type==='filesystem.create'&&input.diskIds.length!==1)throw Error('Filesystem creation requires one disk');
 if(input.type==='pool.create'&&(input.filesystem!=='btrfs'||input.diskIds.length<2||input.profile!=='raid1'))throw Error('Pool creation supports Btrfs RAID1 on at least two disks');
 const disks=input.diskIds.map(id=>{
  const d=hardware.disks.find(d=>d.id===id);if(!d)throw Error('Disk identity missing: '+id);
  if(!d.serial&&!d.wwn)throw Error('Disk requires a stable serial or WWN');
  if(!/^\/dev\/(sd[a-z]+|vd[a-z]+|nvme\d+n\d+)$/.test(d.path))throw Error('Unsupported physical disk path');
  if(d.readOnly||!Number.isSafeInteger(d.size)||d.size<1024**3)throw Error('Disk is read-only or too small');
  if(!Array.isArray(d.signatures)||!Array.isArray(d.holders)||!Array.isArray(d.children)||!Array.isArray(d.mounts))throw Error('Complete disk safety inventory required');
  if(d.signatures.length||d.holders.length||d.children.length||d.mounts.length||hardware.filesystems.some(f=>f.device===d.path||f.parent===d.path))throw Error('Disk contains signatures, partitions, mounts or active dependents');
  return structuredClone(d);
 }).sort((a,b)=>a.id.localeCompare(b.id));
 const paths=disks.map(d=>d.path);
 const argv=input.filesystem==='ext4'?['/usr/sbin/mkfs.ext4','-F','-L',input.label,...paths]:['/usr/sbin/mkfs.btrfs','-L',input.label,...(input.type==='pool.create'?['-d','raid1','-m','raid1']:['-d','single','-m','dup']),...paths];
 return {type:input.type,disks,filesystem:input.filesystem,label:input.label,profile:input.type==='pool.create'?'raid1':'single',command:argv,
  layout:{wholeDevice:true,partitionsCreated:0,devices:paths,redundant:input.type==='pool.create',capacityEstimateBytes:input.type==='pool.create'?Math.min(Math.floor(disks.reduce((n,d)=>n+d.size,0)/2),disks.reduce((n,d)=>n+d.size,0)-Math.max(...disks.map(d=>d.size))):disks[0].size,capacityIsEstimate:true},
  existingSignatures:disks.map(d=>({diskId:d.id,signatures:d.signatures})),affectedServices:[],dataErased:true,permissionChanges:false,
  warning:'Writes filesystem metadata to the exact disks listed. Undetected data may be destroyed. No automatic mounting or file sharing.',
  rollback:'Filesystem creation is irreversible. Restore user data from an independently verified backup; no automatic rollback is available.',
  confirmation:'INITIALIZE '+disks.map(d=>d.id).join(',')};
}
export class VolumeAdapter {
 constructor(run=command,inspect=async path=>({resolved:await realpath(path),block:(await lstat(path)).isBlockDevice()})){this.run=run;this.inspect=inspect;}
 async validate(impact){for(const d of impact.disks){const actual=await this.inspect(d.path);if(actual.resolved!==d.path||!actual.block)throw Error('Disk path is not an exact physical block device');}}
 async apply(impact){const [bin,...args]=impact.command;const result=await this.run(bin,args,300000);if(!result.ok)throw Error('Filesystem command failed: '+result.stderr);return {stdout:result.stdout,stderr:result.stderr};}
}
