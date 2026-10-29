// LightNAS public demo — serves the real, unmodified NAS frontend with an isolated sample API.
// NEVER import src/server.mjs, access host daemons, mount disks, or proxy to a live NAS.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataFor } from './native-fixtures.mjs';

const demoRoot=dirname(fileURLToPath(import.meta.url));
const publicRoot=resolve(demoRoot,'../public');
const listenHost=process.env.LIGHTNAS_DEMO_HOST || '127.0.0.1';
const listenPort=Number(process.env.LIGHTNAS_DEMO_PORT || 3081);
const secureCookie=process.env.LIGHTNAS_DEMO_SECURE_COOKIE!=='0';
const COOKIE_NAME='lightnas_demo_session';
const SESSION_TTL_MS=60*60*1000;
const DEMO_ACCOUNTS=Object.freeze({
  'demo-admin':{password:'LightNASAdmin2026!',role:'administrator'},
  'demo-user':{password:'LightNASUser2026!',role:'user'}
});
const sessions=new Map();
function sessionFrom(req){
  const cookie=String(req.headers.cookie||'').split(';').map(p=>p.trim()).find(p=>p.startsWith(COOKIE_NAME+'='));
  const token=cookie?.slice(COOKIE_NAME.length+1)||'';
  if(!/^[0-9a-f]{64}$/.test(token))return null;
  const record=sessions.get(token);
  if(!record)return null;
  if(record.expires<=Date.now()){sessions.delete(token);return null;}
  return {token,...record};
}
function cookieValue(token,clear=false){
  return COOKIE_NAME+'='+token+'; Path=/; HttpOnly; SameSite=Strict'+(secureCookie?'; Secure':'')+(clear?'; Max-Age=0':'; Max-Age=3600');
}
function passwordMatches(input,expected){
  if(typeof input!=='string')return false;
  const supplied=Buffer.from(input);
  const known=Buffer.from(expected);
  return supplied.length===known.length&&timingSafeEqual(supplied,known);
}
function consumeJson(req){
  return new Promise((resolve,reject)=>{
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json')){
      reject({status:415,message:'JSON request required.'});return;
    }
    let chunks=[],size=0;
    req.on('data',chunk=>{
      size+=chunk.length;
      if(size>4096){reject({status:413,message:'Demo sign-in request too large.'});req.destroy();return;}
      chunks.push(chunk);
    });
    req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject({status:400,message:'Invalid JSON request.'});}});
    req.on('error',reject);
  });
}
const regularAllowed=new Set(['/api/overview','/api/profile','/api/files','/api/files/quota','/api/media','/api/shares']);

if(!Number.isInteger(listenPort)||listenPort<0||listenPort>65535)throw Error('Invalid LIGHTNAS_DEMO_PORT');
const contentTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.webmanifest':'application/manifest+json','.json':'application/json'};
const loginPanel=`<div class="demo-account-panel" aria-label="Public demo login accounts">
 <div class="demo-login-title">TRY LIGHTNAS WITH A DEMO ACCOUNT</div>
 <p>Choose a role, then select <strong>Sign in</strong>. These are public sample credentials. Never enter your real password.</p>
 <button type="button" class="demo-role-pick" data-demo-username="demo-admin" data-demo-password="LightNASAdmin2026!"><span><b>Administrator</b><small>Explore system administration and all demo sections</small></span><code>demo-admin</code></button>
 <button type="button" class="demo-role-pick" data-demo-username="demo-user" data-demo-password="LightNASUser2026!"><span><b>Regular User</b><small>Explore the personal files and standard user interface</small></span><code>demo-user</code></button>
 </div>`;
