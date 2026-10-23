// This module plans an LXC restore without extracting archives or creating containers.
import {inspectVerifiedLxcArchive} from './migration-lxc-preflight.mjs';
import {listStoragePools} from './storage-pools.mjs';
const validName=/^[A-Za-z][A-Za-z0-9-]{1,39}$/;
const validPool=/^[A-Za-z0-9_-]{1,48}$/;
const validNet=/^[A-Za-z0-9_.:-]{1,48}$/;
function reject(message){throw Object.assign(new Error(message),{status:400});}
export function evaluateLxcRestorePlan(input, archive, storage) {
 if(!input||typeof input!=='object'||Array.isArray(input))reject('Invalid restore plan');
 const {name,pool,network,rootfsGiB,memoryMiB,cpus}=input;
 if(!validName.test(name)||!validPool.test(pool)||!validNet.test(network)||
   !Number.isInteger(rootfsGiB)||rootfsGiB<1||rootfsGiB>65536||
   !Number.isInteger(memoryMiB)||memoryMiB<128||memoryMiB>1048576||
   !Number.isInteger(cpus)||cpus<1||cpus>256)reject('Invalid container resources or destination');
 const issues=[];
 const target=(storage.pools||[]).find(x=>x.id===pool);
 if(!target||!target.online||!target.writable||!target.content?.includes('rootdir'))
   issues.push('Selected pool is not an online writable container rootfs pool');
 if(target?.capacityKnown!==false&&Number.isFinite(target?.availableBytes)&&
    target.availableBytes<rootfsGiB*1024**3)
   issues.push('Destination does not have enough reported free space');
 if(!archive?.hasLinuxRootfsMarker)issues.push('Linux root filesystem marker is missing');
 if(!Number.isInteger(archive?.entryCount)||archive.entryCount<1)issues.push('Archive inventory is empty or invalid');
 issues.push('Unprivileged ID mappings, ACLs, xattrs, bind mounts and devices require explicit review');
 issues.push('Container network interface, VLAN and IP mapping require explicit review');
 return {phase:'lxc-restore-plan',readOnly:true,approvedForExecution:false,
   canRestoreAutomatically:false,archiveSha256:archive.archiveSha256||null,
   destination:{name,pool,network,rootfsGiB,memoryMiB,cpus},issues,
   readyForManualReview:issues.length===2};
}
export async function planVerifiedLxcRestore(input,providers={}) {
 if(typeof input?.jobId!=='string')reject('Verified archive job is required');
 const inspect=providers.inspectVerifiedLxcArchive||inspectVerifiedLxcArchive;
 const list=providers.listStoragePools||listStoragePools;
 const [archive,storage]=await Promise.all([inspect(input.jobId),list()]);
 return evaluateLxcRestorePlan(input,archive,storage);
}
