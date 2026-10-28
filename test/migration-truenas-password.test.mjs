import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const discovery=readFileSync(new URL('../src/migration-discovery.mjs',import.meta.url),'utf8');
const wizard=readFileSync(new URL('../public/migration-wizard.js',import.meta.url),'utf8');
test('TrueNAS supports user/password via TLS socket and read-only methods',()=>{
 assert.match(discovery,/endpoint.protocol='wss:'/);
 assert.match(discovery,/method\('auth.login',\[username,password\]\)/);
 for(const name of ['pool.query','sharing.smb.query','vm.query'])assert.ok(discovery.includes(name));
 assert.match(discovery,/trustedFingerprint \? \{rejectUnauthorized:false\}/);
 assert.match(discovery,/peerPinned/);
});
test('wizard requests TrueNAS credentials, clears password on completion',()=>{
 assert.match(wizard,/passwordSupported=\['proxmox','truenas','vmware'\]\.includes\(source\)/);
 assert.match(wizard,/\['proxmox','truenas','vmware'\]\.includes\(data.source\)/);
 assert.match(wizard,/el\('password'\)\.value=''/);
});
