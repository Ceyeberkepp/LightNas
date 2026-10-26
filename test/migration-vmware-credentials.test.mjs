import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../src/migration-discovery.mjs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/migration-wizard.js',import.meta.url),'utf8');
test('vCenter session uses ephemeral credential exchange',()=>{
 assert.match(api,/async function vmwarePasswordSession/);
 assert.match(api,/new URL\('api\/session',base\)/);
 assert.match(api,/method:'POST'/);
 assert.match(api,/username && password \? await vmwarePasswordSession/);
 assert.match(api,/vmware-api-session-id/);
});
test('vCenter wizard allows username and password',()=>{
 assert.match(ui,/\['proxmox','truenas','vmware'\]\.includes\(source\)/);
 assert.match(ui,/\['proxmox','truenas','vmware'\]\.includes\(data\.source\)/);
});
