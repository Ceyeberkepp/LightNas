import http from 'node:http';
import {readFile} from 'node:fs/promises';
const namespace='/api/storage/agent';
export function storageAgentRoute(path,method){
 if(!path.startsWith(namespace+'/'))return false;
 const suffix=path.slice(namespace.length);
 if(method==='GET')return /^\/(inventory|creation-options|remote-storage|kubernetes|jobs|shares|features|protection|dataset|csr)$/.test(suffix)||/^\/jobs\/[0-9a-f-]{36}(\/(events|stream))?$/.test(suffix);
 return method==='POST'&&(suffix==='/preview'||/^\/jobs\/[0-9a-f-]{36}\/(approve|cancel|rollback-preview)$/.test(suffix));
}
export async function forwardStorageAgent(req,res,url,input){
 let token;try{token=(await readFile(process.env.LIGHTNAS_STORAGE_AGENT_TOKEN_FILE||'/etc/lightnas/storage-agent.token','utf8')).trim();}catch{throw Object.assign(new Error('Storage operation agent is not installed. Run the updated LightNAS installer.'),{status:503});}
 if(token.length<32)throw Object.assign(new Error('Storage agent credential is invalid.'),{status:503});
 const path='/v1'+url.pathname.slice(namespace.length)+url.search;
 return new Promise((resolve,reject)=>{
  const upstream=http.request({socketPath:process.env.LIGHTNAS_STORAGE_AGENT_SOCKET||'/run/lightnas-storage/storage.sock',path,method:req.method,headers:{authorization:'Bearer '+token,'content-type':'application/json',...(req.headers['last-event-id']?{'last-event-id':req.headers['last-event-id']}:{})}},response=>{
   res.writeHead(response.statusCode,{'Content-Type':response.headers['content-type']||'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(response.headers['content-type']==='text/event-stream'?{'X-Accel-Buffering':'no'}:{})});
   response.on('error',error=>{res.destroy(error);resolve();});response.pipe(res);response.on('end',resolve);
  });
  upstream.setTimeout(120000,()=>upstream.destroy(new Error('Storage agent timed out')));
  upstream.on('error',error=>{if(res.headersSent){res.end();resolve();}else reject(Object.assign(new Error('Storage agent unavailable: '+error.message),{status:503}));});
  res.on('close',()=>{upstream.destroy();resolve();});
  upstream.end(input===undefined?undefined:JSON.stringify(input));
 });
}

export function classifyStorageMutation(path,method,input={}){
 if(!['POST','PATCH','DELETE'].includes(method))return null;
 if(path==='/api/storage/pools'&&method==='POST')return {...input,type:'pool.definition.create'};
 let m=path.match(/^\/api\/storage\/pools\/([A-Za-z][A-Za-z0-9_-]{1,31})$/);
 if(m&&['PATCH','DELETE'].includes(method))return {...input,id:m[1],type:method==='PATCH'?'pool.definition.update':'pool.definition.delete'};
 if(path==='/api/spaces'&&method==='POST')return {...input,type:'space.create'};
 m=path.match(/^\/api\/spaces\/([a-zA-Z0-9_-]{2,40})$/);
 if(m&&['PATCH','DELETE'].includes(method))return {...input,name:m[1],type:method==='PATCH'?'space.update':'space.delete'};
 if(path==='/api/zfs/datasets'&&method==='POST')return {...input,type:'dataset.create'};
 if(path==='/api/zfs/datasets'&&method==='PATCH')return {...input,dataset:input.name,type:'dataset.update'};
 if(['/api/zfs/datasets','/api/proxmox/disk-clean','/api/proxmox/storage','/api/shares'].includes(path)||/^\/api\/shares\/[0-9a-f-]{36}$/.test(path))return {unsupported:true};
 return null;
}
export async function storageAgentJson(path,input,timeout=120000){
 const token=(await readFile(process.env.LIGHTNAS_STORAGE_AGENT_TOKEN_FILE||'/etc/lightnas/storage-agent.token','utf8')).trim();
 return new Promise((resolve,reject)=>{
  const request=http.request({socketPath:process.env.LIGHTNAS_STORAGE_AGENT_SOCKET||'/run/lightnas-storage/storage.sock',path,method:input===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'}},response=>{
   let text='';response.on('data',chunk=>{text+=chunk;if(Buffer.byteLength(text)>4*1024*1024)request.destroy(new Error('Agent response too large'));});response.on('end',()=>{try{const value=JSON.parse(text);if(response.statusCode>=400)reject(Object.assign(new Error(value.error||'Storage agent rejected request'),{status:response.statusCode}));else resolve(value);}catch(e){reject(e);}});
  });request.setTimeout(timeout,()=>request.destroy(new Error('Storage agent timed out')));request.on('error',e=>reject(Object.assign(e,{status:503})));request.end(input===undefined?undefined:JSON.stringify(input));
 });
}
