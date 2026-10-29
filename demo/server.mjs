// LightNAS public demo — serves the real, unmodified NAS frontend with an isolated sample API.
// NEVER import src/server.mjs, access host daemons, mount disks, or proxy to a live NAS.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataFor } from './native-fixtures.mjs';

const demoRoot=dirname(fileURLToPath(import.meta.url));
const publicRoot=resolve(demoRoot,'../public');
const listenHost=process.env.LIGHTNAS_DEMO_HOST || '127.0.0.1';
const listenPort=Number(process.env.LIGHTNAS_DEMO_PORT || 3081);
if(!Number.isInteger(listenPort)||listenPort<0||listenPort>65535)throw Error('Invalid LIGHTNAS_DEMO_PORT');
const contentTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.webmanifest':'application/manifest+json','.json':'application/json'};
const bannerCss=`#lightnas-demo-indicator{position:fixed;z-index:2147483640;right:14px;top:68px;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 24px);padding:8px 11px;border:1px solid #258e49;background:#103520;color:#edfff1;box-shadow:0 7px 24px #0008;border-radius:9px;font:700 11px/1.3 system-ui,sans-serif;letter-spacing:.01em;pointer-events:none}#lightnas-demo-indicator i{width:7px;height:7px;border-radius:50%;background:#58e98b;flex:none}@media(max-width:760px){#lightnas-demo-indicator{top:56px;right:7px;font-size:10px;padding:6px 8px;max-width:70vw}}#lightnas-demo-indicator small{color:#c8ecd4;font-size:10px;font-weight:500}#lightnas-demo-indicator .demo-separator{opacity:.55}`;
const bannerJs=`(()=>{'use strict';const mount=()=>{if(document.getElementById('lightnas-demo-indicator'))return;const tag=document.createElement('div');tag.id='lightnas-demo-indicator';tag.setAttribute('role','status');tag.innerHTML='<i aria-hidden="true"></i><b>LIGHTNAS DEMO</b><span class="demo-separator">·</span><small>Simulated data · Read only</small>';document.body.appendChild(tag)};const label=()=>{document.querySelectorAll('.ln-live-state').forEach(el=>{if(el.textContent.includes('Live monitoring')){el.textContent='Sample system metrics'}})};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();new MutationObserver(label).observe(document.documentElement,{subtree:true,childList:true});})();`;
const decorateHtml=html=>html
 .replace('</head>','<link rel="stylesheet" href="/_demo/native.css"></head>')
 .replace('</body>','<script src="/_demo/native.js" defer></script></body>')
 .replace('<title>LightNAS — Control Center</title>','<title>LightNAS — Interactive Demo (Sample Data)</title>');
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
  if(method!=='GET'&&method!=='HEAD'){
    return error(res,method,403,'LightNAS public demo is read-only. No changes are saved or sent to a real appliance.');
  }
  let url;
  try{url=new URL(req.url,'http://lightnas.demo.local');}
  catch{return error(res,method,400,'Invalid URL');}
  const pathname=url.pathname;
  if(pathname==='/healthz')return sendJson(res,method,200,{status:'ok',mode:'native-frontend-demo',realFrontend:true,simulated:true});
  if(pathname==='/_demo/native.css')return send(res,method,200,'text/css; charset=utf-8',bannerCss);
  if(pathname==='/_demo/native.js')return send(res,method,200,'text/javascript; charset=utf-8',bannerJs);
  if(pathname==='/product-mode.js')return send(res,method,200,'text/javascript; charset=utf-8',"window.LIGHTNAS_PRODUCT_MODE='nas';\n");
  if(pathname==='/api/branding/logo'){
    try{return send(res,method,200,'image/png',await readFile(logo));}
    catch{return error(res,method,404,'Branding asset unavailable');}
  }
  if(pathname.startsWith('/api/')){
    if(pathname==='/api/catalog/icon')return error(res,method,404,'Sample app icons use fallback');
    const data=dataFor(pathname,url.searchParams);
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
