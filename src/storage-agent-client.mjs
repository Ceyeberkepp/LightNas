import http from 'node:http';
import {readFile} from 'node:fs/promises';
const namespace='/api/storage/agent';
export function storageAgentRoute(path,method){
 if(!path.startsWith(namespace+'/'))return false;
 const suffix=path.slice(namespace.length);
 if(method==='GET')return /^\/(inventory|jobs)$/.test(suffix)||/^\/jobs\/[0-9a-f-]{36}(\/(events|stream))?$/.test(suffix);
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
