import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../public/migration-wizard.html', import.meta.url),'utf8');
const code=readFileSync(new URL('../public/migration-wizard.js', import.meta.url),'utf8');
const server=readFileSync(new URL('../src/server.mjs', import.meta.url),'utf8');
test('migration wizard loads CSP compatible external JS',()=>{
 assert.match(html,/<script type="module" src="\/migration-wizard\.js"><\/script>/);
 assert.doesNotMatch(html,/<script(?:\s[^>]*)?>\s*(?:const|let|function|async)\b/);
 assert.match(server,/script-src 'self'/);
});
test('connect and scan event handler is registered externally',()=>{
 assert.match(code,/el\('scan'\)\.onclick\s*=\s*async/);
 assert.match(code,/el\('source'\)\.addEventListener\('change'/);
 assert.match(code,/el\('connect-status'\)\.textContent=e\.message/);
});
