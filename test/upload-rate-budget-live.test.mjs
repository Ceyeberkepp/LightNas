import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

test('live upload burst preserves browsing budget and rejects unauthenticated chunks', {timeout: 60000}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'lightnas-chunk-budget-'));
  const child = spawn(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e',
    "const {createServer}=await import('./src/server.mjs'); const s=createServer(); s.listen(0,'127.0.0.1',()=>console.log('READY:'+s.address().port));"
  ], {
    cwd: new URL('..', import.meta.url),
    env: {...process.env, NAS_DATA_FILE:join(dir,'state.json'), LIGHTNAS_HOST_SOCKET:join(dir,'absent.sock')},
    stdio:['ignore','pipe','pipe']
  });
  let output = '';
  child.stdout.on('data', value => { output += value; });
  child.stderr.on('data', value => { output += value; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    }
    await rm(dir, {recursive:true,force:true});
  });
  let base;
  for (let n=0; n<200; n++) {
    const match = output.match(/READY:(\d+)/);
    if (match) { base = `http://127.0.0.1:${match[1]}`; break; }
    if (child.exitCode !== null) throw Error(output);
    await delay(25);
  }
  assert.ok(base, `Server startup failed: ${output}`);
  const request = async (path, {method='GET',cookie,json,body}={}) => {
    const response = await fetch(base+path, {
      method, signal:AbortSignal.timeout(15000),
      headers:{'X-LightNAS-Request':'1', ...(cookie?{Cookie:cookie}:{}), ...(json?{'Content-Type':'application/json'}:{})},
      body:json?JSON.stringify(json):body
    });
    await response.arrayBuffer();
    return {status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const owner = await request('/api/setup', {
    method:'POST',json:{deviceName:'mobile-burst-nas',username:'owner',password:'Qualification-only-123!'}
  });
  assert.equal(owner.status,201);
  assert.ok(owner.cookie);
  // Malformed upload identifiers are rejected before a file is created, but
  // still exercise the authenticated chunk route and its rate limit.
  const url='/api/files/chunk?path=Documents%2Fdiscard.bin&uploadId=no&offset=0&total=1';
  const authenticated = await Promise.all(Array.from({length:260},()=>
    request(url,{method:'PUT',cookie:owner.cookie,body:'x'})));
  assert.ok(authenticated.every(x=>x.status===400), JSON.stringify(authenticated.map(x=>x.status)));
  assert.equal((await request('/api/status')).status,200,
    'Authenticated chunk attempts must not starve the interactive API lane');
  const unauthorized = await Promise.all(Array.from({length:260},()=>
    request(url,{method:'PUT',cookie:'nas_session=invalid',body:'x'})));
  assert.ok(unauthorized.some(x=>x.status===401));
  assert.ok(unauthorized.some(x=>x.status===429),
    'Invalid sessions must remain subject to ordinary 240/minute protection');
  assert.ok(unauthorized.every(x=>[401,429].includes(x.status)));
});
