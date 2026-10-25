import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectMigrationCertificate} from '../src/migration-certificate-inspect.mjs';
test('rejects non-LAN and loopback certificate probes',async()=>{
 await assert.rejects(inspectMigrationCertificate({host:'8.8.8.8'}),/private LAN/);
 await assert.rejects(inspectMigrationCertificate({host:'127.0.0.1'}),/private LAN/);
});
test('certificate inspection precedes credential submission',()=>{
 const js=readFileSync(new URL('../public/migration-wizard.js',import.meta.url),'utf8');
 const inspect=js.indexOf("const certificate=await post('/api/migration/certificate/inspect'");
 const scan=js.indexOf("const result=await post('/api/migration/inspect',data)");
 assert.ok(inspect>=0&&scan>inspect);
 assert.match(js,/No password was sent/);
});
