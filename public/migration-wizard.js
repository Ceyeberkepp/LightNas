const el=id=>document.getElementById(id);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
let inventory=[], tokenMode=false;
function show(n){for(let i=1;i<=3;i++){el(['connect-panel','scan-panel','review-panel'][i-1]).classList.toggle('hidden',i!==n);el('step'+i).classList.toggle('active',i===n)}}
function auth(){const source=el('source').value;const isProxmox=source==='proxmox';const passwordSupported=['proxmox','truenas','vmware'].includes(source);el('user-fields').classList.toggle('hidden',!passwordSupported||tokenMode);el('token-row').classList.toggle('hidden',passwordSupported&&!tokenMode);el('auth-toggle').classList.toggle('hidden',!passwordSupported);el('auth-toggle').textContent=tokenMode?'Use username and password':'Use API token instead';el('auth-help').textContent=isProxmox?'Proxmox: use server username/password or an API token. Passwords are used only for this scan and are not stored.':source==='redhat'?'Red Hat currently requires a locally exported inventory; remote SSH login is not yet supported.':source==='vmware'?'VMware: enter vCenter username/password or use an API session ID; TLS certificate validation is required.':'TrueNAS: use the same username and password as your TrueNAS dashboard, or switch to an API token. Trusted HTTPS is required.';el('ca-options').classList.toggle('hidden',source!=='truenas');el('scan').disabled=source==='redhat';}
el('inspect-certificate').onclick=async()=>{
 const status=el('certificate-result');status.textContent='Checking source HTTPS identity without sending credentials…';
 try {
  const source=el('source').value;
  const port=source==='proxmox'?8006:443;
  const result=await post('/api/migration/certificate/inspect',{host:el('host').value.trim(),port});
  status.textContent='Certificate: '+(result.subject||'unnamed')+' · SHA-256 '+result.sha256Fingerprint+
    ' · SAN: '+(result.subjectAlternativeName||'none')+' · Trust: '+(result.trustedBySystem?'system trusted':'not yet trusted')+
    '. This inspection is not approval. Independently confirm the fingerprint before trusting the source.';
 }catch(error){status.textContent=error.message;}
};
el('source').addEventListener('change',()=>{tokenMode=false;auth()});el('auth-toggle').onclick=()=>{tokenMode=!tokenMode;auth()};
async function post(path,data){const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-LightNAS-Request':'1'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok){const error=new Error(result.error||'Request failed');error.status=response.status;throw error;}return result;}
el('scan').onclick=async()=>{el('scan').disabled=true;el('connect-status').textContent='Connecting and scanning (read-only)…';try{const data={source:el('source').value,host:el('host').value.trim()};if(['proxmox','truenas','vmware'].includes(data.source)&&!tokenMode){data.username=el('username').value.trim();data.password=el('password').value;}else data.token=el('token').value;if(data.source==='truenas'&&el('ca-certificate').value.trim())data.caCertificate=el('ca-certificate').value.trim();const certificate=await post('/api/migration/certificate/inspect',{
 host:data.host,port:data.source==='proxmox'?8006:443
});
el('certificate-result').textContent='Detected certificate: '+(certificate.subject||'unnamed')+
 ' · SHA-256 '+certificate.sha256Fingerprint+' · SAN: '+(certificate.subjectAlternativeName||'none')+
 ' · System trust: '+(certificate.trustedBySystem?'verified':'untrusted');
if(!certificate.trustedBySystem&&!data.caCertificate){
 if(data.source!=='truenas')throw Error('This source certificate is not trusted. Configure its issuing CA before submitting credentials.');
 const accepted=window.confirm(
  'One-time certificate approval for TrueNAS '+data.host+'\\n\\n'+
  'SHA-256 fingerprint: '+certificate.sha256Fingerprint+'\\n'+
  'Certificate name: '+(certificate.subject||'none')+'\\n'+
  'SAN: '+(certificate.subjectAlternativeName||'none')+'\\n\\n'+
  'Compare this fingerprint with the certificate shown directly on TrueNAS over a trusted channel. '+
  'Only approve if it matches. Approval applies to this scan only and is not saved.'
 );
 if(!accepted)throw Error('Connection cancelled. No password was sent.');
 data.trustedFingerprint=certificate.sha256Fingerprint;
}
el('connect-status').textContent='Certificate checked; scanning source…';
let result;
try {result=await post('/api/migration/inspect',data);}
catch(error) {
 if(data.source!=='truenas'||error.status!==428)throw error;
 const code=window.prompt('TrueNAS requires two-factor authentication. Enter the current 6–10 digit code from your authenticator:');
 if(code===null)throw Error('Two-factor authentication cancelled. No migration started.');
 if(!/^[0-9]{6,10}$/.test(code.trim()))throw Error('Enter a valid 6–10 digit authenticator code.');
 data.otpToken=code.trim();
 try {result=await post('/api/migration/inspect',data);}
 finally {delete data.otpToken;}
}
inventory=result.items||[];const counts=result.counts||{};const coverage=result.coverage||{};el('scan-status').textContent='Found '+(counts.vm||0)+' VMs, '+(counts.container||0)+' containers, '+(counts.app||0)+' apps. Coverage: '+Object.entries(coverage).map(([k,v])=>k+' '+v).join(' · ');if(!inventory.length)throw Error('Connected, but no migration objects were returned');el('transfer-network-settings').checked=false;el('results').innerHTML='<table><thead><tr><th>Select</th><th>Workload</th><th>Type</th></tr></thead><tbody>'+inventory.map((x,i)=>'<tr><td><input aria-label="Select '+esc(x.name)+'" type="checkbox" data-workload="'+i+'" checked></td><td>'+esc(x.name)+'</td><td>'+esc(x.type)+(x.type==='network'?' (optional)':'')+'</td></tr>').join('')+'</tbody></table>';el('connect-status').textContent=inventory.length+' objects found';show(2);}catch(e){el('connect-status').textContent=e.message;el('connect-status').className='danger'}finally{el('password').value='';el('token').value='';el('scan').disabled=false;}};
let currentSelection=[];
let destinationPools=[];
async function loadDestinationPools(){
 const response=await fetch('/api/storage/pools',{credentials:'same-origin'});
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'Could not load LightNAS destination pools');
 destinationPools=(result.pools||[]).filter(p=>p.online===true&&p.writable===true);
}
function compatiblePools(type){
 const content=type==='vm'?'images':type==='container'?'rootdir':type==='storage'||type==='share'?'files':null;
 if(!content)return [];
 return destinationPools.filter(p=>Array.isArray(p.content)&&p.content.includes(content));
}

