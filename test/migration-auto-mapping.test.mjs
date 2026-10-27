import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../public/migration-wizard.js',import.meta.url),'utf8');
test('pool selection maps other compatible items and refreshes review',()=>{
 assert.match(s,/function autoMapDestinationPool\(poolId\)/);
 assert.match(s,/if\(mappingById\[item.id\]\)continue/);
 assert.match(s,/compatiblePools\(item.type\)\.some\(p=>p.id===poolId\)/);
 assert.match(s,/if\(select.value\)autoMapDestinationPool\(select.value\)/);
 assert.match(s,/await checkMigrationMappings\(\)/);
});
test('unselected empty inputs do not erase generated mappings',()=>{
 assert.match(s,/input.value.trim\(\) \|\| !mappingById\[item.id\]/);
});
