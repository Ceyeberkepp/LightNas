import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/migration-discovery.mjs',import.meta.url),'utf8');
test('TrueNAS password discovery uses modern JSON-RPC WebSocket',()=>{
 assert.match(source,/new URL\('\/api\/current',base\)/);
 assert.match(source,/jsonrpc:'2.0'/);
 assert.match(source,/call\('auth.login_ex',\[\{mechanism:'PASSWORD_PLAIN',username,password\}\]\)/);
 assert.match(source,/status!=='SUCCESS'/);
 for(const method of ['pool.query','sharing.smb.query','vm.query'])assert.ok(source.includes(method));
});
test('one-time certificate pin must verify before sending credentials',()=>{
 const a=source.indexOf('async function truenasJsonRpcInventory');
 const b=source.indexOf('// TrueNAS legacy middleware',a);
 const section=source.slice(a,b);
 assert.match(section,/pinned=!trustedFingerprint/);
 assert.match(section,/fingerprint256/);
 assert.match(section,/if\(!pinned\)return finish/);
 assert.ok(section.indexOf('if(!pinned)')<section.indexOf("call('auth.login_ex'"));
});
