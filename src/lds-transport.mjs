import https from 'node:https';
import {createHash} from 'node:crypto';
const MAX=8388608;
const digest=b=>createHash('sha256').update(b).digest('hex');
const valid=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
const deadline=n=>{if(!Number.isSafeInteger(n)||n<1||n>60000)throw new TypeError('invalid deadline');return n};
function tlsOptions(tls){if(!tls?.ca||!tls.cert||!tls.key)throw new TypeError('mutual TLS credentials required');return {ca:tls.ca,cert:tls.cert,key:tls.key,minVersion:'TLSv1.2',rejectUnauthorized:true}}
async function collect(stream,limit){const chunks=[];let size=0;for await(const b of stream){size+=b.length;if(size>limit)throw Error('body limit exceeded');chunks.push(b)}return Buffer.concat(chunks,size)}
// Dedicated cluster CA plus explicit SHA-256 certificate allowlist.
export function createReplicaServer({store,tls,allowedFingerprints,timeoutMs=10000}){
 const options=tlsOptions(tls), ms=deadline(timeoutMs);
 if(!Array.isArray(allowedFingerprints)||!allowedFingerprints.length||allowedFingerprints.some(x=>typeof x!=='string'||!/^[A-F0-9]{2}(:[A-F0-9]{2}){31}$/.test(x)))throw new TypeError('certificate fingerprints required');
 const allowed=new Set(allowedFingerprints);
 const server=https.createServer({...options,requestCert:true,requestTimeout:ms,headersTimeout:ms},async(req,res)=>{
 const timer=setTimeout(()=>req.socket.destroy(),ms);
 try{
 if(!req.socket.authorized||!allowed.has(req.socket.getPeerCertificate().fingerprint256)){res.writeHead(403).end();return}
 const id=req.url?.slice(8);
 if(!req.url?.startsWith('/chunks/')||!valid(id)){res.writeHead(400).end();return}
 if(req.method==='PUT'){
 const b=await collect(req,MAX);
 if(!b.length||digest(b)!==id){res.writeHead(400).end();return}
 if(await store.put(b)!==id)throw Error('store checksum mismatch');
 res.writeHead(201).end(id);
 }else if(req.method==='GET'){
 const b=await store.get(id);
 if(b.length>MAX||digest(b)!==id)throw Error('store checksum mismatch');
 res.writeHead(200,{'content-type':'application/octet-stream','content-length':b.length}).end(b);
 }else res.writeHead(405).end();
 }catch(e){if(!res.headersSent&&!res.destroyed)res.writeHead(e.code==='ENOENT'?404:500).end();else res.destroy()}finally{clearTimeout(timer)}
 });
 server.setTimeout(ms,s=>s.destroy());
 return server;
}
export class LdsRemoteStore{
 constructor({url,tls,timeoutMs=10000}){
 const u=new URL(url);
 if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new TypeError('HTTPS origin required');
 this.url=u.origin;this.tls=tlsOptions(tls);this.timeoutMs=deadline(timeoutMs);
 }
 async request(method,id,body){
 if(!valid(id))throw new TypeError('invalid chunk ID');
 return new Promise((resolve,reject)=>{
 const req=https.request(new URL('/chunks/'+id,this.url),{...this.tls,method,agent:false,headers:body?{'content-length':body.length}:{}},async res=>{
 try{if(res.statusCode!==(method==='PUT'?201:200)){res.destroy();throw Error('replica HTTP '+res.statusCode)}resolve(await collect(res,method==='PUT'?64:MAX))}catch(e){res.destroy();reject(e)}
 });
 const timer=setTimeout(()=>req.destroy(Error('replica deadline exceeded')),this.timeoutMs);
 req.on('error',reject);req.on('close',()=>clearTimeout(timer));req.end(body);
 });
 }
 async put(data){if(!(data instanceof Uint8Array)||!data.length||data.length>MAX)throw new TypeError('invalid chunk size');const b=Buffer.from(data),id=digest(b);if((await this.request('PUT',id,b)).toString()!==id)throw Error('replica acknowledgement mismatch');return id}
 async get(id){const b=await this.request('GET',id);if(digest(b)!==id)throw Error('replica checksum mismatch');return b}
}
