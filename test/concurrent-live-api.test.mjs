import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const password = 'Qualification-only-123!';
async function instance(t) {
  const dir = await mkdtemp(join(tmpdir(), 'lightnas-live-'));
  let child, base, output = '';
  const start = async () => {
    child = spawn(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e',
      "const {createServer}=await import('./src/server.mjs'); const server=createServer(); server.listen(0,'127.0.0.1',()=>console.log('READY:'+server.address().port));"], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, NAS_DATA_FILE: join(dir, 'state.json'), LIGHTNAS_HOST_SOCKET: join(dir, 'absent.sock') },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    for (let i = 0; i < 200; i++) {
      const match = output.match(/READY:(\d+)/);
      if (match) { base = `http://127.0.0.1:${match[1]}`; return; }
      if (child.exitCode !== null) throw new Error(output);
      await delay(25);
    }
    throw new Error(`Server startup timeout: ${output}`);
  };
  const stop = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    }
  };
  t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
  await start();
  const request = async (path, { method = 'GET', cookie, json, body, headers = {} } = {}) => {
    const r = await fetch(base + path, { method, signal: AbortSignal.timeout(15000),
      headers: { 'X-LightNAS-Request': '1', ...(cookie ? { Cookie: cookie } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json ? JSON.stringify(json) : body });
    const text = await r.text();
    return { status: r.status, text, headers: r.headers, cookie: r.headers.get('set-cookie')?.split(';')[0], json: () => JSON.parse(text) };
  };
  return { request, restart: async () => { await stop(); await start(); } };
}

test('simultaneous setup accepts exactly one owner', async t => {
  const app = await instance(t);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => app.request('/api/setup', {
    method: 'POST', json: { deviceName: 'race-nas', username: `owner${i}`, password }
  })));
  assert.equal(results.filter(r => r.status === 201).length, 1, JSON.stringify(results.map(r => r.status)));
  assert.equal(results.filter(r => r.status === 409).length, 7);
});

test('simultaneous duplicate user creation accepts exactly one account', async t => {
  const app = await instance(t);
  const { cookie } = await app.request('/api/setup', { method: 'POST', json: { deviceName: 'users-nas', username: 'owner', password } });
  const results = await Promise.all(Array.from({ length: 8 }, () => app.request('/api/users', {
    method: 'POST', cookie, json: { username: 'sameuser', password }
  })));
  assert.equal(results.filter(r => r.status === 201).length, 1, JSON.stringify(results.map(r => r.status)));
  assert.equal(results.filter(r => r.status === 409).length, 7);
  const users = await app.request('/api/users', { cookie });
  assert.equal(users.json().users.filter(u => u.username === 'sameuser').length, 1);
});

