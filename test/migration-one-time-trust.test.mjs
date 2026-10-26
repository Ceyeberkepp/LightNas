import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../src/migration-discovery.mjs',import.meta.url),'utf8');
const js=readFileSync(new URL('../public/migration-wizard.js',import.meta.url),'utf8');
test('untrusted server requires explicit approval before credentials are submitted',()=>{
 assert.match(js,/window\.confirm\(/);
 assert.match(js,/No password was sent/);
 assert.match(js,/data\.trustedFingerprint=certificate\.sha256Fingerprint/);
 assert.ok(js.indexOf('window.confirm(')<js.indexOf("const result=await post('/api/migration/inspect',data)"));
});
test('TLS pin is validated before TrueNAS authentication handshake',()=>{
 assert.match(api,/fingerprint256/);
 assert.match(api,/peerPinned/);
 assert.match(api,/Source certificate changed or expired/);
 assert.match(api,/trustedFingerprint \? \{rejectUnauthorized:false\}/);
 assert.match(api,/const trustedFingerprint = typeof input\?\.trustedFingerprint/);
});
