import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/migration-discovery.mjs',import.meta.url),'utf8');
test('TrueNAS authentication and API failures have safe HTTP status',()=>{
 for(const message of ['TrueNAS rejected the username or password','TrueNAS rejected the legacy WebSocket protocol','TrueNAS HTTPS certificate is not trusted','TrueNAS API did not respond']) assert.ok(source.includes(message),message);
 assert.match(source,/status:409/);assert.match(source,/status:401/);assert.match(source,/status:504/);
 assert.match(source,/trustedFingerprint \? \{rejectUnauthorized:false\}/);
 assert.match(source,/Source certificate changed or expired/);
});
test('source DNS failures are reported as user-facing validation errors',()=>{
 assert.match(source,/Cannot resolve the source host from LightNAS/);
 assert.match(source,/Source server must resolve only to private LAN addresses/);
});