const bannerCss=`#login-form .demo-account-panel{margin:10px 0 18px;padding:14px;border:1px solid var(--line,#39413d);border-radius:12px;background:var(--panel-2,#20252a)} .demo-login-title{font-size:11px;letter-spacing:.07em;color:var(--accent,#00b83f);font-weight:750;margin-bottom:4px}#login-form .demo-account-panel p{font-size:12px;margin:0 0 12px} .demo-role-pick{width:100%;border:1px solid var(--line,#39413d);background:var(--panel,#1a1e22);color:var(--text,#eef0f2);border-radius:9px;display:flex;align-items:center;justify-content:space-between;text-align:left;gap:12px;padding:10px;margin-top:7px;cursor:pointer}.demo-role-pick:hover,.demo-role-pick:focus-visible{border-color:var(--accent,#00b83f)}.demo-role-pick b,.demo-role-pick small{display:block}.demo-role-pick b{font-size:13px}.demo-role-pick small{color:var(--muted,#a3abb3);font-size:11px}.demo-role-pick code{color:var(--accent,#00b83f);font-size:11px;white-space:nowrap}@media(max-width:430px){.demo-role-pick{align-items:flex-start;flex-direction:column;gap:4px}}#lightnas-demo-indicator{position:fixed;z-index:2147483640;right:14px;top:68px;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 24px);padding:8px 11px;border:1px solid #258e49;background:#103520;color:#edfff1;box-shadow:0 7px 24px #0008;border-radius:9px;font:700 11px/1.3 system-ui,sans-serif;letter-spacing:.01em;pointer-events:none}#lightnas-demo-indicator i{width:7px;height:7px;border-radius:50%;background:#58e98b;flex:none}@media(max-width:760px){#lightnas-demo-indicator{top:56px;right:7px;font-size:10px;padding:6px 8px;max-width:70vw}}#lightnas-demo-indicator small{color:#c8ecd4;font-size:10px;font-weight:500}#lightnas-demo-indicator .demo-separator{opacity:.55}`;
const bannerJs=`(()=>{'use strict';const setAccount=()=>{document.addEventListener('click',event=>{const button=event.target.closest('[data-demo-username]');if(!button)return;const form=document.getElementById('login-form');if(!form)return;form.elements.username.value=button.dataset.demoUsername;form.elements.password.value=button.dataset.demoPassword;form.elements.username.dispatchEvent(new Event('input',{bubbles:true}));form.querySelector('button[type="submit"]')?.focus()})};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setAccount,{once:true});else setAccount();const mount=()=>{if(document.getElementById('lightnas-demo-indicator'))return;const tag=document.createElement('div');tag.id='lightnas-demo-indicator';tag.setAttribute('role','status');tag.innerHTML='<i aria-hidden="true"></i><b>LIGHTNAS DEMO</b><span class="demo-separator">·</span><small>Simulated data · Read only</small>';document.body.appendChild(tag)};const label=()=>{document.querySelectorAll('.ln-live-state').forEach(el=>{if(el.textContent.includes('Live monitoring')){el.textContent='Sample system metrics'}})};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();new MutationObserver(label).observe(document.documentElement,{subtree:true,childList:true});})();`;
const decorateHtml=html=>html
 .replace('</head>','<link rel="stylesheet" href="/_demo/native.css"></head>')
 .replace('</body>','<script src="/_demo/native.js" defer></script></body>')
 .replace('<title>LightNAS — Control Center</title>','<title>LightNAS — Interactive Demo (Sample Data)</title>')
 .replace('<label>Username<input name="username" required autocomplete="username"></label>',loginPanel+'<label>Username<input name="username" required autocomplete="off"></label>')
 .replace('<span>Appliance sign-in</span>','<span>Demo account sign-in</span>');
const headers={
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'no-referrer',
  'Cache-Control':'no-store',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};
function send(res,method,status,type,body,extra={}){
  const payload=Buffer.isBuffer(body)?body:Buffer.from(String(body||''));
  res.writeHead(status,{...headers,'Content-Type':type,'Content-Length':payload.length,...extra});
  res.end(method==='HEAD'?undefined:payload);
}
const sendJson=(res,method,status,data)=>send(res,method,status,'application/json; charset=utf-8',JSON.stringify(data));
const error=(res,method,status,message)=>sendJson(res,method,status,{error:message});
const logo=resolve(publicRoot,'assets/lightnas-logo.png');

