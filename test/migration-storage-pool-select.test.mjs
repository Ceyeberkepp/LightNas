import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../public/migration-wizard.js',import.meta.url),'utf8');
test('destination dropdown loads actual LightNAS pools',()=>{
 assert.match(ui,/fetch\('\/api\/storage\/pools'/);
 assert.match(ui,/p\.online===true&&p\.writable===true/);
 assert.match(ui,/data-mapping-index/);
 assert.match(ui,/<select data-mapping-index/);
});
test('destination choices are workload compatible and verified',()=>{
 assert.match(ui,/type==='vm'\?'images'/);
 assert.match(ui,/type==='container'\?'rootdir'/);
 assert.match(ui,/type==='storage'\|\|type==='share'\?'files'/);
 assert.match(ui,/Destination pool is not available or compatible/);
 assert.match(ui,/Network interface mapping requires a separate destination network check/);
});