const mappingById=Object.create(null);
function renderMigrationPlan(result){
 el('summary').textContent=result.steps.length+' selected · '+result.blockers.length+' compatibility blockers';
 el('plan').innerHTML='<table><thead><tr><th>Object</th><th>Type</th><th>Destination mapping</th><th>Status</th></tr></thead><tbody>'+
 result.steps.map((step,i)=>'<tr><td>'+esc(step.name)+'</td><td>'+esc(step.type)+'</td><td>'+
 (step.type==='app'?'Application-specific migration adapter required':step.type==='network'?'Network interface mapping requires a separate destination network check':
 '<select data-mapping-index="'+i+'" aria-label="Destination pool for '+esc(step.name)+'"><option value="">Select an available LightNAS pool</option>'+compatiblePools(step.type).map(pool=>'<option value="'+esc(pool.id)+'"'+(mappingById[step.id]===pool.id?' selected':'')+'>'+esc(pool.name)+' ('+esc(pool.provider)+', '+Math.floor((pool.availableBytes||0)/1073741824)+' GiB free)</option>').join('')+'</select>')+
 '</td><td>'+esc(step.status)+'</td></tr>').join('')+'</tbody></table>';
 el('review-status').textContent=result.blockers.length?'Review mapping requirements before any transfer.':'Mappings recorded for review; no transfer has started.';
}
async function checkMigrationMappings(){
 const inputs=[...el('plan').querySelectorAll('[data-mapping-index]')];
 for(const input of inputs){
  const item=currentSelection[Number(input.dataset.mappingIndex)];
  if(item)mappingById[item.id]=input.value.trim();
 }
 const mappings=Object.create(null);
 for(const item of currentSelection){
  if(mappingById[item.id]&&!compatiblePools(item.type).some(pool=>pool.id===mappingById[item.id]))throw Error('Destination pool is not available or compatible for '+item.name);
  if(mappingById[item.id])mappings[item.id]={target:mappingById[item.id]};
 }
 const result=await post('/api/migration/plan',{source:el('source').value,items:currentSelection,mappings});
 renderMigrationPlan(result);
}
el('review').onclick=async()=>{
 const includeNetwork=el('transfer-network-settings').checked;
 currentSelection=[...document.querySelectorAll('[data-workload]:checked')]
   .map(x=>inventory[Number(x.dataset.workload)]).filter(x=>includeNetwork||x.type!=='network');
 if(!currentSelection.length){el('scan-status').textContent='Select at least one item';return;}
 el('scan-status').textContent='Preparing destination compatibility plan…';
 try{await loadDestinationPools();await checkMigrationMappings();show(3);}catch(e){el('scan-status').textContent=e.message;}
};
el('check-mappings').onclick=async()=>{
 el('check-mappings').disabled=true;
 try{await checkMigrationMappings();}catch(e){el('review-status').textContent=e.message;}
 finally{el('check-mappings').disabled=false;}
};
el('back1').onclick=()=>show(1);el('back2').onclick=()=>show(2);el('advanced').onclick=()=>{location.href='/migration-center.html'};auth();
