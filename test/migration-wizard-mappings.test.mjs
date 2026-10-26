import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planMigration} from '../src/migration-planner.mjs';
const html=readFileSync(new URL('../public/migration-wizard.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../public/migration-wizard.js',import.meta.url),'utf8');
test('mapping fields and recheck button are present inside review',()=>{
 assert.match(html,/id="check-mappings"/);
 assert.match(js,/data-mapping-index/);
 assert.match(js,/mappingById\[item\.id\]/);
 assert.match(js,/mappings\[item\.id\]=\{target:mappingById\[item\.id\]\}/);
});
test('mapping removes only mapping blocker and never starts transfer',()=>{
 const item={id:'truenas-pool:SSDD01',name:'SSDD01',type:'storage'};
 const without=planMigration({source:'truenas',items:[item]});
 const withTarget=planMigration({source:'truenas',items:[item],mappings:{[item.id]:{target:'SSD01'}}});
 assert.equal(without.blockers.length,1);
 assert.equal(withTarget.steps[0].status,'ready-for-review');
 assert.equal(withTarget.migrationStarted,false);
});
test('application adapter remains blocked despite mapping',()=>{
 const app={id:'truenas-app:sftpgo',name:'sftpgo',type:'app'};
 const result=planMigration({source:'truenas',items:[app],mappings:{[app.id]:{target:'Apps'}}});
 assert.equal(result.steps[0].status,'needs-app-migration-adapter');
});
