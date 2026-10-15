import http from 'node:http';
import net from 'node:net';
import {readFile,chmod,mkdir,lstat,unlink} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ResourceAdapter} from './resources.js';
import {FeatureAdapter} from './features.js';
import {inventory} from './storage.js';
import {Operations,ShareAdapter,publicJob} from './operations.js';
export function createServer({token,ops,discover,agent=false,socket,ui}){
 return http.createServer(async(req,res)=>{
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(publicJob(data)));};
  if(req.method==='GET'&&req.url==='/'&&ui){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'});res.end(ui);return;}
  const supplied=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,''));const expected=Buffer.from(token);
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return reply(401,{error:'Authentication required'});
  if(!agent&&socket){
   const forward=http.request({socketPath:socket,path:req.url,method:req.method,headers:{authorization:req.headers.authorization,'content-type':'application/json',...(req.headers['last-event-id']?{'last-event-id':req.headers['last-event-id']}:{})}},upstream=>{res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);});
   forward.on('error',()=>{if(!res.headersSent)reply(503,{error:'Storage agent unavailable'});else res.end();});res.on('close',()=>forward.destroy());req.pipe(forward);return;
  }
  try{
   const url=new URL(req.url,'http://localhost');const parts=url.pathname.split('/').filter(Boolean);
   if(req.method==='GET'&&url.pathname==='/v1/remote-storage'){const name=url.searchParams.get('name'),type=url.searchParams.get('type');return reply(200,type?await ops.resources.providers.remoteContent(name,type):await ops.resources.providers.remoteStatus(name));}
   if(req.method==='GET'&&url.pathname==='/v1/creation-options')return reply(200,await ops.resources.creationOptions());
   if(req.method==='GET'&&url.pathname==='/v1/inventory')return reply(200,{...await discover(),initializationEnabled:ops.allowInitialization===true});
   if(req.method==='GET'&&url.pathname==='/v1/protection')return reply(200,await ops.features.protectionInventory());
   if(req.method==='GET'&&url.pathname==='/v1/features')return reply(200,await ops.features.inventory());
   if(req.method==='GET'&&url.pathname==='/v1/dataset')return reply(200,await ops.features.datasetDetail(url.searchParams.get('name')));
   if(req.method==='GET'&&url.pathname==='/v1/csr')return reply(200,await ops.features.certificates.download(url.searchParams.get('name')));
   if(req.method==='GET'&&url.pathname==='/v1/shares')return reply(200,await ops.adapter?.shares?.()||[]);
   if(req.method==='GET'&&url.pathname==='/v1/jobs')return reply(200,[...ops.jobs.values()]);
   const job=ops.jobs.get(parts[2]);
   if(req.method==='GET'&&parts[0]==='v1'&&parts[1]==='jobs'&&job){
    if(parts[3]==='events')return reply(200,job.events.filter(e=>e.sequence>Number(url.searchParams.get('after')||0)));
    if(parts[3]==='stream'){
     let sequence=Number(req.headers['last-event-id']||url.searchParams.get('after')||0);
     if(!Number.isSafeInteger(sequence)||sequence<0)return reply(400,{error:'Invalid event cursor'});
     res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
     const send=j=>{if(j.id!==job.id)return;for(const event of j.events){if(event.sequence>sequence){res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);sequence=event.sequence;}}};
     send(job);ops.on('progress',send);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);res.on('close',()=>{clearInterval(heartbeat);ops.off('progress',send);});return;
    }
    return reply(200,job);
   }
   if(req.method!=='POST')return reply(404,{error:'Not found'});
   if(!agent)return reply(403,{error:'Mutations require the root-owned Unix socket agent'});
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536){reply(413,{error:'Request too large'});return;}}
   const input=JSON.parse(body||'{}');
   if(url.pathname==='/v1/preview')return reply(201,await ops.preview(input));
   if(parts[0]==='v1'&&parts[1]==='jobs'&&parts[3]==='approve')return reply(202,await ops.approve(parts[2],input.approvalHash,input.confirmation));
   if(parts[0]==='v1'&&parts[1]==='jobs'&&parts[3]==='rollback-preview')return reply(201,await ops.previewRollback(parts[2]));
   if(parts[0]==='v1'&&parts[1]==='jobs'&&parts[3]==='cancel')return reply(200,await ops.cancel(parts[2]));
   reply(404,{error:'Not found'});
  }catch(e){reply(400,{error:e.message});}
 });
}
async function clearStaleSocket(socket){
 let stat;try{stat=await lstat(socket);}catch(e){if(e.code==='ENOENT')return;throw e;}
 if(!stat.isSocket())throw Error('Refusing to replace non-socket agent path');
 const active=await new Promise((resolve,reject)=>{const c=net.createConnection(socket);c.on('connect',()=>{c.destroy();resolve(true);});c.on('error',e=>{if(e.code==='ECONNREFUSED')resolve(false);else reject(e);});});
 if(active)throw Error('Storage agent already running');
 const current=await lstat(socket);if(current.ino!==stat.ino)throw Error('Agent socket changed during startup');await unlink(socket);
}
async function main(){
 const agent=process.argv.includes('--agent');if(agent&&process.getuid?.()!==0)throw Error('Agent must run as root');
 const token=process.env.NAS_AGENT_TOKEN_FILE?(await readFile(process.env.NAS_AGENT_TOKEN_FILE,'utf8')).trim():process.env.NAS_AGENT_TOKEN;
 if(!token||token.length<32)throw Error('Set a random NAS_AGENT_TOKEN (at least 32 characters) or NAS_AGENT_TOKEN_FILE');
 const dir=process.env.NAS_JOB_DIR||'data/jobs';const features=new FeatureAdapter({dir});if(agent)await features.init();const resources=new ResourceAdapter();const adapter=new ShareAdapter({manifest:dir+'/shares.json',shareRoots:()=>resources.shareRoots()});
 features.shareProvider=()=>adapter.shares();
 const discover=async()=>({...await inventory(),shares:await adapter.shares(),poolDefinitions:(await resources.snapshot('pool.definition.create')).pools,shareRoots:await resources.shareRoots()});
 const safetyDiscover=async()=>({...await inventory(undefined,{includeHealth:false}),shares:await adapter.shares()});
 const ops=new Operations({dir,adapter,resources,features,discover:safetyDiscover,allowInitialization:process.env.NAS_ALLOW_STORAGE_INITIALIZATION==='1'});await ops.init();if(agent)features.startScheduler(ops);
 const ui=await readFile(new URL('../../public/storage-operations.html',import.meta.url),'utf8');
 const socket=agent?(process.env.NAS_AGENT_SOCKET||'/run/lightnas/storage.sock'):process.env.NAS_AGENT_SOCKET;
 const server=createServer({token,ops,discover,agent,socket,ui});server.requestTimeout=20000;server.headersTimeout=10000;
 if(agent){await mkdir(dirname(socket),{recursive:true,mode:0o750});await clearStaleSocket(socket);server.listen(socket,async()=>{await chmod(socket,0o660);console.log('Storage agent: '+socket);});}
 else server.listen(Number(process.env.NAS_PORT||3080),process.env.NAS_HOST||'127.0.0.1',()=>console.log('LightNAS storage console ready'));
}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();
