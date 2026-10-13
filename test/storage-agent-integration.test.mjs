import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {storageAgentRoute} from '../src/storage-agent-client.mjs';
test('storage broker allows only its typed endpoint surface',()=>{
 assert.equal(storageAgentRoute('/api/storage/agent/inventory','GET'),true);
 assert.equal(storageAgentRoute('/api/storage/agent/preview','POST'),true);
 assert.equal(storageAgentRoute('/api/storage/agent/../../network','POST'),false);
 assert.equal(storageAgentRoute('/api/storage/agent/jobs','DELETE'),false);
 assert.equal(storageAgentRoute('/api/storage/agent/jobs/arbitrary/approve','POST'),false);
});
test('storage console uses the existing session and complies with script CSP',async()=>{
 const html=await readFile(new URL('../public/storage-operations.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../public/storage-operations.js',import.meta.url),'utf8');
 assert.match(html,/src="\/storage-operations.js"/);assert.doesNotMatch(html,/<script>/);
 assert.match(js,/X-LightNAS-Request/);assert.doesNotMatch(js,/Bearer|localStorage|sessionStorage/);
});
test('existing LightNAS login gates root storage API and fails closed without installed agent',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'lightnas-storage-integration-'));
 process.env.NAS_DATA_FILE=join(dir,'state.json');
 process.env.LIGHTNAS_STORAGE_AGENT_TOKEN_FILE=join(dir,'missing-token');
 const {createServer}=await import('../src/server.mjs?storage-integration='+Date.now());
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 const request=(path,options={})=>fetch(base+path,{...options,headers:{'X-LightNAS-Request':'1',...options.headers}});
 assert.equal((await request('/api/storage/agent/inventory')).status,401);
 const setup=await request('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceName:'storage-test',username:'admin',password:'ExamplePass123',timezone:'UTC'})});
 assert.equal(setup.status,201);const cookie=setup.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/api/storage/agent/inventory',{headers:{Cookie:cookie}})).status,503);
 assert.equal((await request('/api/storage/agent/arbitrary',{headers:{Cookie:cookie}})).status,404);
 const user=await request('/api/users',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({username:'viewer',password:'ViewerPass123',permissions:['storage.view']})});assert.equal(user.status,201);
 const login=await request('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'viewer',password:'ViewerPass123'})});assert.equal(login.status,200);const viewerCookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/api/storage/agent/inventory',{headers:{Cookie:viewerCookie}})).status,403);
});
test('restricted host address discovery does not break appliance overview',async()=>{const {primaryNetworkAddress}=await import('../src/system.mjs');assert.deepEqual(primaryNetworkAddress(()=>{throw Error('restricted');}),{address:'',available:false});assert.deepEqual(primaryNetworkAddress(()=>({eth0:[{family:'IPv4',internal:false,address:'192.168.0.41'}]})),{address:'192.168.0.41',available:true});});
