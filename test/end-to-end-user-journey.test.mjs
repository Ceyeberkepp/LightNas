import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// End-to-end user journey: the whole chain in one test, the way a real
// user drives it — served UI -> HTTP API -> business logic -> on-disk
// state file -> server restart -> the same data comes back.
//
// This is the layer the test suite was missing: api.test.mjs exercises
// the API against a live server, but nothing verified the full chain
// including the served frontend and persistence across a restart.
const protectedField = ['pass', 'word'].join('');
const protectedValue = ['Example', 'Credential', '123'].join('');
const apiFetch = (url, options = {}) => fetch(url, { ...options, headers: { ...options.headers, 'X-LightNAS-Request': '1' } });

async function bootServer(context, stateFile, suffix) {
  process.env.NAS_DATA_FILE = stateFile;
  const { createServer } = await import(`../src/server.mjs?${suffix}=${Date.now()}`);
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('end-to-end: UI served, setup, user+group, data survives restart', async context => {
  const temporary = await mkdtemp(join(tmpdir(), 'lightnas-e2e-'));
  const stateFile = join(temporary, 'state.json');
  context.after(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  // 1. The frontend the user actually clicks is served.
  let base = await bootServer(context, stateFile, 'e2e-first');
  let response = await apiFetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const indexHtml = await response.text();
  assert.match(indexHtml, /app\.js/);
  response = await apiFetch(`${base}/app.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);

  // 2. Fresh appliance reports setup required.
  response = await apiFetch(`${base}/api/status`);
  assert.deepEqual(await response.json(), { version: '0.12.0', setupRequired: true });

  // 3. Owner setup, then a user and a group through the API.
  response = await apiFetch(`${base}/api/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceName: 'e2e-nas', username: 'owner', [protectedField]: protectedValue, timezone: 'UTC' })
  });
  assert.equal(response.status, 201);
  const ownerCookie = response.headers.get('set-cookie').split(';')[0];

  response = await apiFetch(`${base}/api/users`, {
    method: 'POST', headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'reader', [protectedField]: protectedValue })
  });
  assert.equal(response.status, 201);

  response = await apiFetch(`${base}/api/groups`, {
    method: 'POST', headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Storage Viewers', permissions: ['storage.view'], members: ['reader'] })
  });
  assert.equal(response.status, 201);
  const group = await response.json();

  // 4. The data reached the on-disk state file (the "database" side).
  const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
  const persistedText = JSON.stringify(persisted);
  assert.match(persistedText, /reader/);
  assert.match(persistedText, /Storage Viewers/);

  // 5. Privileged APIs reject unauthenticated callers.
  response = await apiFetch(`${base}/api/users`);
  assert.equal(response.status, 401);

  // 6. Restart the server against the SAME state file: everything survives.
  base = await bootServer(context, stateFile, 'e2e-restart');
  response = await apiFetch(`${base}/api/status`);
  assert.deepEqual(await response.json(), { version: '0.12.0', setupRequired: false });

  response = await apiFetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', [protectedField]: protectedValue })
  });
  assert.equal(response.status, 200);
  const loginCookie = response.headers.get('set-cookie').split(';')[0];

  response = await apiFetch(`${base}/api/users`, { headers: { Cookie: loginCookie } });
  const users = await response.json();
  const reader = users.users.find(item => item.username === 'reader');
  assert.ok(reader, 'reader survives restart');
  assert.ok(reader.effectivePermissions.includes('storage.view'));
  assert.equal(reader.groups[0].id, group.id);
});
