import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const backend=readFileSync(new URL('../src/migration-discovery.mjs',import.meta.url),'utf8');
const wizard=readFileSync(new URL('../public/migration-wizard.js',import.meta.url),'utf8');
test('TrueNAS continues authentication in the same websocket',()=>{
 assert.match(backend,/call\('auth.login_ex_continue',\[\{mechanism:'OTP_TOKEN',otp_token:otpToken\}\]\)/);
 assert.match(backend,/method==='auth.login_ex_continue'/);
 assert.match(backend,/status==='OTP_REQUIRED'.*otpToken/);
 assert.match(backend,/status:status==='OTP_REQUIRED'\?428:401/);
});
test('Wizard prompts for OTP only if server requests it and clears it',()=>{
 assert.match(wizard,/data.source!=='truenas'\|\|error.status!==428/);
 assert.match(wizard,/window.prompt\('TrueNAS requires two-factor authentication/);
 assert.match(wizard,/data.otpToken=code.trim\(\)/);
 assert.match(wizard,/delete data.otpToken/);
 assert.match(wizard,/el\('password'\)\.value=''/);
});
