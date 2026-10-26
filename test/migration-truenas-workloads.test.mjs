import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../src/migration-discovery.mjs',import.meta.url),'utf8');
test('modern TrueNAS inventory includes apps and Incus instances',()=>{
 const modern=s.slice(s.indexOf('async function truenasJsonRpcInventory'),s.indexOf('// TrueNAS legacy middleware'));
 for(const name of ['app.query','virt.instance.query'])assert.ok(modern.includes(name));
 assert.match(modern,/mapItems\(lists\['app.query'\],'app'/);
 assert.match(modern,/mapItems\(lists\['virt.instance.query'\],'container'/);
});
test('optional features do not block core storage and share discovery',()=>{
 assert.match(s,/if\(optional.includes\(method\)\)\{lists\[method\]=\[\];maybeFinish\(\);return;\}/);
});
