import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {previewNetworkMigration} from '../src/migration-network-preflight.mjs';
const net={name:'br0',mode:'trunk',allowedVlans:[10,20],management:true};
test('networks discover but never apply without opt-in',()=>{
 const r=previewNetworkMigration({networks:[net]});
 assert.equal(r.discovered,true);assert.equal(r.selectedForTransfer,false);assert.equal(r.networkChangesApplied,false);
});
test('opt-in still requires safe mapping and validation',()=>{
 const r=previewNetworkMigration({networks:[net],transferNetworkSettings:true});
 assert.equal(r.selectedForTransfer,true);assert.equal(r.results[0].readyForExecution,false);
 assert.match(r.results[0].issues.join(' '),/Management interface/);
});
test('invalid trunk tags rejected',()=>assert.throws(()=>previewNetworkMigration({networks:[{name:'br0',mode:'trunk',allowedVlans:[5000]}]}),/Invalid VLAN/));
test('wizard includes optional network checkbox and network scans',()=>{
 const html=readFileSync(new URL('../public/migration-wizard.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../public/migration-wizard.js',import.meta.url),'utf8');
 const discovery=readFileSync(new URL('../src/migration-discovery.mjs',import.meta.url),'utf8');
 assert.match(html,/id="transfer-network-settings"/);
 assert.match(js,/includeNetwork\|\|x\.type!=='network'/);
 assert.match(discovery,/interface.query/);
});
