import {readFile,mkdir,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createPrivateKey,X509Certificate} from 'node:crypto';
import {atomic} from './persistence.js';
import {command,digest} from './storage.js';
export const CERTIFICATE_TYPES=['certificate.import','certificate.csr','certificate.acme','dns.profile.save'];
const id=value=>{if(typeof value!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{1,47}$/.test(value))throw Error('Use a 2–48 character certificate/profile name');return value;};
function domains(values){if(!Array.isArray(values)||!values.length||values.length>20||values.some(v=>typeof v!=='string'||v.length>253||! /^(\*\.)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(v)))throw Error('Enter valid domain names');return [...new Set(values.map(v=>v.toLowerCase()))].sort();}
async function readJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
export class CertificateAdapter{
 constructor({dir='/var/lib/lightnas-storage',run=command}={}){this.dir=join(dir,'certificates');this.run=run;}
 async init(){await mkdir(this.dir,{recursive:true,mode:0o700});}
 path(name,suffix){return join(this.dir,id(name)+suffix);}
 async registry(){return readJson(join(this.dir,'registry.json'),{certificates:[],requests:[],dnsProfiles:[]});}
 async inventory(){const registry=await this.registry();return {...registry,certificates:registry.certificates.map(c=>({...c,expired:Date.parse(c.validTo)<=Date.now(),notYetValid:Date.parse(c.validFrom)>Date.now()}))};}
 async publicCertificate(cert,name){return {name,subject:cert.subject,issuer:cert.issuer,validFrom:cert.validFrom,validTo:cert.validTo,subjectAltName:cert.subjectAltName||'',fingerprint:cert.fingerprint256,expired:Date.parse(cert.validTo)<=Date.now()};}
 async download(name){const registry=await this.registry();if(!registry.requests.some(r=>r.name===name))throw Error('CSR not found');return {name,csr:await readFile(this.path(name,'.csr'),'utf8')};}
 async plan(input){
  if(!CERTIFICATE_TYPES.includes(input.type))throw Error('Unsupported certificate operation');const name=id(input.name);const before=await this.registry();const commands=[];let after,privateValues={};
  if(input.type==='dns.profile.save'){
   if(input.provider!=='cloudflare')throw Error('This build supports the Cloudflare DNS authenticator');const token=String(input.private?.apiToken||'').trim();if(!/^[A-Za-z0-9_-]{20,256}$/.test(token))throw Error('Provide a valid scoped Cloudflare API token');
   const plugin=await this.run('/usr/bin/certbot',['plugins']);if(!plugin.ok||!plugin.stdout.includes('dns-cloudflare'))throw Error('Install the Certbot Cloudflare DNS plugin');
   after={name,provider:'cloudflare',credentialFingerprint:digest(token)};privateValues={apiToken:token};
  }else if(input.type==='certificate.import'){
   const pem=String(input.private?.certificate||'');const keyText=String(input.private?.privateKey||(before.requests.some(r=>r.name===name)?await readFile(this.path(name,'.key'),'utf8'):''));if(pem.length>40000||keyText.length>20000)throw Error('Certificate material is too large');
   let cert,key;try{cert=new X509Certificate(pem);key=createPrivateKey(keyText);if(!cert.checkPrivateKey(key))throw Error('mismatch');}catch{throw Error('Certificate and unencrypted private key must be valid and match');}
   after=await this.publicCertificate(cert,name);privateValues={certificate:pem,privateKey:key.export({format:'pem',type:'pkcs8'}).toString()};
  }else if(input.type==='certificate.csr'){
   if(before.requests.some(r=>r.name===name)||before.certificates.some(r=>r.name===name))throw Error('Use a new name to preserve existing certificate keys');for(const suffix of ['.key','.csr','.pem']){try{await lstat(this.path(name,suffix));throw Error('Certificate files already exist; inspect prior generation before retrying');}catch(error){if(error.code!=='ENOENT')throw error;}}const names=domains(input.domains);after={name,domains:names,keyType:'RSA-3072',status:'signing-request'};
   commands.push({bin:'/usr/bin/openssl',args:['req','-new','-newkey','rsa:3072','-nodes','-keyout',this.path(name,'.key'),'-out',this.path(name,'.csr'),'-subj','/CN='+names[0].replace(/^\*\./,''),'-addext','subjectAltName='+names.map(v=>'DNS:'+v).join(',')]});
  }else{
   const names=domains(input.domains);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email||''))throw Error('Provide the ACME account email');const profile=before.dnsProfiles.find(p=>p.name===input.profile);if(!profile)throw Error('Choose an existing DNS authenticator');
   after={name,domains:names,profile:profile.name,accountEmail:input.email,status:'ACME certificate request'};
   commands.push({bin:'/usr/bin/certbot',args:['certonly','--non-interactive','--agree-tos','--email',input.email,'--cert-name',name,'--dns-cloudflare','--dns-cloudflare-credentials',this.path(profile.name,'.dns.ini'),'--dns-cloudflare-propagation-seconds','60','--config-dir',join(this.dir,'acme'),'--work-dir',join(this.dir,'work'),'--logs-dir',join(this.dir,'logs'),...names.flatMap(v=>['-d',v])]});
  }
  const files=input.type==='dns.profile.save'?[this.path(name,'.dns.ini')]:[this.path(name,'.key'),this.path(name,input.type==='certificate.csr'?'.csr':'.pem')];
  const fileState=[];for(const path of files){try{const bytes=await readFile(path);fileState.push({path,exists:true,bytes:bytes.length,fingerprint:digest(bytes.toString('base64'))});}catch(error){if(error.code!=='ENOENT')throw error;fileState.push({path,exists:false});}}
  return {type:input.type,input:{...input,private:input.private},before,after,commands,private:privateValues,dataErased:false,permissionChanges:false,affectedServices:input.type==='certificate.acme'?['ACME DNS validation']:[],files,fileState,warning:input.type==='certificate.acme'?'Creates temporary DNS validation records using the scoped token. Issuing a certificate does not switch LightNAS HTTP/TLS listeners.':'Private keys and DNS credentials stay in the root-only certificate store and are omitted from API responses.',rollback:'Existing imported certificate/profile files are backed up before replacement. Generated keys and external ACME issuance require inspection on failure.'};
 }
 async validate(impact){if(digest(await this.plan(impact.input))!==digest(impact))throw Error('Certificate registry changed; request another preview');}
 async apply(impact){
  await this.init();const backups=[];const write=async(path,text)=>{let before=null;try{before=await readFile(path);}catch(error){if(error.code!=='ENOENT')throw error;}backups.push({path,before});await atomic(path,text);};
  try{const registry=structuredClone(impact.before),name=impact.after.name;
   if(impact.type==='dns.profile.save'){await write(this.path(name,'.dns.ini'),'dns_cloudflare_api_token = '+impact.private.apiToken+'\n');registry.dnsProfiles=registry.dnsProfiles.filter(p=>p.name!==name).concat(impact.after);}
   else if(impact.type==='certificate.import'){await write(this.path(name,'.pem'),impact.private.certificate);await write(this.path(name,'.key'),impact.private.privateKey);registry.certificates=registry.certificates.filter(c=>c.name!==name).concat(impact.after);registry.requests=registry.requests.filter(r=>r.name!==name);}
   else{for(const c of impact.commands){const result=await this.run(c.bin,c.args,180000);if(!result.ok)throw Error('Certificate command failed; verify domain control, DNS permissions and installed tools.');}
    if(impact.type==='certificate.csr'){const check=await this.run('/usr/bin/openssl',['req','-in',this.path(name,'.csr'),'-verify','-noout']);if(!check.ok)throw Error('CSR signature verification failed');registry.requests.push(impact.after);}
    else{const source=join(this.dir,'acme','live',name);const pem=await readFile(join(source,'fullchain.pem'),'utf8'),key=await readFile(join(source,'privkey.pem'),'utf8');const cert=new X509Certificate(pem);if(!cert.checkPrivateKey(createPrivateKey(key)))throw Error('Issued certificate key mismatch');await write(this.path(name,'.pem'),pem);await write(this.path(name,'.key'),key);registry.certificates=registry.certificates.filter(c=>c.name!==name).concat({...await this.publicCertificate(cert,name),acme:true,domains:impact.after.domains,profile:impact.after.profile});registry.requests=registry.requests.filter(r=>r.name!==name);}
   }
   await write(join(this.dir,'registry.json'),JSON.stringify(registry,null,2));return impact.after;
  }catch(error){for(const backup of backups.reverse())try{if(backup.before===null)await rm(backup.path,{force:true});else await atomic(backup.path,backup.before);}catch{error.recovery='Certificate restoration incomplete; inspect root-only files';}throw error;}
 }
 async renew(){await this.init();const result=await this.run('/usr/bin/certbot',['renew','--quiet','--config-dir',join(this.dir,'acme'),'--work-dir',join(this.dir,'work'),'--logs-dir',join(this.dir,'logs')],180000);if(!result.ok)throw Error('ACME renewal failed');const registry=await this.registry();for(const item of registry.certificates.filter(c=>c.acme)){const source=join(this.dir,'acme','live',item.name);const pem=await readFile(join(source,'fullchain.pem'),'utf8'),key=await readFile(join(source,'privkey.pem'),'utf8');const cert=new X509Certificate(pem);if(!cert.checkPrivateKey(createPrivateKey(key)))throw Error('Renewal key mismatch');await atomic(this.path(item.name,'.pem'),pem);await atomic(this.path(item.name,'.key'),key);Object.assign(item,await this.publicCertificate(cert,item.name));}await atomic(join(this.dir,'registry.json'),JSON.stringify(registry));}
}
