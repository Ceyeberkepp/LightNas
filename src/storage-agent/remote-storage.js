import https from 'node:https';
import tls from 'node:tls';
const normalizePin=value=>String(value||'').replaceAll(':','').toLowerCase();
export function remoteRequest(url,{headers={},method='GET',body,pin}={}){
 return new Promise((resolve,reject)=>{
  const agent=new https.Agent({keepAlive:false});
  if(pin){const expected=normalizePin(pin);if(!/^[0-9a-f]{64}$/.test(expected)){reject(Error('Enter the server certificate SHA-256 fingerprint'));return;}
   // Authenticate a pinned certificate before giving HTTP a connected socket.
   agent.createConnection=(options,callback)=>{let done=false;const finish=(error,socket)=>{if(done)return;done=true;callback(error,socket);};const socket=tls.connect({...options,rejectUnauthorized:false,minVersion:'TLSv1.2'},()=>{if(normalizePin(socket.getPeerCertificate().fingerprint256)!==expected){finish(Error('Remote storage certificate fingerprint does not match'));socket.destroy();return;}finish(null,socket);});socket.once('error',error=>finish(error));};
  }
  const request=https.request(url,{method,headers,agent,minVersion:'TLSv1.2'},response=>{let text='';response.setEncoding('utf8');response.on('data',chunk=>{text+=chunk;if(Buffer.byteLength(text)>4*1024*1024)request.destroy(Error('Remote storage response too large'));});response.on('error',reject);response.on('end',()=>{agent.destroy();if(response.statusCode<200||response.statusCode>=300){reject(Error('Remote storage returned HTTP '+response.statusCode+'. Check endpoint, credentials and datastore permissions.'));return;}resolve(text);});});const timer=setTimeout(()=>request.destroy(Error('Remote storage connection timed out')),15000);request.once('close',()=>clearTimeout(timer));request.setTimeout(15000,()=>request.destroy(Error('Remote storage connection timed out')));request.on('error',error=>{agent.destroy();reject(error);});request.end(body);
 });
}
const unescape=value=>value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const extensions={iso:/\.iso$/i,images:/\.(qcow2|raw|vmdk|vhdx?)$/i,backup:/\.(vma(?:\.zst|\.gz)?|tar(?:\.zst|\.gz)?)$/i,snippets:/\.(txt|conf|cfg|yaml|yml|json|sh)$/i,files:/./};
export class RemoteStorage{
 constructor(request=remoteRequest){this.request=request;}
 options(provider,config,credentials){const authorization=provider==='proxmox-backup-server'?'PBSAPIToken='+config.username+':'+credentials.secret:'Basic '+Buffer.from(config.username+':'+credentials.password).toString('base64');return {headers:{Authorization:authorization},pin:config.fingerprint};}
 url(config,path){const url=new URL(path,'https://'+config.server);if(path.startsWith('/api2/')&&!url.port&&!/(?:\]:|^[^:]+:)\d+$/.test(config.server))url.port='8007';return url;}
 async pbs(config,credentials,suffix){const text=await this.request(this.url(config,'/api2/json/admin/datastore/'+encodeURIComponent(config.datastore)+'/'+suffix),this.options('proxmox-backup-server',config,credentials));const response=JSON.parse(text);if(!response||!Object.hasOwn(response,'data'))throw Error('Invalid PBS API response');return response.data;}
 async esxiFolder(config,credentials){
  const options=this.options('esxi',config,credentials),base=this.url(config,'/folder/');base.searchParams.set('dcPath','ha-datacenter');base.searchParams.set('dsName',config.datastore);
  const envelope='<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><RetrieveServiceContent xmlns="urn:vim25"><_this type="ServiceInstance">ServiceInstance</_this></RetrieveServiceContent></soapenv:Body></soapenv:Envelope>';
  const service=await this.request(this.url(config,'/sdk'),{...options,method:'POST',body:envelope,headers:{...options.headers,'Content-Type':'text/xml; charset=utf-8',SOAPAction:'"urn:vim25/6.0"'}});if(!/RetrieveServiceContentResponse/.test(service)||!/<(?:\w+:)?apiType>HostAgent<\//.test(service))throw Error('Connect directly to an ESXi host with its datastore name');
  const html=await this.request(base,options);if(!/<a\s/i.test(html)||!/(?:Index of|Datastore|Parent Directory|folder)/i.test(html))throw Error('ESXi datastore listing could not be verified');return {html,base};
 }
 async status(provider,config,credentials){
  const identity={provider,server:config.server,datastore:config.datastore};
  if(provider==='proxmox-backup-server'){if(!/^[^\s:]+@[^\s:!]+![^\s:]+$/.test(config.username))throw Error('Use a PBS API token ID (user@realm!token)');const data=await this.pbs(config,credentials,'status');if(!Number.isFinite(data.total)||!Number.isFinite(data.used)||!Number.isFinite(data.avail))throw Error('PBS datastore status is missing capacity information');return {identity,totalBytes:data.total,usedBytes:data.used,availableBytes:data.avail,online:true,capacityKnown:true};}
  if(provider==='esxi'){await this.esxiFolder(config,credentials);return {identity,totalBytes:null,usedBytes:null,availableBytes:null,online:true,capacityKnown:false};}
  throw Error('Unsupported remote storage provider');
 }
 async list(provider,config,credentials,type){
  if(provider==='proxmox-backup-server'){if(type!=='backup')throw Error('PBS holds native backup snapshots');const data=await this.pbs(config,credentials,'snapshots');if(!Array.isArray(data))throw Error('Invalid PBS snapshot listing');return {entries:data.map(item=>({name:item['backup-type']+'/'+item['backup-id']+'/'+item['backup-time'],modifiedAt:new Date(item['backup-time']*1000).toISOString(),sizeBytes:item.size??null,nativeSnapshot:true})),readOnly:true};}
  if(!extensions[type])throw Error('Unsupported datastore content type');const {html,base}=await this.esxiFolder(config,credentials);const entries=[],seen=new Set();
  for(const match of html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
   let url;try{url=new URL(unescape(match[1]),base);}catch{continue;}if(url.origin!==base.origin||!url.pathname.startsWith('/folder/')||url.pathname.endsWith('/'))continue;let name;try{name=decodeURIComponent(url.pathname.slice('/folder/'.length));}catch{continue;}if(!name||name.includes('/')||name.startsWith('.')||seen.has(name)||!extensions[type].test(name))continue;seen.add(name);entries.push({name,sizeBytes:null,modifiedAt:null,remoteFile:true});
  }
  return {entries,readOnly:true};
 }
}
