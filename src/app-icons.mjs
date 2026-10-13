import {mkdir,readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {atomic} from './storage-agent/persistence.js';
const allowedHosts=new Set(['raw.githubusercontent.com','cdn.jsdelivr.net','media.sys.truenas.net','cdn.icewhale.io','apps.icewhale.io','cdn.bigbeartechworld.com']);
export function safeIconUrl(value){try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||!allowedHosts.has(url.hostname.toLowerCase()))return null;return url.href;}catch{return null;}}
export function iconCandidates(app){
 const choices=[app.icon,app.thumbnail].map(safeIconUrl).filter(Boolean);const name=String(app.upstreamId||app.id||'').toLowerCase();const aliases={'filebrowser':'file-browser','code-server':'code-server','openwebui':'open-webui'};const slug=aliases[name]||name;
 if(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug))choices.push('https://raw.githubusercontent.com/selfhst/icons/main/png/'+slug+'.png');return [...new Set(choices)];
}
export function iconType(buffer){
 if(buffer.length<8)return null;if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';if(/^GIF8[79]a/.test(buffer.subarray(0,6).toString()))return 'image/gif';if(buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP')return 'image/webp';
 const svg=buffer.toString('utf8');if(/^\s*(?:<\?xml[^>]+>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(svg)&&!/<script\b|<foreignObject\b|\bon[a-z]+\s*=|<!ENTITY|<!DOCTYPE|(?:href|xlink:href)\s*=\s*["'](?!#)/i.test(svg))return 'image/svg+xml';return null;
}
export class AppIconCache{
 constructor({dir=join(dirname(process.env.NAS_DATA_FILE||'/var/lib/lightnas/state.json'),'catalog-icons'),fetcher=fetch,now=Date.now}={}){this.dir=dir;this.fetcher=fetcher;this.now=now;this.pending=new Map();this.failed=new Map();this.active=0;this.waiting=[];}
 async download(url,redirects=0){if(!safeIconUrl(url)||redirects>3)throw Error('Unsupported icon URL');const response=await this.fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(6000),headers:{'User-Agent':'LightNAS-AppIcons/1.0'}});if([301,302,303,307,308].includes(response.status))return this.download(new URL(response.headers.get('location'),url).href,redirects+1);if(!response.ok)throw Error('Icon download unavailable');if(Number(response.headers.get('content-length')||0)>512*1024)throw Error('Icon is too large');const reader=response.body.getReader(),chunks=[];let total=0;try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>512*1024)throw Error('Icon is too large');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}const buffer=Buffer.concat(chunks),contentType=iconType(buffer);if(!contentType)throw Error('Unsupported icon format');return {buffer,contentType};}
 async get(app){
  if(!app?.id)return null;const candidates=iconCandidates(app),key=createHash('sha256').update(JSON.stringify([app.id,candidates])).digest('hex');if(this.pending.has(key))return this.pending.get(key);
  const work=this.load(key,candidates);this.pending.set(key,work);try{return await work;}finally{this.pending.delete(key);}
 }
 async load(key,candidates){let cached;try{const meta=JSON.parse(await readFile(join(this.dir,key+'.json'),'utf8')),buffer=await readFile(join(this.dir,key+'.img'));if(iconType(buffer)===meta.contentType){cached={buffer,contentType:meta.contentType};if(this.now()-meta.savedAt<7*86400000)return cached;}}catch{}
  if((this.failed.get(key)||0)>this.now())return cached||null;
  if(this.active>=4){if(this.waiting.length>=96)return cached||null;await new Promise(resolve=>this.waiting.push(resolve));}else this.active++;
  try{for(const url of candidates)try{const result=await this.download(url);await mkdir(this.dir,{recursive:true,mode:0o700});await atomic(join(this.dir,key+'.img'),result.buffer);await atomic(join(this.dir,key+'.json'),JSON.stringify({contentType:result.contentType,savedAt:this.now()}));return result;}catch{}
   this.failed.set(key,this.now()+300000);if(this.failed.size>4096)this.failed.delete(this.failed.keys().next().value);return cached||null;
  }finally{const next=this.waiting.shift();if(next)next();else this.active--;}
 }
}
