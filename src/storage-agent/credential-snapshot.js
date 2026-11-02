import {constants} from 'node:fs';
import {lstat,mkdtemp,open,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './storage.js';

// A preflight hash alone does not pin the bytes a later subprocess opens.
// Capture verified credentials into a private, per-run directory and execute
// against those copies. A rotation of the original files cannot redirect an
// already approved backup to another remote or SSH identity.
async function readOwnedSecret(path){
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const st=await handle.stat();
  if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid()||(st.mode&0o077)!==0||st.size>1024*1024)
   throw Error('Backup credential file ownership, permissions or size are unsafe');
  return await handle.readFile('utf8');
 }finally{await handle.close();}
}
export async function pinBackupCredentials({directory,kind,expected,profile}){
 if(kind!=='cloud'&&kind!=='replication')return null;
 const root=await lstat(directory);
 if(!root.isDirectory()||root.isSymbolicLink()||root.uid!==process.getuid()||(root.mode&0o077)!==0)
  throw Error('Backup credential directory must be private and owned by the service');
 const source=kind==='cloud'?[['rclone.conf','cloud']]:[[profile+'.key','key'],[profile+'.known_hosts','hostKey']];
 if(kind==='cloud'&&(typeof expected!=='string'||!expected))
  throw Error('Cloud backup credential identity missing; request another preview');
 if(kind==='replication'&&(!/^[A-Za-z][A-Za-z0-9_-]{1,47}$/.test(profile||'')||
    !expected||typeof expected.key!=='string'||!expected.key||
    typeof expected.hostKey!=='string'||!expected.hostKey))
  throw Error('Replication credential identity missing or invalid; request another preview');
 const values=[];
 for(const [filename,field] of source){
  const bytes=await readOwnedSecret(join(directory,filename));
  if(digest(bytes)!==(kind==='cloud'?expected:expected[field]))
   throw Error(kind==='cloud'?'Cloud backup credentials changed since preview; refusing to run':'Replication SSH identity changed since preview; refusing to run');
  values.push([filename,bytes]);
 }
 const staging=await mkdtemp(join(directory,'.credential-run-'));
 try{
  const paths=new Map();
  for(const [filename,bytes] of values){
   const target=join(staging,filename);
   await writeFile(target,bytes,{flag:'wx',mode:0o600});
   paths.set(join(directory,filename),target);
  }
  const rewrite=args=>args.map(arg=>{
   if(typeof arg!=='string')return arg;
   if(paths.has(arg))return paths.get(arg);
   if(arg.startsWith('UserKnownHostsFile=')){
    const original=arg.slice('UserKnownHostsFile='.length);
    if(paths.has(original))return 'UserKnownHostsFile='+paths.get(original);
   }
   return arg;
  });
  return {rewrite,paths,cleanup:()=>rm(staging,{recursive:true,force:true})};
 }catch(error){await rm(staging,{recursive:true,force:true});throw error;}
}
