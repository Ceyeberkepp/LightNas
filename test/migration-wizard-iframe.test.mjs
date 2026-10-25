import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('migration wizard is frameable only within same origin',()=>{
 assert.match(server,/\['\/container-console\.html', '\/migration-wizard\.html'\]\.includes\(url\.pathname\) \? embeddedConsoleCsp : csp/);
 assert.match(server,/frame-ancestors 'none'/);
 assert.match(server,/csp\.replace\("frame-ancestors 'none'", "frame-ancestors 'self'"\)/);
});
test('Admin Center popup loads the allowed route',()=>{
 assert.match(app,/frame\.src='\/migration-wizard\.html'/);
});
