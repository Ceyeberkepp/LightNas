import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requestUsesHttps} from '../src/trusted-request-transport.mjs';

const req = (peer, proto, encrypted=false) => ({
  socket:{remoteAddress:peer,encrypted},
  headers:proto === undefined ? {} : {'x-forwarded-proto':proto}
});

test('a directly encrypted HTTPS connection is trusted without proxy configuration', () => {
  assert.equal(requestUsesHttps(req('198.51.100.40', undefined, true)), true);
  assert.equal(requestUsesHttps(req('198.51.100.40', 'http', true)), true);
});

test('external clients cannot spoof HTTPS by setting forwarded protocol headers', () => {
  assert.equal(requestUsesHttps(req('198.51.100.40','https')), false);
  assert.equal(requestUsesHttps(req('::ffff:198.51.100.40','https')), false);
  assert.equal(requestUsesHttps(req('198.51.100.40',['https'])), false);
  assert.equal(requestUsesHttps(req('198.51.100.40','https'), '127.0.0.1,::1'), false);
});

test('only explicitly approved TCP peers can supply a single HTTPS proxy hint', () => {
  assert.equal(requestUsesHttps(req('127.0.0.1','https'), '127.0.0.1'), true);
  assert.equal(requestUsesHttps(req('::ffff:127.0.0.1','https'), '127.0.0.1'), true);
  assert.equal(requestUsesHttps(req('::1','https'), '::1'), true);
  assert.equal(requestUsesHttps(req('10.0.0.2','HTTPS'), '10.0.0.2'), true);
  assert.equal(requestUsesHttps(req('10.0.0.2','https'), '10.0.0.3'), false);
  for (const proto of ['http','https,http','http,https','https, https','https://evil','', ['https','https']]) {
    assert.equal(requestUsesHttps(req('127.0.0.1',proto),'127.0.0.1'), false, String(proto));
  }
});

test('invalid, empty or inherited settings fail closed', () => {
  for (const trust of ['', 'all', '*', 'localhost', '127.0.0.1/8', null]) {
    assert.equal(requestUsesHttps(req('127.0.0.1','https'),trust), false, String(trust));
  }
  assert.equal(requestUsesHttps(req(undefined,'https'), '127.0.0.1'), false);
  assert.equal(requestUsesHttps(req('127.0.0.1','https'), 'not an ip,127.0.0.1'), true);
});

test('session cookie decision is wired to authenticated request transport policy', () => {
  const server = readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
  assert.match(server,/import \{requestUsesHttps\} from '\.\/trusted-request-transport\.mjs'/);
  assert.match(server,/requestUsesHttps\(req, process\.env\.LIGHTNAS_TRUSTED_PROXY_IPS\)/);
  assert.match(server,/requestIsSecure\(req\) \? '; Secure' : ''/);
  assert.doesNotMatch(server,/return Boolean\(req\.socket\?\.encrypted\) \|\| forwarded === 'https'/);
});
