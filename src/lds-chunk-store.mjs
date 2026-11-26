import {createHash,randomUUID} from 'node:crypto';
import {open,mkdir,readFile,readdir,rm,link} from 'node:fs/promises';
import {join} from 'node:path';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function syncDir(p){const f=await open(p,'r');try{await f.sync()}finally{await f.close()}}
/** Experimental immutable local store. Exclusive process ownership required; no quorum or WAL. */
export class LdsChunkStore {
 constructor(root){if(typeof root!=='string'||!root.startsWith('/'))throw new TypeError('absolute storage root required');this.root=root;this.chunks=join(root,'chunks');this.staging=join(root,'staging')}
 async init(){await mkdir(this.chunks,{recursive:true,mode:0o700});await mkdir(this.staging,{recursive:true,mode:0o700});for(const name of await readdir(this.staging)){if(!/^[a-f0-9-]{36}$/.test(name))throw new Error('Unexpected staging entry');await rm(join(this.staging,name),{force:true})}await syncDir(this.staging);await syncDir(this.root);return this}
 async put(data){if(!(data instanceof Uint8Array)||!data.length||data.length>8388608)throw new TypeError('invalid chunk size');const bytes=Buffer.from(data),id=hash(bytes),dest=join(this.chunks,id);try{if(hash(await readFile(dest))!==id)throw new Error('Existing chunk corrupted');await syncDir(this.chunks);return id}catch(e){if(e.code!=='ENOENT')throw e}const temp=join(this.staging,randomUUID());try{const f=await open(temp,'wx',0o600);try{await f.writeFile(bytes);await f.sync()}finally{await f.close()}try{await link(temp,dest)}catch(e){if(e.code!=='EEXIST')throw e}await syncDir(this.chunks);if(hash(await readFile(dest))!==id)throw new Error('Published chunk checksum mismatch');return id}finally{await rm(temp,{force:true});await syncDir(this.staging)}}
 async get(id){if(typeof id!=='string'||!/^[0-9a-f]{64}$/.test(id))throw new TypeError('invalid chunk ID');const b=await readFile(join(this.chunks,id));if(hash(b)!==id)throw new Error('Chunk checksum mismatch');return b}
}