const server=createServer(async(req,res)=>{
  const method=req.method||'GET';
  let url;
  try{url=new URL(req.url,'http://lightnas.demo.local');}
  catch{return error(res,method,400,'Invalid URL');}
  const pathname=url.pathname;
  if(method==='POST'&&(pathname==='/api/login'||pathname==='/api/logout')){
    if(req.headers['x-lightnas-request']!=='1')return error(res,method,403,'Demo request header required.');
    if(pathname==='/api/logout'){
      const session=sessionFrom(req);
      if(session)sessions.delete(session.token);
      return send(res,method,200,'application/json; charset=utf-8','{"ok":true}',{'Set-Cookie':cookieValue('',true)});
    }
    let credentials;
    try{credentials=await consumeJson(req);}
    catch(e){return error(res,method,e.status||400,e.message||'Invalid sign-in request.');}
    const username=typeof credentials?.username==='string'?credentials.username:'';
    const record=Object.hasOwn(DEMO_ACCOUNTS,username)?DEMO_ACCOUNTS[username]:null;
    if(!record||!passwordMatches(credentials?.password,record.password))return error(res,method,401,'Invalid demo username or password.');
    for(const [token,data] of sessions)if(data.expires<=Date.now())sessions.delete(token);
    if(sessions.size>=2048)sessions.delete(sessions.keys().next().value);
    const token=randomBytes(32).toString('hex');
    sessions.set(token,{role:record.role,expires:Date.now()+SESSION_TTL_MS});
    return send(res,method,200,'application/json; charset=utf-8',JSON.stringify({ok:true,role:record.role}),{'Set-Cookie':cookieValue(token)});
  }
  if(method!=='GET'&&method!=='HEAD'){
    return error(res,method,403,'LightNAS public demo is read-only. No changes are saved or sent to a real appliance.');
  }
  if(pathname==='/healthz')return sendJson(res,method,200,{status:'ok',mode:'native-frontend-demo',realFrontend:true,simulated:true});
  if(pathname==='/_demo/native.css')return send(res,method,200,'text/css; charset=utf-8',bannerCss);
  if(pathname==='/_demo/native.js')return send(res,method,200,'text/javascript; charset=utf-8',bannerJs);
  if(pathname==='/product-mode.js')return send(res,method,200,'text/javascript; charset=utf-8',"window.LIGHTNAS_PRODUCT_MODE='nas';\n");
  if(pathname==='/api/branding/logo'){
    try{return send(res,method,200,'image/png',await readFile(logo));}
    catch{return error(res,method,404,'Branding asset unavailable');}
  }
  if(pathname.startsWith('/api/')){
    if(pathname==='/api/status'||pathname==='/api/branding')return sendJson(res,method,200,dataFor(pathname,url.searchParams));
    if(pathname==='/api/login/options')return sendJson(res,method,200,{methods:[]});
    const session=sessionFrom(req);
    if(!session)return error(res,method,401,'Sign in with a demo account to continue.');
    if(session.role!=='administrator'&&!regularAllowed.has(pathname))return error(res,method,403,'Administrator demo permissions required.');
    if(pathname==='/api/catalog/icon')return error(res,method,404,'Sample app icons use fallback');
    const data=dataFor(pathname,url.searchParams,session.role);
    return data===null?error(res,method,404,'Demo API endpoint not available.'):sendJson(res,method,200,data);
  }
  let path;
  try{path=decodeURIComponent(pathname);}catch{return error(res,method,400,'Invalid path');}
  if(path.includes('\\')||path.includes('\0')||path.split('/').some(p=>p==='.'||p==='..'||p.startsWith('.'))){return error(res,method,404,'Not found');}
  path=path==='/'?'/index.html':path;
  const ext=extname(path).toLowerCase();
  if(!contentTypes[ext])return error(res,method,404,'Not found');
  const file=resolve(publicRoot,'.'+path);
  if(!file.startsWith(publicRoot+sep))return error(res,method,404,'Not found');
  try{
    const canonical=await realpath(file);
    if(!canonical.startsWith(publicRoot+sep))return error(res,method,404,'Not found');
    let body=await readFile(canonical);
    if(path==='/index.html')body=Buffer.from(decorateHtml(body.toString('utf8')));
    return send(res,method,200,contentTypes[ext],body);
  }catch(e){
    return error(res,method,e?.code==='ENOENT'?404:500,'Asset unavailable');
  }
});
server.requestTimeout=10000;
server.headersTimeout=7000;
server.listen(listenPort,listenHost,()=>process.stdout.write(`LightNAS real-frontend demo listening on http://${listenHost}:${server.address().port}\n`));
