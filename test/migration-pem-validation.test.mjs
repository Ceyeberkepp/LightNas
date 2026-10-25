import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../src/migration-discovery.mjs',import.meta.url),'utf8');
test('public PEM validator uses actual whitespace escapes for multiline certificates',()=>{
 assert.ok(code.includes(String.raw`BEGIN CERTIFICATE-----\s*`));
 assert.ok(code.includes(String.raw`[A-Za-z0-9+/=\s]+`));
 assert.ok(!code.includes(String.raw`BEGIN CERTIFICATE-----\\s*`));
});
test('private keys remain disallowed',()=>{
 assert.ok(code.includes('Provide a valid PEM CA certificate, not a private key'));
});
