import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {once} from 'node:events';

const password='Isolation-only-NotForProduction-2026!';
const checksum=input=>createHash('sha256').update(input).digest('hex');

async function launchInstance(t,index) {
  const root=await mkdtemp(join(tmpdir(),'lightnas-multi-soak-'));
  let child,output='',base;
  const stop=async()=>{
    if(child && child.exitCode===null && child.signalCode===null) {
      const exited=once(child,'exit');
      child.kill('SIGKILL');
      await exited;
    }
  };
  const start=async()=>{
    output='';
    child=spawn(process.execPath,['--max-old-space-size=256','--input-type=module','-e',
      "const {createServer}=await import('./src/server.mjs'); const s=createServer(); s.listen(0,'127.0.0.1',()=>console.log('READY:'+s.address().port))"],{
      cwd:new URL('..',import.meta.url),
      env:{...process.env,NAS_DATA_FILE:join(root,'state.json'),
        LIGHTNAS_HOST_SOCKET:join(root,'host-agent-unavailable.sock')},
      stdio:['ignore','pipe','pipe']
    });
    child.stdout.on('data',chunk=>{output+=chunk;});
    child.stderr.on('data',chunk=>{output+=chunk;});
    for(let retry=0;retry<300;retry++){
      const match=output.match(/READY:(\d+)/);
      if(match){base='http://127.0.0.1:'+match[1];return;}
      if(child.exitCode!==null)throw Error('Isolated process failed: '+output.slice(-1500));
      await sleep(30);
    }
    throw Error('Isolated process startup timed out: '+output.slice(-1500));
  };
  t.after(async()=>{await stop();await rm(root,{recursive:true,force:true});});
  await start();
  async function request(path,{method='GET',cookie,json,body}={}){
    const response=await fetch(base+path,{
      method,signal:AbortSignal.timeout(20000),
      headers:{'X-LightNAS-Request':'1',
        ...(cookie?{Cookie:cookie}:{}),
        ...(json?{'Content-Type':'application/json'}:{})},
      body:json?JSON.stringify(json):body
    });
    const buffer=Buffer.from(await response.arrayBuffer());
    return {status:response.status,bytes:buffer,cookie:response.headers.get('set-cookie')?.split(';')[0],
      json:()=>JSON.parse(buffer.toString('utf8'))};
  }
  return {request,restart:async()=>{await stop();await start();},index};
}

test('4 isolated instances: mixed users, parallel file integrity, ACL, restart and malformed requests',
  {timeout:120000},async t=>{
    const instances=await Promise.all(Array.from({length:4},(_,i)=>launchInstance(t,i)));
    await Promise.all(instances.map(async app=>{
      const setup=await app.request('/api/setup',{method:'POST',
        json:{deviceName:'load-test-'+app.index,username:'owner',password}});
      assert.equal(setup.status,201);
      assert.ok(setup.cookie);
      const users=await Promise.all(['alice','bobby','carol'].map(async username=>{
        const created=await app.request('/api/users',{method:'POST',cookie:setup.cookie,
          json:{username,password,permissions:['files.view.own','files.own']}});
        assert.equal(created.status,201);
        const login=await app.request('/api/login',{method:'POST',json:{username,password}});
        assert.equal(login.status,200);
        return {name:username,cookie:login.cookie};
      }));
      const fileSpecs=users.flatMap((user,u)=>Array.from({length:28},(_,i)=>({
        user,relative:'Documents/soak-'+app.index+'-'+u+'-'+i+'.bin',
        data:Buffer.from(('app:'+app.index+':user:'+user.name+':file:'+i+':').repeat(160))
      })));
      // 84 uploads, 84 downloads per appliance: under the normal 240/minute
      // budget, and every disk write remains within temporary isolated state.
      const uploaded=await Promise.all(fileSpecs.map(async item=>{
        const r=await app.request('/api/files?path='+encodeURIComponent(item.relative),{
          method:'PUT',cookie:item.user.cookie,body:item.data
        });
        return r.status;
      }));
      assert.ok(uploaded.every(code=>code===201),JSON.stringify(uploaded));
      const downloaded=await Promise.all(fileSpecs.map(async item=>{
        const r=await app.request('/api/files/download?path='+encodeURIComponent(item.relative),{
          cookie:item.user.cookie
        });
        assert.equal(r.status,200);
        assert.equal(checksum(r.bytes),checksum(item.data));
        return r.status;
      }));
      assert.equal(downloaded.length,84);
      const cross=await app.request('/api/files/download?path='+encodeURIComponent(fileSpecs[0].relative),{
        cookie:users[1].cookie
      });
      assert.equal(cross.status,404,'one user must not access another user library');
      const unauthorized=await app.request('/api/files?all=1',{cookie:'nas_session=invalid'});
      assert.equal(unauthorized.status,401);
      const repeated=await app.request('/api/files?path='+encodeURIComponent(fileSpecs[0].relative),{
        method:'PUT',cookie:users[0].cookie,body:Buffer.from('must never overwrite')
      });
      assert.equal(repeated.status,409);
      const malformed=await app.request('/api/users',{method:'POST',cookie:setup.cookie,
        body:'{malformed',json:undefined});
      assert.equal(malformed.status,400);
      await app.restart();
      const stale=await app.request('/api/profile',{cookie:setup.cookie});
      assert.equal(stale.status,401,'reboot invalidates old sessions');
      const login=await app.request('/api/login',{method:'POST',json:{username:users[2].name,password}});
      assert.equal(login.status,200);
      const before=fileSpecs.find(item=>item.user.name===users[2].name);
      const persisted=await app.request('/api/files/download?path='+encodeURIComponent(before.relative),{
        cookie:login.cookie
      });
      assert.equal(persisted.status,200);
      assert.equal(checksum(persisted.bytes),checksum(before.data));
    }));
  });
