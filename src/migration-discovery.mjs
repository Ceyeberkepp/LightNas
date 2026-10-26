import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { planMigration, supportedMigrationSources } from './migration-planner.mjs';

// Read-only source inventory API. Never retain credentials or disable TLS checks.
function internal(address) {
  if (address.startsWith('10.') || address.startsWith('192.168.') || address.startsWith('127.')) return !address.startsWith('127.');
  if (address.startsWith('172.')) { const n = Number(address.split('.')[1]); return n >= 16 && n <= 31; }
  if (address.startsWith('fd') || address.startsWith('fc')) return true;
  return false;
}
async function assertInternal(host) {
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('loopback destinations are forbidden');
  const ips = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!ips.length || ips.some(ip => !internal(ip.address))) throw Object.assign(new Error('Source server must resolve only to private LAN addresses.'),{status:400});
}
async function jsonRequest(base, path, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(new URL(path, base), { method: 'GET', headers, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error('source inventory request rejected (' + response.status + ')');
    if (Number(response.headers.get('content-length') || 0) > 2000000) throw new Error('inventory response too large');
    const body = await response.text();
    if (body.length > 2000000) throw new Error('inventory response too large');
    return JSON.parse(body);
  } finally { clearTimeout(timer); }
}
async function proxmoxPasswordSession(base, username, password) {
  if (!/^[A-Za-z0-9_.@-]{1,100}$/.test(username) || !password || password.length > 1024) throw new Error('Valid Proxmox username and password required');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(new URL('api2/json/access/ticket', base), {
      method:'POST', redirect:'error', signal:controller.signal,
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({username,password})
    });
    if (!response.ok) throw new Error('Proxmox login rejected ('+response.status+')');
    const raw = await response.text();
    if (raw.length > 10000) throw new Error('Login response too large');
    const ticket = JSON.parse(raw)?.data?.ticket;
    if (typeof ticket !== 'string' || !/^PVE:[A-Za-z0-9_-]+:.{1,2000}$/.test(ticket)) throw new Error('Proxmox did not return a valid login ticket');
    return {Cookie:'PVEAuthCookie='+ticket};
  } finally {clearTimeout(timeout);}
}
// Modern TrueNAS SCALE (25.04+) JSON-RPC 2.0; password is sent only after TLS pin check.
async function truenasJsonRpcInventory(base, username, password, caCertificate='', trustedFingerprint='') {
 if(!/^[A-Za-z0-9_.@-]{1,100}$/.test(username)||!password||password.length>1024)
   throw Object.assign(new Error('TrueNAS username and password required'),{status:400});
 const endpoint=new URL('/api/current',base);endpoint.protocol='wss:';
 return await new Promise((resolve,reject)=>{
  let done=false,authed=false,pinned=!trustedFingerprint;
  const pending=new Map(), lists={};
  const socket=new WebSocket(endpoint,{handshakeTimeout:10000,maxPayload:2*1024*1024,
   ...(caCertificate?{ca:caCertificate}:{}),...(trustedFingerprint?{rejectUnauthorized:false}:{})});
  const timer=setTimeout(()=>finish(Object.assign(new Error('TrueNAS modern API timed out'),{status:504})),25000);
  function finish(error,result){if(done)return;done=true;clearTimeout(timer);socket.terminate();error?reject(error):resolve(result);}
  function call(method,params=[]){const id=randomUUID();pending.set(id,method);socket.send(JSON.stringify({jsonrpc:'2.0',id,method,params}));}
  socket.on('upgrade',response=>{
   if(!trustedFingerprint)return;
   const peer=response.socket?.getPeerCertificate?.();
   if(String(peer?.fingerprint256||'').toUpperCase()!==trustedFingerprint.toUpperCase()||
      Date.parse(peer?.valid_to||'')<=Date.now())
     return finish(Object.assign(new Error('Source TLS certificate differs from approved fingerprint'),{status:409}));
   pinned=true;
  });
  socket.on('open',()=>{
   if(!pinned)return finish(Object.assign(new Error('Certificate fingerprint could not be verified'),{status:409}));
   call('auth.login_ex',[{mechanism:'PASSWORD_PLAIN',username,password}]);
  });
  socket.on('error',e=>{
   const err=Object.assign(new Error('Modern TrueNAS API connection failed'),{status:409});
   if(['UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID'].includes(e?.code))
     err.message='TrueNAS certificate trust or hostname validation failed';
   finish(err);
  });
  socket.on('close',()=>finish(Object.assign(new Error('TrueNAS modern API disconnected'),{status:409})));
  socket.on('message',bytes=>{
   if(done)return;
   let response;try{response=JSON.parse(String(bytes));}catch{return finish(Object.assign(new Error('Invalid TrueNAS JSON-RPC response'),{status:409}));}
   if(response.jsonrpc!=='2.0'||!pending.has(String(response.id)))return;
   const method=pending.get(String(response.id));pending.delete(String(response.id));
   if(response.error)return finish(Object.assign(new Error(method==='auth.login_ex'?'TrueNAS API authentication method failed':'TrueNAS API inventory permission or method failed'),{status:method==='auth.login_ex'?401:409}));
   if(method==='auth.login_ex'){
    const status=response.result?.response_type;
    if(status!=='SUCCESS')return finish(Object.assign(new Error(status==='OTP_REQUIRED'?'TrueNAS account requires two-factor authentication; API OTP step is not implemented.':status==='AUTH_ERR'?'TrueNAS rejected the username or password.':'TrueNAS authentication not completed: '+String(status||'unknown')),{status:401}));
    authed=true;
    for(const name of ['pool.query','sharing.smb.query','vm.query'])call(name);
    return;
   }
   if(!authed||!Array.isArray(response.result))return finish(Object.assign(new Error('Invalid TrueNAS inventory'),{status:409}));
   lists[method]=response.result;
   if(['pool.query','sharing.smb.query','vm.query'].every(x=>Object.hasOwn(lists,x)))
    finish(null,[...mapItems(lists['pool.query'],'storage','truenas-pool'),...mapItems(lists['sharing.smb.query'],'share','truenas-smb'),...mapItems(lists['vm.query'],'vm','truenas-vm')]);
  });
 });
}
// TrueNAS legacy middleware WebSocket authentication, supported on SCALE through 25.10.
async function truenasPasswordInventory(base, username, password, caCertificate = '', trustedFingerprint = '') {
  if(!/^[A-Za-z0-9_.@-]{1,100}$/.test(username)||typeof password!=='string'||!password||password.length>1024)
    throw Object.assign(new Error('Enter both your TrueNAS username and password.'),{status:400});
  if (trustedFingerprint && !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(trustedFingerprint)) throw Object.assign(new Error('Invalid one-time server fingerprint'),{status:400});
  const endpoint=new URL('/websocket',base);
  endpoint.protocol='wss:';
  return await new Promise((resolve,reject)=>{
    const socket=new WebSocket(endpoint,{handshakeTimeout:10000,maxPayload:2*1024*1024,
      ...(caCertificate ? {ca:caCertificate} : {}),
      ...(trustedFingerprint ? {rejectUnauthorized:false} : {})});
    let settled=false,connected=false,authorized=false,peerPinned=!trustedFingerprint;
    const lists={};const ids={};let seq=0;
    const timeout=setTimeout(()=>finish(Object.assign(new Error('TrueNAS API did not respond within 25 seconds. Check address, API compatibility and firewall.'),{status:504})),25000);
    function finish(error,result){if(settled)return;settled=true;clearTimeout(timeout);socket.close();error?reject(error):resolve(result);}
    function method(name,params=[]){const id=String(++seq);ids[id]=name;socket.send(JSON.stringify({id,msg:'method',method:name,params}));}
    socket.on('upgrade',response=>{
      if(!trustedFingerprint)return;
      const cert=response.socket?.getPeerCertificate?.();
      const actual=String(cert?.fingerprint256||'').toUpperCase();
      const expires=Date.parse(cert?.valid_to||'');
      if(actual!==trustedFingerprint.toUpperCase()||!Number.isFinite(expires)||expires<=Date.now())
        return finish(Object.assign(new Error('Source certificate changed or expired. Trust approval is no longer valid.'),{status:409}));
      peerPinned=true;
    });
    socket.on('open',()=>{
      if(!peerPinned)return finish(Object.assign(new Error('Source certificate identity was not verified'),{status:409}));
      socket.send(JSON.stringify({msg:'connect',version:'1',support:['1']}));
    });
    socket.on('error',err=>{
      const code=String(err?.code||err?.cause?.code||'');
      const status=Number(err?.statusCode||0);
      const message=code==='ECONNREFUSED'?'TrueNAS refused the secure API connection. Check HTTPS port 443 and server address.'
        :code==='ETIMEDOUT'||code==='ENETUNREACH'||code==='EHOSTUNREACH'?'TrueNAS is unreachable from LightNAS. Check routing and firewall.'
        :['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)
          ?'TrueNAS HTTPS certificate is not trusted or does not match the server address. Configure a trusted certificate or CA on LightNAS.'
          :status===404||status===400?'The TrueNAS legacy WebSocket endpoint is unavailable on this version. A version-compatible API connector is required.'
          :'TrueNAS secure WebSocket failed. Check server certificate, API version and connectivity.';
      finish(Object.assign(new Error(message),{status:409}));
    });
    socket.on('close',()=>{if(!settled)finish(Object.assign(new Error('TrueNAS closed the discovery connection before inventory completed.'),{status:409}));});
    socket.on('message',bytes=>{
      if(settled)return;
      let reply;try{reply=JSON.parse(String(bytes));}catch{return finish(new Error('Invalid TrueNAS response'));}
      if(reply.msg==='connected'&&!connected){connected=true;method('auth.login',[username,password]);return;}
      if(reply.msg==='failed')return finish(Object.assign(new Error('TrueNAS rejected the legacy WebSocket protocol. This version may require JSON-RPC 2.0.'),{status:409}));
      if(reply.msg!=='result'||!Object.hasOwn(ids,String(reply.id)))return;
      const name=ids[String(reply.id)];delete ids[String(reply.id)];
      if(reply.error)return finish(Object.assign(new Error(name==='auth.login'?'TrueNAS login rejected by the API.':'TrueNAS API denied an inventory query or returned an unsupported method.'),{status:name==='auth.login'?401:409}));
      if(name==='auth.login'){
        if(reply.result!==true)return finish(Object.assign(new Error('TrueNAS rejected the username or password. Check login and API permissions.'),{status:401}));
        authorized=true;
        for(const query of ['pool.query','sharing.smb.query','vm.query'])method(query);
        return;
      }
      if(!authorized)return finish(new Error('Unauthenticated TrueNAS inventory'));
      if(!Array.isArray(reply.result))return finish(new Error('Invalid TrueNAS inventory result'));
      lists[name]=reply.result;
      if(['pool.query','sharing.smb.query','vm.query'].every(x=>Object.hasOwn(lists,x)))
        finish(null,[...mapItems(lists['pool.query'],'storage','truenas-pool'),...mapItems(lists['sharing.smb.query'],'share','truenas-smb'),...mapItems(lists['vm.query'],'vm','truenas-vm')]);
    });
  });
}
function mapItems(items, type, sourcePrefix) {
  return (Array.isArray(items) ? items : []).map((x, i) => ({
    id: String(sourcePrefix + ':' + (x.vmid ?? x.id ?? x.name ?? i)).slice(0, 128),
    name: String(x.name || x.hostname || x.volid || x.vmid || 'Unnamed source').slice(0, 120),
    type
  }));
}
export async function inspectMigrationSource(input) {
  const source = String(input?.source || '');
  if (!['proxmox','vmware','truenas','redhat'].includes(source)) throw new Error('unsupported source');
  if (source === 'redhat') throw new Error('Red Hat connection needs a local, reviewed libvirt/Podman inventory export; remote SSH credentials are not accepted by this endpoint.');
  const host = String(input?.host || '').trim();
  const token = String(input?.token || '').trim();
  const username = String(input?.username || '').trim();
  const password = typeof input?.password === 'string' ? input.password : '';
  const caCertificate = typeof input?.caCertificate === 'string' ? input.caCertificate.trim() : '';
  const trustedFingerprint = typeof input?.trustedFingerprint === 'string' ? input.trustedFingerprint.trim() : '';
  if (caCertificate && (caCertificate.length > 16384 || !/^-----BEGIN CERTIFICATE-----\s*[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----$/.test(caCertificate))) throw Object.assign(new Error('Provide a valid PEM CA certificate, not a private key.'), {status:400});
  if (!/^[a-zA-Z0-9.:-]{1,253}$/.test(host) || (!['proxmox','truenas'].includes(source) && !token) || token.length > 2048) throw new Error('source hostname and scoped token required');
  if (host.includes('..') || host.includes('@') || host.includes('/') || host.includes('#')) throw new Error('invalid source host');
  try { await assertInternal(host); }
  catch(error) { if(error.status)throw error; throw Object.assign(new Error('Cannot resolve the source host from LightNAS. Check its address and DNS.'),{status:400}); }
  const port = source === 'proxmox' ? 8006 : source === 'truenas' ? 443 : 443;
  const base = 'https://' + (isIP(host) === 6 ? '[' + host + ']' : host) + ':' + port + '/';
  let items = [];
  if (source === 'proxmox') {
    const headers = username && password ? await proxmoxPasswordSession(base, username, password) : { Authorization: 'PVEAPIToken=' + token };
    if(!token && !(username && password)) throw new Error('Proxmox username/password or API token required');
    const result = await jsonRequest(base, 'api2/json/cluster/resources', headers);
    const rows = result?.data || [];
    items = [
      ...mapItems(rows.filter(x => x.type === 'qemu'), 'vm', 'qemu'),
      ...mapItems(rows.filter(x => x.type === 'lxc'), 'container', 'lxc'),
      ...mapItems(rows.filter(x => x.type === 'storage'), 'storage', 'storage')
    ];
  } else if (source === 'vmware') {
    const headers = { 'vmware-api-session-id': token };
    const [vms, datastores, networks] = await Promise.all([
      jsonRequest(base, 'api/vcenter/vm', headers),
      jsonRequest(base, 'api/vcenter/datastore', headers),
      jsonRequest(base, 'api/vcenter/network', headers)
    ]);
    items = [
      ...mapItems((vms || []).map(x => ({ id: x.vm, name: x.name })), 'vm', 'vmware-vm'),
      ...mapItems((datastores || []).map(x => ({ id: x.datastore, name: x.name })), 'storage', 'vmware-datastore'),
      ...mapItems((networks || []).map(x => ({ id: x.network, name: x.name })), 'network', 'vmware-network')
    ];
  } else if(source==='truenas' && username && password){
    items=await truenasJsonRpcInventory(base,username,password,caCertificate,trustedFingerprint);
  } else {
    if(!token)throw new Error('TrueNAS username/password or API token required');
    const headers = { Authorization: 'Bearer ' + token };
    const [pools, shares, vms] = await Promise.all([
      jsonRequest(base, 'api/v2.0/pool', headers),
      jsonRequest(base, 'api/v2.0/sharing/smb', headers),
      jsonRequest(base, 'api/v2.0/vm', headers)
    ]);
    items = [
      ...mapItems(pools, 'storage', 'truenas-pool'),
      ...mapItems(shares, 'share', 'truenas-smb'),
      ...mapItems(vms, 'vm', 'truenas-vm')
    ];
  }
  if (items.length > 2000) throw new Error('inventory exceeds first-pass limit; narrow the migration scope');
  // A discovery response is an inventory, not confirmation of migration support.
  return { source, items, discoveryOnly: true, credentialsStored: false, capabilities: supportedMigrationSources().find(x => x.id === source) };
}
export function previewMigrationManifest(input) {
  return planMigration(input);
}
