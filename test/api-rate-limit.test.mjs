import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiRateLimiter} from '../src/api-rate-limit.mjs';

const peer = address => ({socket:{remoteAddress:address}});

test('authenticated file chunks do not exhaust the interactive API budget', () => {
  let time = 0;
  const allowed = createApiRateLimiter({clock:()=>time,normalLimit:2,uploadLimit:4});
  const request = peer('192.0.2.1');
  assert.equal(allowed(request), true);
  assert.equal(allowed(request), true);
  assert.equal(allowed(request), false);
  assert.equal(allowed(request, true), true);
  assert.equal(allowed(request, true), true);
  assert.equal(allowed(request, true), true);
  assert.equal(allowed(request, true), true);
  assert.equal(allowed(request, true), false);
  assert.equal(allowed(request), false);
  time = 60000;
  assert.equal(allowed(request), true);
  assert.equal(allowed(request, true), true);
});

test('unauthenticated chunks use the unchanged ordinary API budget', () => {
  const allowed = createApiRateLimiter({normalLimit:1,uploadLimit:3});
  const request = peer('198.51.100.2');
  assert.equal(allowed(request, false), true);
  assert.equal(allowed(request, false), false);
  assert.equal(allowed(request, true), true);
  assert.equal(allowed(peer('198.51.100.3'), false), true);
});

test('expired buckets are reclaimed but the peer table stays bounded', () => {
  let time = 0;
  const allowed = createApiRateLimiter({clock:()=>time,maxBuckets:1,normalLimit:1});
  assert.equal(allowed(peer('one')), true);
  assert.equal(allowed(peer('two')), false);
  time = 60000;
  assert.equal(allowed(peer('two')), true);
  assert.equal(allowed(peer('one')), false);
});

test('only signed-in sessions with file-write permission qualify for the upload lane', async () => {
  const {readFile} = await import('node:fs/promises');
  const source = await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
  assert.match(source,/url\.pathname === '\/api\/files\/chunk' \? localContext\(req\) : null/);
  assert.match(source,/\['files\.own', 'files\.write'\]\.some\(permission => hasPermission\(uploadContext\.permissions, permission\)\)/);
  assert.match(source,/apiRateAllowed\(req, authorizedChunk\)/);
});
