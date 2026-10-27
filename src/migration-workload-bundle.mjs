import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat} from 'node:fs/promises';
import {verifiedMigrationFile} from './migration-transfer.mjs';
import {reviewGuestDependencies} from './migration-guest-dependencies.mjs';
// Verifies every staged workload artifact byte-for-byte. Does not execute cutover.
const SHA=/^[a-f0-9]{64}$/i;
const KINDS=new Set(['vm-disk','container-rootfs','volume','database-backup','application-data','configuration-backup']);
function reject(message){throw Object.assign(new Error(message),{status:409});}
export async function verifyWorkloadTransferBundle(input){
 if(!input||typeof input!=='object'||!['proxmox','truenas','vmware','redhat'].includes(input.source)||
    !['vm','container','app'].includes(input.type)||!Array.isArray(input.artifacts)||
    input.artifacts.length===0||input.artifacts.length>128)reject('Invalid workload artifact manifest');
 const review=reviewGuestDependencies(input);
 if(!review.allDependenciesVerified)reject('Workload dependencies or coverage are incomplete: '+review.blockers.join(', '));
 const ids=new Set(), verified=[];
 for(const artifact of input.artifacts){
  if(!artifact||!KINDS.has(artifact.kind)||typeof artifact.jobId!=='string'||
     !/^[a-zA-Z0-9_-]{1,100}$/.test(artifact.jobId)||ids.has(artifact.jobId)||
     !SHA.test(artifact.sha256))reject('Invalid or duplicate staged artifact');
  ids.add(artifact.jobId);
  const file=verifiedMigrationFile(artifact.jobId);
  const actual=await lstat(file.path);
  if(!actual.isFile()||actual.size!==file.size||file.sha256.toLowerCase()!==artifact.sha256.toLowerCase())
    reject('Staged artifact metadata mismatch: '+artifact.jobId);
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file.path))hash.update(chunk);
  if(hash.digest('hex').toLowerCase()!==artifact.sha256.toLowerCase())
    reject('Staged artifact content checksum mismatch: '+artifact.jobId);
  verified.push({jobId:artifact.jobId,kind:artifact.kind,size:actual.size,sha256:artifact.sha256.toLowerCase(),verified:true});
 }
 if(input.type==='vm'&&!verified.some(a=>a.kind==='vm-disk'))reject('VM disk artifact missing');
 if(input.type==='container'&&!verified.some(a=>a.kind==='container-rootfs'))reject('Container root filesystem artifact missing');
 if(input.type==='app'&&!verified.some(a=>a.kind==='application-data'))reject('Application persistent data artifact missing');
 return {phase:'staged-workload-integrity',source:input.source,type:input.type,
   artifactCount:verified.length,artifacts:verified,dependenciesReviewed:true,
   transferComplete:false,destinationRestoreVerified:false,cutoverAuthorized:false,
   sourceDeletionAuthorized:false,note:'Verified staged files are not proof of complete restoration or application functionality.'};
}
