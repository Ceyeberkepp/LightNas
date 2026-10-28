import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../src/migration-discovery.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/migration-wizard.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../public/migration-wizard.js',import.meta.url),'utf8');
test('TLS trust is explicit and verification cannot be disabled',()=>{
 assert.match(api,/caCertificate \? \{ca:caCertificate\} : \{\}/);
 assert.match(api,/BEGIN CERTIFICATE/);
 assert.match(api,/trustedFingerprint \? \{rejectUnauthorized:false\}/);
 assert.match(api,/Source certificate changed or expired/);
});
test('CA is only offered for TrueNAS and supplied transiently',()=>{
 assert.match(html,/id="ca-certificate"/);
 assert.match(js,/data\.source==='truenas'/);
 assert.match(js,/data\.caCertificate=/);
 assert.match(js,/source!=='truenas'/);
});
