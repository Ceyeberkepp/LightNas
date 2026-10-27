import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile,lstat,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {verifiedMigrationFile} from './migration-transfer.mjs';
import {resolveStoragePool} from './storage-pools.mjs';
// Offline, checksum-verified preservation of an application's complete staged
// backup set. Never deploy or execute an untrusted archive automatically.
const NAME=/^[A-Za-z][A-Za-z0-9_-]{1,47}$/;
const SHA=/^[0-9a-f]{64}$/i;
const KIND=new Set(['application-data','database-backup','configuration-backup','volume']);
function fail(s){throw Object.assign(new Error(s),{status:409});}
export async function preserveVerifiedApplication(input){
 if(!input||typeof input!=='object'||!NAME.test(input.name||'')||
    !/^[A-Za-z0-9_-]{1,48}$/.test(input.pool||'')||
    input.confirm!=='PRESERVE_VERIFIED_APP'||
    !Array.isArray(input.artifacts)||input.artifacts.length===0||input.artifacts.length>64)
  fail('Application, pool, artifacts and explicit preservation confirmation required');
 if(input.databaseConsistencyVerified!==true||input.dependenciesReviewed!==true)
  fail('Consistent database backup and dependency review must be confirmed');
 const ids=new Set(),items=[];
 for(const entry of input.artifacts){
  if(!entry||!KIND.has(entry.kind)||typeof entry.jobId!=='string'||ids.has(entry.jobId)||!SHA.test(entry.sha256))
   fail('Invalid or duplicate application artifact');
  ids.add(entry.jobId);
  const file=verifiedMigrationFile(entry.jobId);
  if(file.sha256.toLowerCase()!==entry.sha256.toLowerCase())fail('Artifact checksum does not match verified stage');
  const stat=await lstat(file.path);
  if(!stat.isFile()||stat.size!==file.size)fail('Staged file changed');
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file.path))hash.update(chunk);
  if(hash.digest('hex').toLowerCase()!==entry.sha256.toLowerCase())fail('Staged artifact corrupted');
  items.push({file,entry});
 }
 if(!items.some(x=>x.entry.kind==='application-data'))fail('Application data archive is missing');
 const pool=await resolveStoragePool(input.pool,'files',true);
 if(pool.remote)fail('App preservation requires a local writable pool');
 const directory=join(pool.root,'files','migration-apps',input.name);
 // Atomic exclusive copy under the application directory: never overwrite
 // a prior preservation set or live app data.
 await mkdir(directory,{recursive:true,mode:0o700});
 const written=[];
 try{
  for(const [index,{entry,file}] of items.entries()){
   const target=join(directory,String(index).padStart(2,'0')+'-'+entry.kind+'.backup');
   await copyFile(file.path,target,1);
   written.push(target);
   const copyHash=createHash('sha256');
   for await(const chunk of createReadStream(target))copyHash.update(chunk);
   if(copyHash.digest('hex').toLowerCase()!==entry.sha256.toLowerCase())fail('Destination copy corrupted');
  }
 }catch(error){
  for(const target of written)await rm(target,{force:true}).catch(()=>{});
  throw error;
 }
 return {name:input.name,pool:input.pool,phase:'preserved-offline',
  artifactCount:items.length,destinationDirectory:directory,
  restoredApplication:false,cutoverAuthorized:false,sourceDeletionAuthorized:false,
  note:'Archives preserved intact. Application runtime, database restore and login tests must run before cutover.'};
}
