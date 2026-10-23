// Offset-resumable local migration staging: data is never activated before final hash verification.
import {open,mkdir,rename,rm,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,resolve,sep} from 'node:path';
import {createReadStream} from 'node:fs';
const ROOT=resolve(process.env.LIGHTNAS_MIGRATION_RESUME_DIR || '/var/lib/lightnas/imports/resumable');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST=/^[0-9a-f]{64}$/i;
const jobs=new Map();
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function paths(id){if(!UUID.test(id))fail('Invalid transfer ID');return {part:resolve(ROOT,id+'.part'),done:resolve(ROOT,id+'.verified')};}
export function createResumableImport({name,size,sha256}){
 if(typeof name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/.test(name)||!/\.(?:qcow2|raw|img|vmdk|tar|gz|xz|zst|json|xml)$/i.test(name))fail('Invalid transfer name');
 if(!Number.isSafeInteger(size)||size<=0||size>2**50||!DIGEST.test(sha256))fail('Invalid size or SHA-256');
 if(jobs.size>=128)fail('Too many active transfers',503);
 const id=randomUUID();const job={id,name,size,sha256:sha256.toLowerCase(),offset:0,state:'receiving'};jobs.set(id,job);
 return {id,name,size,offset:0,state:job.state};
}
export function resumableImportStatus(id){const j=jobs.get(id);if(!j)fail('Transfer not found',404);return {id:j.id,name:j.name,size:j.size,offset:j.offset,state:j.state};}
export async function appendResumableChunk(id,offset,chunk){
 const j=jobs.get(id);if(!j)fail('Transfer not found',404);
 if(j.state!=='receiving')fail('Transfer is not receiving',409);
 if(!Number.isSafeInteger(offset)||offset!==j.offset)fail('Chunk offset mismatch',409);
 if(!Buffer.isBuffer(chunk)||!chunk.length||chunk.length>8*1024*1024||offset+chunk.length>j.size)fail('Invalid chunk');
 await mkdir(ROOT,{recursive:true,mode:0o700});
 const {part}=paths(id);
 const fd=await open(part,j.offset===0?'wx':'r+');
 try { const current=await fd.stat();if(!current.isFile()||current.size!==offset)fail('Staging size mismatch',409);
  await fd.writeFile(chunk);await fd.sync();
 }finally{await fd.close();}
 j.offset+=chunk.length;return resumableImportStatus(id);
}
export async function finalizeResumableImport(id){
 const j=jobs.get(id);if(!j)fail('Transfer not found',404);
 if(j.state!=='receiving'||j.offset!==j.size)fail('Transfer incomplete',409);
 const {part,done}=paths(id);j.state='verifying';
 try {
  const st=await stat(part);if(!st.isFile()||st.size!==j.size)fail('Unexpected staging length',409);
  const hash=createHash('sha256');for await(const piece of createReadStream(part))hash.update(piece);
  if(hash.digest('hex')!==j.sha256)fail('Transfer checksum mismatch',409);
  await rename(part,done);j.state='verified';
  return { ...resumableImportStatus(id),sha256:j.sha256,verified:true };
 }catch(e){j.state='failed';await rm(part,{force:true}).catch(()=>{});throw e;}
}
export async function cancelResumableImport(id){
 const j=jobs.get(id);if(!j)fail('Transfer not found',404);
 if(j.state==='verified')fail('Verified transfer cannot be canceled',409);
 await rm(paths(id).part,{force:true});jobs.delete(id);return {id,canceled:true};
}
