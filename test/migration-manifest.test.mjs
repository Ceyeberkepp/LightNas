import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeMigrationManifest} from '../src/migration-manifest.mjs';
test('manifest contains structured inventory but no arbitrary secret properties',()=>{
 const out=normalizeMigrationManifest({source:'redhat',items:[{id:'domain1',name:'RHEL VM',type:'vm',password:'secret',token:'x'}]});
 assert.equal(out.items[0].name,'RHEL VM');
 assert.ok(!JSON.stringify(out).includes('secret'));assert.equal(out.containsCredentials,false);
 assert.deepEqual(out.mappingsRequired,['domain1']);
});
test('manifest validation refuses bad inventory',()=>{
 assert.throws(()=>normalizeMigrationManifest({source:'invalid',items:[]}),/Unsupported/);
 assert.throws(()=>normalizeMigrationManifest({source:'proxmox',items:[{id:'x',name:'VM',type:'vm'},{id:'x',name:'VM2',type:'vm'}]}),/duplicate/);
});