test('three isolated live instances: concurrent uploads, integrity, permissions, restart and rate limiting', { timeout: 60000 }, async t => {
  const apps = await Promise.all(Array.from({ length: 3 }, () => instance(t)));
  await Promise.all(apps.map(async (app, index) => {
    let r = await app.request('/api/setup', { method: 'POST', json: { deviceName: `instance-${index}`, username: 'owner', password } });
    assert.equal(r.status, 201); let cookie = r.cookie;
    const cookies = await Promise.all(['alice', 'bobby'].map(async username => {
      r = await app.request('/api/users', { method: 'POST', cookie, json: { username, password, permissions: ['files.view.own', 'files.own'] } });
      assert.equal(r.status, 201);
      r = await app.request('/api/login', { method: 'POST', json: { username, password } });
      assert.equal(r.status, 200); return r.cookie;
    }));
    const data = Array.from({ length: 32 }, (_, i) => `instance-${index}/file-${i}:` + 'payload'.repeat(2048));
    await Promise.all(data.map(async (body, i) => {
      const uploaded = await app.request(`/api/files?path=Documents/file-${i}.txt`, { method: 'PUT', cookie: cookies[0], body });
      assert.equal(uploaded.status, 201, uploaded.text);
    }));
    await Promise.all(data.map(async (body, i) => {
      const downloaded = await app.request(`/api/files/download?path=Documents/file-${i}.txt`, { cookie: cookies[0] });
      assert.equal(downloaded.status, 200); assert.equal(downloaded.text, body);
    }));
    r = await app.request('/api/files?all=1', { cookie: cookies[0] });
    assert.equal(r.status, 200); assert.equal(r.json().entries.length, 32);
    r = await app.request('/api/files/download?path=Documents/file-0.txt', { cookie: cookies[1] }); assert.equal(r.status, 404);
    r = await app.request('/api/users', { cookie: cookies[0] }); assert.equal(r.status, 403);
    r = await app.request('/api/files/download?path=../../state.json', { cookie: cookies[0] }); assert.equal(r.status, 400);
    r = await app.request('/api/profile', { cookie: 'lightnas_session=invalid' }); assert.equal(r.status, 401);
    r = await app.request('/api/files?path=Documents/file-0.txt', { method: 'PUT', cookie: cookies[0], body: 'overwrite' }); assert.equal(r.status, 409);
    r = await app.request('/api/files/download?path=Documents/file-0.txt', { cookie: cookies[0] }); assert.equal(r.text, data[0]);
    const chunkPath = 'Documents/chunked.bin';
    const chunkId = `qualification-${index}`;
    const chunkUrl = offset => `/api/files/chunk?path=${chunkPath}&uploadId=${chunkId}&offset=${offset}&total=8`;
    r = await app.request(chunkUrl(0), { method: 'PUT', cookie: cookies[0], body: 'abcd' }); assert.equal(r.status, 200);
    r = await app.request(chunkUrl(0), { method: 'PUT', cookie: cookies[0], body: 'abcd' }); assert.equal(r.status, 200);
    r = await app.request(chunkUrl(6), { method: 'PUT', cookie: cookies[0], body: 'gh' }); assert.equal(r.status, 409);
    r = await app.request(chunkUrl(4), { method: 'PUT', cookie: cookies[0], body: 'efgh' }); assert.equal(r.status, 201);
    r = await app.request(`/api/files/download?path=${chunkPath}`, { cookie: cookies[0] }); assert.equal(r.text, 'abcdefgh');
    r = await app.request(`/api/files/download?path=${chunkPath}`, { cookie: cookies[0], headers: { Range: 'bytes=2-5' } }); assert.equal(r.status, 206); assert.equal(r.text, 'cdef');
    r = await app.request(`/api/files/download?path=${chunkPath}`, { cookie: cookies[0], headers: { Range: 'bytes=20-30' } }); assert.equal(r.status, 416);
    r = await app.request('/api/files?path=Documents/chunked.bin', { method: 'DELETE', cookie: cookies[0], headers: { Origin: 'https://untrusted.invalid' } }); assert.equal(r.status, 403);
    r = await app.request('/api/files?path=Documents/chunked.bin', { method: 'DELETE', cookie: cookies[0] }); assert.equal(r.status, 200);
    r = await app.request('/api/users', { method: 'POST', cookie, body: '{broken', headers: { 'Content-Type': 'application/json' } }); assert.equal(r.status, 400);
    await app.restart();
    r = await app.request('/api/profile', { cookie }); assert.equal(r.status, 401);
    r = await app.request('/api/login', { method: 'POST', json: { username: 'alice', password } }); assert.equal(r.status, 200); cookie = r.cookie;
    r = await app.request('/api/files/download?path=Documents/file-0.txt', { cookie }); assert.equal(r.text, data[0]);
    r = await app.request('/api/files?all=1', { cookie }); assert.equal(r.json().entries.length, 32);
    const bursts = await Promise.all(Array.from({ length: 260 }, () => app.request('/api/status')));
    assert.ok(bursts.some(v => v.status === 429));
    assert.ok(bursts.every(v => v.status === 200 || v.status === 429));
    assert.ok(bursts.filter(v => v.status === 429).every(v => v.headers.get('retry-after') === '60'));
  }));
});
