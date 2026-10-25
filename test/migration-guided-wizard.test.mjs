import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const wizard=readFileSync(new URL('../public/migration-wizard.html',import.meta.url),'utf8');
const discovery=readFileSync(new URL('../src/migration-discovery.mjs',import.meta.url),'utf8');
test('Migration Center belongs to Admin Center and opens a modal',()=>{
 assert.match(app,/\['migration', 'Migration Center'\]/);
 assert.match(app,/data-open-migration-wizard/);
 assert.match(app,/dialog\.showModal\(\)/);
 assert.match(app,/migration-wizard\.html/);
});
test('guided wizard has connect scan review and clears credentials',()=>{
 for(const id of ['source','host','username','password','token','scan','results','review','plan'])assert.ok(wizard.includes('id="'+id+'"'),id);
 assert.match(wizard,/el\('password'\)\.value=''/);
 assert.match(wizard,/el\('token'\)\.value=''/);
 assert.match(wizard,/Advanced migration tools/);
});
test('password login is limited to Proxmox read-only source discovery',()=>{
 assert.match(discovery,/proxmoxPasswordSession/);
 assert.match(discovery,/access\/ticket/);
 assert.match(discovery,/redirect:'error'/);
 assert.match(discovery,/source === 'proxmox'/);
 assert.doesNotMatch(discovery,/rejectUnauthorized:\s*false/);
});
