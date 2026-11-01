import http from 'node:http';
import {readFile} from 'node:fs/promises';
const namespace='/api/storage/agent';
export function storageAgentRoute(path,method){
 if(!path.startsWith(namespace+'/'))return false;
 const suffix=path.slice(namespace.length);
 if(method==='GET')return /^\/(inventory|creation-options|remote-storage|kubernetes|jobs|shares|features|protection|dataset|csr)$/.test(suffix)||/^\/jobs\/[0-9a-f-]{36}(\/(events|stream))?$/.test(suffix);
 return method==='POST'&&(suffix==='/preview'||/^\/jobs\/[0-9a-f-]{36}\/(approve|cancel|rollback-preview)$/.test(suffix));
}
export async function forwardStorageAgent(req,res,url,input,{timeoutMs=120000}={}){
 let token;try{token=(await readFile(process.env.LIGHTNAS_STORAGE_AGENT_TOKEN_FILE||'/etc/lightnas/storage-agent.token','utf8')).trim();}catch{throw Object.assign(new Error('Storage operation agent is not installed. Run the updated LightNAS installer.'),{status:503});}
 if(token.length<32)throw Object.assign(new Error('Storage agent credential is invalid.'),{status:503});
 const path='/v1'+url.pathname.slice(namespace.length)+url.search;
 const deadlineMs=Number.isFinite(timeoutMs)&&timeoutMs>0?Math.min(timeoutMs,120000):120000;
 return new Promise((resolve,reject)=>{
  let settled=false;
  let deadline;
  const done=()=>{if(settled)return;settled=true;clearTimeout(deadline);resolve();};
  const fail=error=>{
   if(settled)return;
   settled=true;clearTimeout(deadline);
   // Once headers have been forwarded, ending the response would make a
   // truncated successful HTTP response appear valid to the caller.
   if(res.headersSent){res.destroy(error);resolve();}
   else reject(Object.assign(new Error('Storage agent unavailable: '+error.message),{status:503}));
  };
  const upstream=http.request({socketPath:process.env.LIGHTNAS_STORAGE_AGENT_SOCKET||'/run/lightnas-storage/storage.sock',path,method:req.method,headers:{authorization:'Bearer '+token,'content-type':'application/json',...(req.headers['last-event-id']?{'last-event-id':req.headers['last-event-id']}:{})}},response=>{
   const contentType=String(response.headers['content-type']||'application/json');
   // Only the job progress routes may outlive the absolute request deadline.
   // An agent-controlled Content-Type header must not exempt inventory, preview
   // or other ordinary requests from timeout enforcement.
   const jobStream=req.method==='GET'&&/^\/jobs\/[0-9a-f-]{36}\/(?:events|stream)$/.test(url.pathname.slice(namespace.length));
   const eventStream=jobStream&&contentType.split(';',1)[0].trim().toLowerCase()==='text/event-stream';
   // Long-running SSE is intentional. Other agent responses have an
   // absolute deadline so a trickling peer cannot hold clients indefinitely.
   if(eventStream)clearTimeout(deadline);
   try{
    res.writeHead(response.statusCode,{'Content-Type':contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(eventStream?{'X-Accel-Buffering':'no'}:{})});
   }catch(error){response.destroy();fail(error);return;}
   const interrupted=()=>fail(new Error('Storage agent response interrupted'));
   response.on('error',fail);
   response.on('aborted',interrupted);
   response.on('close',()=>{if(!response.complete)interrupted();});
   response.on('end',done);
   response.pipe(res);
  });
  deadline=setTimeout(()=>upstream.destroy(new Error('Storage agent timed out')),deadlineMs);
  upstream.setTimeout(deadlineMs,()=>upstream.destroy(new Error('Storage agent timed out')));
  upstream.on('error',fail);
  res.on('close',()=>{upstream.destroy();done();});
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
const MAX_AGENT_RESPONSE_BYTES = 4 * 1024 * 1024;
export async function storageAgentJson(path,input,timeout=120000){
 const token=(await readFile(process.env.LIGHTNAS_STORAGE_AGENT_TOKEN_FILE||'/etc/lightnas/storage-agent.token','utf8')).trim();
 const body=input===undefined?undefined:JSON.stringify(input);
 return new Promise((resolve,reject)=>{
  let settled=false;
  let request;
  let deadline;
  const fail=error=>{if(settled)return;settled=true;clearTimeout(deadline);reject(error);};
  request=http.request({socketPath:process.env.LIGHTNAS_STORAGE_AGENT_SOCKET||'/run/lightnas-storage/storage.sock',path,method:input===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'}},response=>{
   const chunks=[];let bytes=0;
   const interrupted=()=>fail(Object.assign(new Error('Storage agent response interrupted'),{status:503}));
   response.on('data',chunk=>{
    bytes+=chunk.length;
    if(bytes>MAX_AGENT_RESPONSE_BYTES){request.destroy(new Error('Agent response too large'));return;}
    chunks.push(chunk);
   });
   response.on('error',interrupted);
   response.on('aborted',interrupted);
   response.on('close',()=>{if(!response.complete)interrupted();});
   response.on('end',()=>{
    if(settled)return;
    try{
     const value=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
     if(response.statusCode>=400)fail(Object.assign(new Error(value.error||'Storage agent rejected request'),{status:response.statusCode}));
     else{settled=true;clearTimeout(deadline);resolve(value);}
    }catch(error){fail(error);}
   });
  });
  // This is a wall-clock deadline, not an inactivity timeout: a compromised
  // agent cannot keep a privileged request alive by trickling response bytes.
  deadline=setTimeout(()=>request.destroy(new Error('Storage agent timed out')),timeout);
  request.on('error',error=>fail(Object.assign(error,{status:503})));
  request.end(body);
 });
}
