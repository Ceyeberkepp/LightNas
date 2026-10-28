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
  if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost')) throw Object.assign(new Error('loopback destinations are forbidden'),{status:400});
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
async function proxmoxPasswordSession(base, username, password, secondFactor='') {
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
    const first = JSON.parse(raw)?.data || {};
    let ticket = first.ticket;
    if(first.NeedTFA || (typeof ticket==='string'&&ticket.includes('!tfa!'))){
      const available=typeof first.NeedTFA==='string'?first.NeedTFA:'';
      if(!secondFactor)throw Object.assign(new Error('Proxmox needs your second factor. For YubiKey OTP, touch the key in the code field. FIDO2/WebAuthn touch requires a different browser authentication flow.'),{status:428});
      if(!/^[A-Za-z0-9]{6,80}$/.test(secondFactor))throw Object.assign(new Error('Invalid Proxmox security-key or TOTP code'),{status:400});
      const authType=secondFactor.length>=32?'yubico':'totp';
      const finish=await fetch(new URL('api2/json/access/ticket',base),{
       method:'POST',redirect:'error',signal:controller.signal,
       headers:{'Content-Type':'application/x-www-form-urlencoded'},
       body:new URLSearchParams({username,'tfa-challenge':ticket,password:authType+':'+secondFactor})
      });
      if(!finish.ok)throw Object.assign(new Error('Proxmox rejected the two-factor response'),{status:401});
      const answer=await finish.text();if(answer.length>10000)throw new Error('2FA reply too large');
      ticket=JSON.parse(answer)?.data?.ticket;
    }
    if (typeof ticket !== 'string' || !/^PVE:[A-Za-z0-9_-]+:.{1,2000}$/.test(ticket)) throw new Error('Proxmox did not return a valid login ticket');
    return {Cookie:'PVEAuthCookie='+ticket};
  } finally {clearTimeout(timeout);}
}
// Modern TrueNAS SCALE (25.04+) JSON-RPC 2.0; password is sent only after TLS pin check.
async function truenasJsonRpcInventory(base, username, password, caCertificate='', trustedFingerprint='', otpToken='') {
 if(otpToken && !/^[0-9]{6,10}$/.test(otpToken)) throw Object.assign(new Error('Enter a valid one-time authentication code'),{status:400});
 if(!/^[A-Za-z0-9_.@-]{1,100}$/.test(username)||!password||password.length>1024)
   throw Object.assign(new Error('TrueNAS username and password required'),{status:400});
 const endpoint=new URL('/api/current',base);endpoint.protocol='wss:';
 return await new Promise((resolve,reject)=>{
  let done=false,authed=false,pinned=!trustedFingerprint;
  const pending=new Map(), lists={};
  const required=['pool.query','sharing.smb.query','vm.query'];
  const optional=['app.query','virt.instance.query','interface.query'];
  const socket=new WebSocket(endpoint,{handshakeTimeout:10000,maxPayload:2*1024*1024,
   ...(caCertificate?{ca:caCertificate}:{}),...(trustedFingerprint?{rejectUnauthorized:false}:{})});
  const timer=setTimeout(()=>finish(Object.assign(new Error('TrueNAS modern API timed out'),{status:504})),25000);
  function finish(error,result){if(done)return;done=true;clearTimeout(timer);socket.terminate();error?reject(error):resolve(result);}
  function call(method,params=[]){const id=randomUUID();pending.set(id,method);socket.send(JSON.stringify({jsonrpc:'2.0',id,method,params}));}
  function maybeFinish(){
   if(![...required,...optional].every(x=>Object.hasOwn(lists,x)))return;
   finish(null,[...mapItems(lists['pool.query'],'storage','truenas-pool'),
    ...mapItems(lists['sharing.smb.query'],'share','truenas-smb'),
    ...mapItems(lists['vm.query'],'vm','truenas-vm'),
    ...mapItems(lists['app.query'],'app','truenas-app'),
    ...mapItems(lists['virt.instance.query'],'container','truenas-instance'),
    ...mapItems(lists['interface.query'],'network','truenas-interface')]);
  }
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
   if(response.error){
    if(optional.includes(method)){lists[method]=[];maybeFinish();return;}
    return finish(Object.assign(new Error(method==='auth.login_ex'?'TrueNAS API authentication method failed':'TrueNAS API inventory permission or method failed'),{status:method==='auth.login_ex'?401:409}));
   }
   if(method==='auth.login_ex'||method==='auth.login_ex_continue'){
    const status=response.result?.response_type;
    if(status==='OTP_REQUIRED' && method==='auth.login_ex' && otpToken){
      call('auth.login_ex_continue',[{mechanism:'OTP_TOKEN',otp_token:otpToken}]);return;
    }
    if(status!=='SUCCESS')return finish(Object.assign(new Error(status==='OTP_REQUIRED'?'TrueNAS requires a current two-factor authentication code.':status==='AUTH_ERR'?'TrueNAS rejected the login or one-time code.':'TrueNAS authentication not completed: '+String(status||'unknown')),{status:status==='OTP_REQUIRED'?428:401}));
    authed=true;
    for(const name of [...required,...optional])call(name);
    return;
   }
   if(!authed||!Array.isArray(response.result)){
    if(optional.includes(method)){lists[method]=[];maybeFinish();return;}
    return finish(Object.assign(new Error('Invalid TrueNAS inventory'),{status:409}));
   }
   lists[method]=response.result;maybeFinish();
  });
 });
}
async function vmwarePasswordSession(base,username,password) {
 if(!username||username.length>128||!password||password.length>1024)
  throw Object.assign(new Error('vCenter username and password required'),{status:400});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try {
  const credentials=Buffer.from(username+':'+password).toString('base64');
  const response=await fetch(new URL('api/session',base),{
   method:'POST',headers:{Authorization:'Basic '+credentials},
   redirect:'error',signal:controller.signal
  });
  if(response.status===401||response.status===403)
   throw Object.assign(new Error('vCenter rejected the username or password'),{status:401});
  if(!response.ok)throw Object.assign(new Error('vCenter session API unavailable ('+response.status+')'),{status:409});
  const body=await response.text();
  if(body.length>4096)throw Object.assign(new Error('Invalid vCenter session reply'),{status:409});
  const session=JSON.parse(body);
  if(typeof session!=='string'||!session||session.length>2048)
   throw Object.assign(new Error('Invalid vCenter session ID'),{status:409});
  return session;
 }finally{clearTimeout(timer);}
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
    type,
    hardware: {
      cpuCount: Number.isSafeInteger(x.cpu_count) && x.cpu_count>0 ? x.cpu_count :
        Number.isSafeInteger(x.maxcpu) && x.maxcpu>0 ? x.maxcpu :
        Number.isSafeInteger(x.vcpus) && x.vcpus>0 ? x.vcpus : null,
      memoryMiB: Number.isSafeInteger(x.memory_size_MiB) && x.memory_size_MiB>0 ? x.memory_size_MiB :
        Number.isFinite(x.maxmem) && x.maxmem>0 ? Math.round(x.maxmem/1048576) : null,
      state: ['running','stopped','paused','suspended','POWERED_ON','POWERED_OFF'].includes(x.power_state||x.status)
        ? (x.power_state||x.status) : null,
      host: /^[A-Za-z0-9_.-]{1,100}$/.test(x.node||'') ? x.node : null
    }
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
  const otpToken = typeof input?.otpToken === 'string' ? input.otpToken.trim() : '';
  const proxmoxSecondFactor = typeof input?.proxmoxSecondFactor === 'string' ? input.proxmoxSecondFactor.trim() : '';
  if (caCertificate && (caCertificate.length > 16384 || !/^-----BEGIN CERTIFICATE-----\s*[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----$/.test(caCertificate))) throw Object.assign(new Error('Provide a valid PEM CA certificate, not a private key.'), {status:400});
  if (!/^[a-zA-Z0-9.:-]{1,253}$/.test(host) || (!['proxmox','truenas','vmware'].includes(source) && !token) || token.length > 2048) throw new Error('source hostname and scoped token required');
  if (host.includes('..') || host.includes('@') || host.includes('/') || host.includes('#')) throw new Error('invalid source host');
  if (!token && !(username && password)) throw Object.assign(new Error('Source username/password or scoped token required'),{status:400});
  try { await assertInternal(host); }
  catch(error) { if(error.status)throw error; throw Object.assign(new Error('Cannot resolve the source host from LightNAS. Check its address and DNS.'),{status:400}); }
  const port = source === 'proxmox' ? 8006 : source === 'truenas' ? 443 : 443;
  const base = 'https://' + (isIP(host) === 6 ? '[' + host + ']' : host) + ':' + port + '/';
  let items = [];
  if (source === 'proxmox') {
    const headers = username && password ? await proxmoxPasswordSession(base, username, password, proxmoxSecondFactor) : { Authorization: 'PVEAPIToken=' + token };
    if(!token && !(username && password)) throw new Error('Proxmox username/password or API token required');
    const result = await jsonRequest(base, 'api2/json/cluster/resources', headers);
    const rows = result?.data || [];
    items = [
      ...mapItems(rows.filter(x => x.type === 'qemu'), 'vm', 'qemu'),
      ...mapItems(rows.filter(x => x.type === 'lxc'), 'container', 'lxc'),
      ...mapItems(rows.filter(x => x.type === 'storage'), 'storage', 'storage'),
      ...mapItems(rows.filter(x => x.type === 'network'), 'network', 'proxmox-network')
    ];
  } else if (source === 'vmware') {
    const session = username && password ? await vmwarePasswordSession(base,username,password) : token;
    if(!session)throw Object.assign(new Error('vCenter credentials or session ID required'),{status:400});
    const headers = { 'vmware-api-session-id': session };
    const [vms, datastores, networks] = await Promise.all([
      jsonRequest(base, 'api/vcenter/vm', headers),
      jsonRequest(base, 'api/vcenter/datastore', headers),
      jsonRequest(base, 'api/vcenter/network', headers)
    ]);
    items = [
      ...mapItems((vms || []).map(x => ({ id: x.vm, name: x.name, power_state: x.power_state, cpu_count: x.cpu_count, memory_size_MiB: x.memory_size_MiB })), 'vm', 'vmware-vm'),
      ...mapItems((datastores || []).map(x => ({ id: x.datastore, name: x.name })), 'storage', 'vmware-datastore'),
      ...mapItems((networks || []).map(x => ({ id: x.network, name: x.name })), 'network', 'vmware-network')
    ];
  } else if(source==='truenas' && username && password){
    items=await truenasJsonRpcInventory(base,username,password,caCertificate,trustedFingerprint,otpToken);
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
  const counts = Object.fromEntries(['vm','container','app','storage','share','network'].map(type=>[type,items.filter(item=>item.type===type).length]));
  const coverage = source==='proxmox' ? {vm:'scanned',container:'scanned',app:'not-provided-by-api'}
    : source==='vmware' ? {vm:'scanned',container:'not-native-to-vcenter',app:'not-native-to-vcenter'}
    : {vm:'scanned',container:username&&password?'scanned-if-supported':'not-scanned-by-token-connector',
       app:username&&password?'scanned-if-supported':'not-scanned-by-token-connector'};
  // A discovery response is an inventory, not confirmation of migration support.
  return { source, items, counts, coverage, discoveryOnly: true, credentialsStored: false, capabilities: supportedMigrationSources().find(x => x.id === source) };
}
export function previewMigrationManifest(input) {
  return planMigration(input);
}
