/**
 * Linux mountinfo-backed rsync source/destination isolation.
 *
 * Device/inode equality detects identical directory bind mounts, but misses a
 * bind mount of a *descendant* of the source, or a mount nested within the
 * destination. /proc/self/mountinfo supplies the filesystem-relative root of
 * each mount, so paths can be compared in the same backing filesystem.
 *
 * This is a safety check, not a claim of race-free filesystem transactions:
 * mounts can still change between this check and exec. Production backup and
 * restore remain unqualified until isolated host failure-injection evidence.
 */
import {posix} from 'node:path';

const within=(path,parent)=>parent==='/'?path.startsWith('/'):
  path===parent||path.startsWith(parent+'/');

function decodeMountField(field){
  if(typeof field!=='string'||/\\(?![0-7]{3})/.test(field))
    throw Error('Cannot safely decode Linux mount topology');
  return field.replace(/\\([0-7]{3})/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)));
}

function absolutePath(field){
  const decoded=decodeMountField(field);
  if(!decoded.startsWith('/')||decoded.includes('\0')||decoded.includes('\n')||
     posix.normalize(decoded)!==decoded)
    throw Error('Invalid path in Linux mount topology');
  return decoded;
}

export function parseMountInfo(content){
  if(typeof content!=='string'||!content.trim())
    throw Error('Linux mount topology is unavailable; refusing rsync');
  const mounts=[];
  for(const line of content.trimEnd().split('\n')){
    const separator=line.indexOf(' - ');
    if(separator<0)throw Error('Malformed Linux mount topology; refusing rsync');
    const fields=line.slice(0,separator).trim().split(/\s+/);
    if(fields.length<6||!/^\d+$/.test(fields[0])||
       !/^\d+$/.test(fields[1])||!/^\d+:\d+$/.test(fields[2]))
      throw Error('Malformed Linux mount topology; refusing rsync');
    mounts.push({
      id:Number(fields[0]),
      device:fields[2],
      root:absolutePath(fields[3]),
      point:absolutePath(fields[4])
    });
  }
  return mounts;
}

function backing(path,mounts){
  let best;
  for(const mount of mounts){
    if(within(path,mount.point)&&
       (!best||mount.point.length>=best.point.length))best=mount;
  }
  if(!best)throw Error('Cannot resolve backup path in Linux mount topology');
  const relative=posix.relative(best.point,path);
  return {device:best.device,path:posix.resolve(best.root,relative)};
}

function views(path,mounts){
  const result=[backing(path,mounts)];
  for(const mount of mounts){
    if(mount.point!==path&&within(mount.point,path))
      result.push({device:mount.device,path:mount.root});
  }
  return result;
}

/**
 * Reject all overlapping backing trees, including nested mountpoints that
 * would be traversed by rsync --delete. Return relevant mount identities for
 * comparison with the approved preview at execution time.
 */
export function assertSeparateRsyncTrees(source,target,mountInfo){
  if(typeof source!=='string'||typeof target!=='string'||
     !source.startsWith('/')||!target.startsWith('/')||
     posix.normalize(source)!==source||posix.normalize(target)!==target)
    throw Error('Backup paths must be canonical absolute directories');
  const mounts=parseMountInfo(mountInfo);
  const sourceViews=views(source,mounts);
  const targetViews=views(target,mounts);
  for(const a of sourceViews)for(const b of targetViews){
    if(a.device===b.device&&(within(a.path,b.path)||within(b.path,a.path)))
      throw Error('Backup source and destination overlap through a bind mount or nested mount; refusing rsync');
  }
  const relevant=mounts.filter(m=>
    within(source,m.point)||within(m.point,source)||
    within(target,m.point)||within(m.point,target)
  ).map(m=>({id:m.id,device:m.device,root:m.root,point:m.point}));
  return {source,target,mounts:relevant};
}
