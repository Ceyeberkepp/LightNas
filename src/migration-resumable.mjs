// Offset-resumable local migration staging: data is never activated before final hash verification.
import {open,mkdir,rename,rm,stat,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createReadStream} from 'node:fs';
const ROOT=resolve(process.env.LIGHTNAS_MIGRATION_RESUME_DIR || '/var/lib/lightnas/imports/resumable');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST=/^[0-9a-f]{64}$/i;
const jobs=new Map();
const locks=new Set();
function receiptPath(id){paths(id);return resolve(ROOT,id+'.json');}
async function persist(job){
 const record=JSON.stringify({id:job.id,name:job.name,size:job.size,sha256:job.sha256,offset:job.offset,state:job.state});
 const temp=receiptPath(job.id)+'.tmp';
 await writeFile(temp,record,{mode:0o600,flag:'w'});
 await rename(temp,receiptPath(job.id));
}
export async function recoverResumableImports(){
 await mkdir(ROOT,{recursive:true,mode:0o700});
 const names=await readdir(ROOT);
 const recovered=[];
 for(const name of names){
  if(!/^[0-9a-f-]{36}\.json$/i.test(name))continue;
  const id=name.slice(0,-5);if(!UUID.test(id))continue;
  try {
   const j=JSON.parse(await readFile(receiptPath(id),'utf8'));
   if(j.id!==id||typeof j.name!=='string'||!Number.isSafeInteger(j.size)||j.size<=0||!DIGEST.test(j.sha256)||
      !Number.isSafeInteger(j.offset)||j.offset<0||j.offset>j.size||!['receiving','verifying','verified'].includes(j.state))continue;
   const path=j.state==='verified'?paths(id).done:paths(id).part;
   if(j.offset===0 && j.state!=='verified') { jobs.set(id,j);recovered.push(resumableImportStatus(id));continue; }
   const info=await stat(path);
   if(!info.isFile()||info.size<j.offset)continue;
   if(j.state!=='verified'&&info.size>j.offset){
     const fd=await open(path,'r+');try{await fd.truncate(j.offset);await fd.sync();}finally{await fd.close();}
   }
   if(j.state==='verified'&&info.size!==j.offset)continue;
   if(j.state==='verified'){
     const hash=createHash('sha256');for await(const piece of createReadStream(path))hash.update(piece);
     if(hash.digest('hex')!==j.sha256)continue;
   }else j.state='receiving';
   jobs.set(id,j);recovered.push(resumableImportStatus(id));
  }catch{}
 }
 return recovered;
}
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function paths(id){if(!UUID.test(id))fail('Invalid transfer ID');return {part:resolve(ROOT,id+'.part'),done:resolve(ROOT,id+'.verified')};}
export async function createResumableImport({name,size,sha256}){
 if(typeof name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/.test(name)||!/\.(?:qcow2|raw|img|vmdk|tar|gz|xz|zst|json|xml)$/i.test(name))fail('Invalid transfer name');
 if(!Number.isSafeInteger(size)||size<=0||size>2**50||!DIGEST.test(sha256))fail('Invalid size or SHA-256');
 if(jobs.size>=128)fail('Too many active transfers',503);
 const id=randomUUID();const job={id,name,size,sha256:sha256.toLowerCase(),offset:0,state:'receiving'};jobs.set(id,job);
 try {
  await mkdir(ROOT,{recursive:true,mode:0o700});
  await persist(job);
 } catch (error) {
  jobs.delete(id);
  await rm(receiptPath(id)+'.tmp',{force:true}).catch(()=>{});
  throw error;
 }
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
 if(locks.has(id))fail('Transfer is busy',409);
 locks.add(id);
 let fd;
 try { fd=await open(part,j.offset===0?'wx':'r+');
 try { const current=await fd.stat();if(!current.isFile()||current.size!==offset)fail('Staging size mismatch',409);
  let written=0;
  while(written<chunk.length){const n=await fd.write(chunk,written,chunk.length-written,offset+written);if(n.bytesWritten<=0)fail('Short write',503);written+=n.bytesWritten;}
  await fd.sync();
 }finally{await fd?.close();}
 j.offset+=chunk.length;
 await persist(j);
 return resumableImportStatus(id);
 } finally { locks.delete(id); }
}
export async function finalizeResumableImport(id){
 const j=jobs.get(id);if(!j)fail('Transfer not found',404);
 if(j.state!=='receiving'||j.offset!==j.size)fail('Transfer incomplete',409);
 if(locks.has(id))fail('Transfer is busy',409);
 locks.add(id);
 const {part,done}=paths(id);j.state='verifying';
 try {
  const st=await stat(part);if(!st.isFile()||st.size!==j.size)fail('Unexpected staging length',409);
  const hash=createHash('sha256');for await(const piece of createReadStream(part))hash.update(piece);
  if(hash.digest('hex')!==j.sha256)fail('Transfer checksum mismatch',409);
  await rename(part,done);j.state='verified';await persist(j);
  return { ...resumableImportStatus(id),sha256:j.sha256,verified:true };
 }catch(e){j.state='failed';await rm(part,{force:true}).catch(()=>{});await rm(receiptPath(id),{force:true}).catch(()=>{});throw e;}finally{locks.delete(id);}
}
export async function cancelResumableImport(id){
 const j=jobs.get(id);if(!j)fail('Transfer not found',404);
 if(j.state==='verified')fail('Verified transfer cannot be canceled',409);
 if(locks.has(id))fail('Transfer is busy',409);
 await rm(paths(id).part,{force:true});await rm(receiptPath(id),{force:true});jobs.delete(id);return {id,canceled:true};
}

export async function verifiedResumableImport(id) {
 const j=jobs.get(id);if(!j || j.state!=='verified')fail('A verified transfer is required',409);
 const path=paths(id).done;
 const fd=await open(path,'r');
 try {
  const info=await fd.stat();
  if(!info.isFile()||info.size!==j.size)fail('Verified transfer size has changed',409);
  const hash=createHash('sha256');
  for await(const piece of fd.createReadStream({autoClose:false}))hash.update(piece);
  if(hash.digest('hex')!==j.sha256)fail('Verified transfer checksum has changed',409);
  return {path,name:j.name,size:j.size,sha256:j.sha256};
 } finally {await fd.close();}
}
