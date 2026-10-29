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
test('Browser starts in demo with sample overview and without setup/login',async()=>{
  const status=await(await fetch(base+'/api/status')).json();
  assert.equal(status.setupRequired,false);
  const body=await(await fetch(base+'/api/overview')).json();
  assert.equal(body.appliance.role,'administrator');
  assert.equal(body.appliance.deviceName,'lightnas-demo');
  assert.equal(body.system.cpu.cores,8);
  assert.ok(body.storage.configuredPools.length);
  assert.equal((await(await fetch(base+'/api/users')).json()).users.length,3);
  assert.equal((await(await fetch(base+'/api/catalog/builtin')).json()).catalog.length,6);
});
test('Original file browser receives documented sample inventory',async()=>{
  const all=await(await fetch(base+'/api/files?all=1')).json();
  const listing=await(await fetch(base+'/api/files?path=Documents')).json();
  assert.ok(all.entries.some(f=>f.name==='Project Plan.pdf'&&f.supported));
  assert.ok(listing.entries.some(f=>f.name==='Welcome to LightNAS.txt'));
});
test('All mutation methods are prohibited for all routes',async()=>{
  for(const route of ['/api/network','/api/users','/api/files?path=Documents%2Fsecret','/api/catalog/jellyfin/install','/api/storage/pools','/api/logout','/']){
    for(const method of ['POST','PUT','PATCH','DELETE']){
      const response=await fetch(base+route,{method});
      assert.equal(response.status,403,method+' '+route);
    }
  }
});
test('No host files or backend endpoints can be reached',async()=>{
  for(const path of ['/src/server.mjs','/data/state.json','/.env','/api/login','/api/console/node','/api/storage/agent/format','/api/containers/exec']){
    const response=await fetch(base+path);
    assert.equal(response.status,404,path);
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
