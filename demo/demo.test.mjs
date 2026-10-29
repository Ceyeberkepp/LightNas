import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const root=dirname(fileURLToPath(import.meta.url));
let child,base;
before(async()=>{
  child=spawn(process.execPath,[join(root,'server.mjs')],{
    env:{...process.env,LIGHTNAS_DEMO_HOST:'127.0.0.1',LIGHTNAS_DEMO_PORT:'0'},
    stdio:['ignore','pipe','pipe']
  });
  base=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Demo did not start')),10000);
    let output='';
    child.stdout.on('data',data=>{
      output+=String(data);
      const matched=output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if(matched){clearTimeout(timeout);resolve(matched[1]);}
    });
    child.on('error',err=>{clearTimeout(timeout);reject(err);});
    child.on('exit',code=>{clearTimeout(timeout);reject(Error('Demo exited early: '+code));});
  });
});
after(()=>{if(child && child.exitCode===null)child.kill();});

test('Serves the actual LightNAS frontend instead of the old imitation',async()=>{
  const response=await fetch(base+'/');
  const html=await response.text();
  const original=await readFile(join(root,'../public/index.html'),'utf8');
  assert.equal(response.status,200);
  for(const element of ['id="console"','id="sidebar-backdrop"','id="task-dock"','/design-v2.css','/workspace-pages.css','/app.js']){
    assert.ok(original.includes(element),'Missing real UI marker in source: '+element);
    assert.ok(html.includes(element),'Missing real UI marker in demo: '+element);
  }
  assert.match(html,/\/_demo\/native\.css/);
  assert.match(html,/\/_demo\/native\.js/);
  assert.doesNotMatch(html,/Sample NAS Control Center/);
});
test('Original frontend assets are served unchanged',async()=>{
  for(const path of ['/app.js','/design-v2.css','/workspace-pages.css','/workspace-navigation.js']){
    const response=await fetch(base+path);
    assert.equal(response.status,200,path);
    const original=await readFile(join(root,'../public',path),'utf8');
    assert.equal(await response.text(),original);
  }
});
async function signIn(username,password){
  const response=await fetch(base+'/api/login',{
    method:'POST',headers:{'Content-Type':'application/json','X-LightNAS-Request':'1'},
    body:JSON.stringify({username,password})
  });
  return {response,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
}
function requestWithCookie(path,cookie,options={}){
  return fetch(base+path,{...options,headers:{...options.headers,Cookie:cookie}});
}

test('Home page shows normal login form and publicly labeled demo roles',async()=>{
  const html=await(await fetch(base+'/')).text();
  assert.match(html,/id="login-form"/);
  assert.match(html,/data-demo-username="demo-admin"/);
  assert.match(html,/data-demo-username="demo-user"/);
  assert.match(html,/Never enter your real password/);
  assert.match(html,/Demo account sign-in/);
  assert.doesNotMatch(html,/auto.login|automatic sign.in/i);
});

test('No automatic authentication: overview requires a demo login',async()=>{
  assert.equal((await fetch(base+'/api/status')).status,200);
  assert.equal((await fetch(base+'/api/branding')).status,200);
  const response=await fetch(base+'/api/overview');
  assert.equal(response.status,401);
  assert.match((await response.json()).error,/Sign in/);
});

test('Demo sign-in rejects incorrect usernames and passwords',async()=>{
  assert.equal((await signIn('demo-admin','wrong')).response.status,401);
  assert.equal((await signIn('not-a-demo-user','LightNASUser2026!')).response.status,401);
  const noHeader=await fetch(base+'/api/login',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'demo-admin',password:'LightNASAdmin2026!'})
  });
  assert.equal(noHeader.status,403);
});

test('Administrator can sign in and view sample admin inventory',async()=>{
  const {response,cookie}=await signIn('demo-admin','LightNASAdmin2026!');
  assert.equal(response.status,200);
  assert.match(cookie,/^lightnas_demo_session=[0-9a-f]{64}$/);
  assert.match(response.headers.get('set-cookie'),/HttpOnly/);
  assert.match(response.headers.get('set-cookie'),/Secure/);
  const overview=await(await requestWithCookie('/api/overview',cookie)).json();
  assert.equal(overview.appliance.role,'administrator');
  assert.equal(overview.appliance.username,'demo-admin');
  assert.equal(overview.storage.configuredPools.length,1);
  assert.equal(overview.system.cpu.cores,8);
  const users=await requestWithCookie('/api/users',cookie);
  assert.equal(users.status,200);
  assert.equal((await users.json()).users.length,3);
  assert.equal((await(await requestWithCookie('/api/catalog/builtin',cookie)).json()).catalog.length,6);
  const all=await(await requestWithCookie('/api/files?all=1',cookie)).json();
  const listing=await(await requestWithCookie('/api/files?path=Documents',cookie)).json();
  assert.ok(all.entries.some(f=>f.name==='Project Plan.pdf'&&f.supported));
  assert.ok(listing.entries.some(f=>f.name==='Welcome to LightNAS.txt'));
});

test('Regular user has restricted role and cannot use admin APIs',async()=>{
  const {response,cookie}=await signIn('demo-user','LightNASUser2026!');
  assert.equal(response.status,200);
  const body=await(await requestWithCookie('/api/overview',cookie)).json();
  assert.equal(body.appliance.role,'user');
  assert.equal(body.appliance.username,'demo-user');
  assert.ok(body.appliance.permissions.includes('files.view.own'));
  assert.ok(!body.appliance.permissions.includes('users.manage'));
  assert.equal((await requestWithCookie('/api/files?all=1',cookie)).status,200);
  for(const path of ['/api/users','/api/groups','/api/network','/api/runtimes','/api/storage/pools']){
    assert.equal((await requestWithCookie(path,cookie)).status,403,path);
  }
});

test('Only demo login/logout allow mutations; no NAS changes are allowed',async()=>{
  const {cookie}=await signIn('demo-admin','LightNASAdmin2026!');
  for(const route of ['/api/network','/api/users','/api/files?path=Documents%2Fsecret','/api/catalog/jellyfin/install','/api/storage/pools','/']){
    for(const method of ['POST','PUT','PATCH','DELETE']){
      const response=await requestWithCookie(route,cookie,{method});
      assert.equal(response.status,403,method+' '+route);
    }
  }
  assert.equal((await requestWithCookie('/api/logout',cookie,{method:'POST',headers:{'X-LightNAS-Request':'1'}})).status,200);
  assert.equal((await requestWithCookie('/api/overview',cookie)).status,401);
});

test('Unrecognized host and API routes never expose live services',async()=>{
  const {cookie}=await signIn('demo-admin','LightNASAdmin2026!');
  for(const path of ['/src/server.mjs','/data/state.json','/.env','/api/console/node','/api/storage/agent/format','/api/containers/exec']){
    assert.equal((await requestWithCookie(path,cookie)).status,404,path);
  }
});

test('Demo label, browser policy, and health endpoint are present',async()=>{
  const health=await(await fetch(base+'/healthz')).json();
  assert.equal(health.mode,'native-frontend-demo');
  assert.equal(health.realFrontend,true);
  assert.equal(health.simulated,true);
  const label=await(await fetch(base+'/_demo/native.js')).text();
  assert.match(label,/LIGHTNAS DEMO/);
  assert.match(label,/Simulated data/);
  const response=await fetch(base+'/');
  assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);
  assert.equal(response.headers.get('x-frame-options'),'DENY');
  assert.equal(response.headers.get('cache-control'),'no-store');
});
