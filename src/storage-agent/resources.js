import {readFile,realpath,lstat,readdir,mkdir,rmdir,chmod,chown,statfs,open,unlink,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,resolve,basename} from 'node:path';
import {digest,command} from './storage.js';
import {atomic} from './persistence.js';
import {ProviderAdapter} from './providers.js';
import {STORAGE_PROVIDERS,providerDefinition} from '../../public/storage-providers.js';
const directories={iso:'template/iso',vztmpl:'template/cache',images:'images',rootdir:'rootdir',backup:'dump',snippets:'snippets',files:'files'};
const defaults=Object.keys(directories);
export const RESOURCE_TYPES=['pool.definition.create','pool.definition.update','pool.definition.delete','space.create','space.update','space.delete'];
const decode=s=>s.replace(/\\([0-7]{3})/g,(_,n)=>String.fromCharCode(parseInt(n,8)));
export function mountedSourceId(device,path){return /^\/mnt\/lightnas\/[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(path)?'lightnas-mount:'+path.split('/').at(-1):Buffer.from(device+':'+path).toString('base64url');}
export async function mountedSources({mountsFile="/proc/self/mounts",inspect=statfs,directoryInfo=lstat}={}){
 const text=await readFile(mountsFile,'utf8');const seen=new Set(),sources=[];
 for(const line of text.trim().split('\n')){const [rawDevice,rawPath,type,options]=line.split(' ');const path=decode(rawPath||''),device=decode(rawDevice||'');
  if(!/^\/(storage|mnt|media|srv|data)(\/|$)/.test(path)||/^\/mnt\/wsl(?:g)?(\/|$)/.test(path)||seen.has(path))continue;seen.add(path);
  let size=null;try{if(!(await directoryInfo(path)).isDirectory())continue;const st=await inspect(path,{bigint:true});size=Number(st.blocks*st.bsize);}catch{continue;}
  sources.push({id:mountedSourceId(device,path),legacyId:Buffer.from(device+':'+path).toString('base64url'),path,device,type,readOnly:options.split(',').includes('ro'),size,providerHints:Object.fromEntries(options.split(',').filter(option=>/^(name|mds_namespace|fs|fsid)=/.test(option)).map(option=>{const index=option.indexOf('=');return [option.slice(0,index),option.slice(index+1)];}))});
 }return sources;
}
async function json(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return structuredClone(fallback);throw e;}}
function contents(value){if(!Array.isArray(value)||!value.length||value.some(v=>!Object.hasOwn(directories,v)))throw Error('Select valid storage content types');return [...new Set(value)].sort();}
export class ResourceAdapter{
 constructor({dataDir=dirname(resolve(process.env.NAS_DATA_FILE||'/var/lib/lightnas/state.json')),sources=mountedSources,providers=new ProviderAdapter(),canUse=async path=>{for(const flag of ['-r','-w','-x'])if(!(await command('/usr/sbin/runuser',['-u','lightnas','--','/usr/bin/test',flag,path])).ok)return false;return true;},canTraverse=async path=>(await command('/usr/sbin/runuser',['-u','lightnas','--','/usr/bin/test','-x',path])).ok}={}){this.dataDir=dataDir;this.sources=sources;this.providers=providers;this.canUse=canUse;this.canTraverse=canTraverse;}
 configPath(type){return type.startsWith('pool.')?resolve(process.env.LIGHTNAS_STORAGE_CONFIG||join(this.dataDir,'storage-pools.json')):join(this.dataDir,'storage-spaces.json');}
 async creationOptions(){const config=await this.snapshot('pool.definition.create');const sources=await this.sources();return {providers:STORAGE_PROVIDERS.map(provider=>provider.id),sources:sources.map(source=>({...source,configured:config.pools.some(pool=>(pool.sourceId===source.id||pool.sourceId===source.legacyId))}))};}
 async shareRoots(){const config=await this.snapshot('pool.definition.create');const sources=await this.sources();return ['/srv/lightnas',...config.pools.filter(p=>p.content?.includes('files')&&sources.some(s=>(s.id===p.sourceId||s.legacyId===p.sourceId)&&p.root===join(s.path,'.lightnas','storage',p.id))).map(p=>join(p.root,'files'))];}
 async snapshot(type){if(type.startsWith('pool.'))return json(this.configPath(type),{version:1,localContent:defaults,pools:[]});const state=await json(join(this.dataDir,'state.json'),{});return json(this.configPath(type),state.spaces||[]);}
 async plan(input){
  if(!RESOURCE_TYPES.includes(input.type))throw Error('Unsupported resource mutation');
  const allowed=input.type==='pool.definition.create'?['type','name','sourceId','content','provider','providerConfig','connect','private']:input.type==='pool.definition.update'?['type','id','content']:input.type==='pool.definition.delete'?['type','id']:input.type==='space.delete'?['type','name']:['type','name','label'];if(Object.keys(input).some(key=>!allowed.includes(key)))throw Error('Unexpected storage operation fields');
  if(input.connect!==undefined&&typeof input.connect!=='boolean')throw Error('Connection mode must be a boolean');
  const configurationFile=this.configPath(input.type);await access(dirname(configurationFile),constants.W_OK);let configurationBefore={exists:false};try{const info=await lstat(configurationFile);if(!info.isFile()||info.isSymbolicLink())throw Error('Configuration registry must be a regular file');configurationBefore={exists:true,mode:info.mode&0o777,uid:info.uid,gid:info.gid,ino:info.ino};}catch(e){if(e.code!=='ENOENT')throw e;}
  const before=await this.snapshot(input.type),after=structuredClone(before),created=[],removed=[],removedDirectoryState=[];let source=null,result,providerConnection=null,remoteConnection=null,providerIdentity=null;
  if(input.type.startsWith('pool.')){
   const id=String(input.id||input.name||'');if(!/^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(id))throw Error('Invalid pool definition name');
   const index=after.pools.findIndex(p=>p.id===id);
   if(input.type==='pool.definition.create'){
    if(id.toLowerCase()==='local'||after.pools.some(p=>p.id.toLowerCase()===id.toLowerCase()))throw Error('Pool definition name is reserved or already exists');
    const provider=input.provider||'directory',definition=providerDefinition(provider);
    let providerConfig=input.providerConfig||{};
    const content=contents(input.content||definition.content||['iso','vztmpl','images','rootdir','backup']);
    if(definition.content&&content.some(type=>!definition.content.includes(type)))throw Error('Select content supported by '+definition.label);
    if(definition.remote){
     await this.safeAncestors(join(this.providers.dir,'provider-credentials',id+'.json'));
     remoteConnection=await this.providers.remotePlan(provider,id,providerConfig,input.private?.credentials);
     providerConfig=remoteConnection.config;providerIdentity=remoteConnection.identity;
    }else if(input.connect===true){
     providerConnection=await this.providers.connectionPlan(provider,id,providerConfig,input.private?.credentials);
     await this.safeAncestors(providerConnection.path);await this.safeAncestors(providerConnection.unitPath);if(providerConnection.credentialFile)await this.safeAncestors(providerConnection.credentialFile);
     source={id:mountedSourceId(providerConnection.device,providerConnection.path),path:providerConnection.path,device:providerConnection.device,type:providerConnection.fsType,readOnly:false,size:null};providerConfig=providerConnection.config;
    }else{
     if(input.private&&Object.keys(input.private).length)throw Error('Credentials belong only to new connections; existing mounts keep their host-managed authentication');
     source=(await this.sources()).find(s=>(s.id===input.sourceId||s.legacyId===input.sourceId));if(!source||source.readOnly)throw Error('Select a currently mounted writable data source');
     const checked=await this.providers.describe(provider,source,providerConfig);providerConfig=checked.config;providerIdentity=checked.identity;
    }
    if(source&&after.pools.some(p=>(p.sourceId===source.id||p.sourceId===source.legacyId)))throw Error('Source already has a pool definition');
    const root=source?join(source.path,'.lightnas','storage',id):null;
    const pool={id,name:id,sourceId:source?.id||'remote:'+id,mountPoint:source?.path||null,root,content,provider,providerConfig,preparedByHostAgent:true,...(definition.remote?{remote:true}:{}),...(providerConnection?{managedMount:providerConnection.unitName}:{})};
    after.pools.push(pool);if(root)created.push(root,...content.map(t=>join(root,directories[t])));result={pool};
   }else if(input.type==='pool.definition.update'){
    const content=contents(input.content);
    if(id==='local'){after.localContent=content;const root=join(this.dataDir,'storage','local');created.push(root,...content.map(t=>join(root,directories[t])));result={pool:{id,name:id,root,content}};}
    else{if(index<0)throw Error('Pool definition not found');const pool=after.pools[index];if(pool.remote){if(content.some(type=>!providerDefinition(pool.provider).content.includes(type)))throw Error('Invalid remote provider content policy');pool.content=content;result={pool};}else{source=(await this.sources()).find(s=>(s.id===pool.sourceId||s.legacyId===pool.sourceId));if(!source||source.readOnly||pool.root!==join(source.path,'.lightnas','storage',id))throw Error('Pool is offline or has an invalid managed directory');pool.content=content;created.push(...content.map(t=>join(pool.root,directories[t])));result={pool};}}
   }else{if(id==='local'||index<0)throw Error('Pool definition is permanent or does not exist');after.pools.splice(index,1);result={id,removed:true,filesPreserved:true};}
  }else{
   const name=String(input.name||'');if(!/^[a-zA-Z0-9_-]{2,40}$/.test(name))throw Error('Invalid storage space name');
   const index=after.findIndex(s=>s.name===name),path=join(this.dataDir,'files','Spaces',name);
   if(input.type==='space.delete'){if(index<0)throw Error('Space does not exist');await this.existingDirectory(path);if((await readdir(path)).length)throw Error('Storage space must be empty');after.splice(index,1);removed.push(path);const info=await lstat(path);removedDirectoryState.push({path,mode:info.mode&0o777,uid:info.uid,gid:info.gid,ino:info.ino});result={ok:true};}
   else{const label=String(input.label||'').trim();if(!label||label.length>80)throw Error('Space label is required and must be at most 80 characters');
    if(input.type==='space.create'){if(after.some(s=>s.name.toLowerCase()===name.toLowerCase()))throw Error('Space already exists');const space={name,label};after.push(space);created.push(path);result={space};}
    else{if(index<0)throw Error('Space does not exist');after[index].label=label;result={space:after[index]};}}
  }
  const expanded=new Set();for(const leaf of created){let path=leaf;const missing=[];while(path!=='/'){try{await this.existingDirectory(path);if(!await this.canTraverse(path))throw Error('Grant the LightNAS service account traversal access to '+path+' before registering this storage');break;}catch(e){if(e.code!=='ENOENT')throw e;missing.unshift(path);}path=dirname(path);}for(const directory of missing)expanded.add(directory);expanded.add(leaf);}
  const directoryState=[];for(const path of expanded){await this.safeAncestors(path);try{await this.existingDirectory(path);directoryState.push({path,exists:true});}catch(e){if(e.code!=='ENOENT')throw e;directoryState.push({path,exists:false});}}
  return {type:input.type,providerConnection,remoteConnection,providerIdentity,configurationFile,configurationBefore,configurationAfter:{owner:'root:lightnas',mode:'0640'},input:structuredClone(input),before,after,source,directoryState,removeEmptyDirectories:removed,removedDirectoryState,result,dataErased:false,permissionChanges:directoryState.some(d=>!d.exists)||!configurationBefore.exists||configurationBefore.mode!==0o640||configurationBefore.uid!==0||configurationBefore.gid!==process.getgid(),newDirectoryMode:'0770',newDirectoryOwner:'root:lightnas',affectedServices:providerConnection?[providerConnection.unitName]:[],warning:providerConnection?'Connects the specified remote filesystem, enables its managed mount at boot, and creates LightNAS content directories. Existing files are preserved.':remoteConnection?'Authenticates the named native remote datastore and stores its connection credentials in a root-only file. Does not format or write the remote datastore.':'Changes storage definitions and managed directories only. Existing files are preserved.',rollback:'Restore the previous definition. Remove newly created directories only while empty; populated directories are preserved.'};
 }
 async existingDirectory(path){if(await realpath(path)!==path||!(await lstat(path)).isDirectory())throw Error('Managed path must be a directory without symlink traversal');}
 async safeAncestors(path){let current=path;while(current!=='/'){try{const st=await lstat(current);if(st.isSymbolicLink()||!st.isDirectory())throw Error('Symlink or non-directory in managed path');}catch(e){if(e.code!=='ENOENT')throw e;}current=dirname(current);}}
 async validate(impact){const current=await this.plan(impact.input);if(digest(current)!==digest(impact))throw Error('Resource configuration, mount or directory changed; request a new preview');}
 async anchoredDirectory(path,{create=false,created=[],onCreated=async()=>{}}={}){
  let handle=await open('/',constants.O_RDONLY|constants.O_DIRECTORY);
  try{for(const part of path.split('/').filter(Boolean)){
   if(part==='.'||part==='..')throw Error('Invalid directory component');
   const anchored='/proc/self/fd/'+handle.fd+'/'+part;let made=false;
   if(create){try{await mkdir(anchored,{mode:0o770});made=true;}catch(e){if(e.code!=='EEXIST')throw e;}}
   const next=await open(anchored,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);let actual;if(made){actual=await realpath('/proc/self/fd/'+next.fd);created.push(actual);try{await handle.sync();}catch(error){await next.close();throw error;}}await handle.close();handle=next;
   if(made){await handle.chmod(0o770);if(process.getuid?.()===0){try{await handle.chown(0,process.getgid());}catch(error){if(!this.networkSource||!['EPERM','EACCES'].includes(error.code)||!await this.canUse(actual))throw error;}}await handle.sync();await onCreated(actual);}
  }return handle;}catch(e){await handle.close();throw e;}
 }
 async ensureDirectory(path,created,onCreated){const handle=await this.anchoredDirectory(path,{create:true,created,onCreated});await handle.close();}
 async removeEmpty(path){const parent=await this.anchoredDirectory(dirname(path));try{await rmdir('/proc/self/fd/'+parent.fd+'/'+basename(path));}finally{await parent.close();}}
 async write(type,value){const path=this.configPath(type);await atomic(path,JSON.stringify(value,null,2)+'\n');await chmod(path,0o640);}
 async apply(impact,onCreated=async()=>{}){
  this.created=[];this.connected=false;this.remoteSaved=false;this.networkSource=['nfs','nfs4','cifs','smb3','glusterfs','fuse.glusterfs','ceph','fuse.ceph','fuse.ceph-fuse'].includes(impact.source?.type);
  if(impact.providerConnection){this.connected=true;await this.providers.connect(impact.providerConnection);const current=(await this.sources()).find(source=>source.path===impact.source.path&&source.type===impact.source.type&&!source.readOnly);if(!current)throw Error('New provider mount was not verified');if(!await this.canTraverse(current.path))throw Error('Grant LightNAS access on the remote server before connecting this storage');}
  if(impact.remoteConnection){await this.providers.saveRemote(impact.remoteConnection);this.remoteSaved=true;}
  for(const d of impact.directoryState)if(!d.exists)await this.ensureDirectory(d.path,this.created,onCreated);for(const path of impact.removeEmptyDirectories)await this.removeEmpty(path);await this.write(impact.type,impact.after);return impact.result;
 }
 async rollback(impact){if(impact.configurationBefore.exists){await this.write(impact.type,impact.before);const file=await open(impact.configurationFile,constants.O_RDONLY|constants.O_NOFOLLOW);try{await file.chmod(impact.configurationBefore.mode);if(process.getuid?.()===0)await file.chown(impact.configurationBefore.uid,impact.configurationBefore.gid);}finally{await file.close();}}else{await unlink(impact.configurationFile).catch(e=>{if(e.code!=='ENOENT')throw e;});}for(const original of impact.removedDirectoryState){await this.ensureDirectory(original.path,[]);const handle=await this.anchoredDirectory(original.path);try{await handle.chmod(original.mode);if(process.getuid?.()===0)await handle.chown(original.uid,original.gid);}finally{await handle.close();}}const retained=[];for(const path of [...(this.created||[])].reverse()){try{await this.removeEmpty(path);}catch(e){if(e.code!=='ENOTEMPTY'&&e.code!=='ENOENT')throw e;if(e.code==='ENOTEMPTY')retained.push(path);}}if(this.connected){if(retained.length)throw Error('Remote content directories now contain data; managed mount retained for inspection');await this.providers.disconnect(impact.providerConnection);}if(this.remoteSaved)await unlink(join(this.providers.dir,'provider-credentials',impact.remoteConnection.name+'.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});return {retainedDirectories:retained};}
}
