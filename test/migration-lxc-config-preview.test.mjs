import test from 'node:test';
import assert from 'node:assert/strict';
import {renderOfflineLxcConfig} from '../src/migration-lxc-config-preview.mjs';
const valid={name:'RestoredLxc',bridge:'br0',memoryMiB:1024,cpus:2,uidStart:100000,gidStart:100000,idRange:65536,manifestSha256:'a'.repeat(64)};
test('rendered configuration is offline and never authorizes registration',()=>{
 const result=renderOfflineLxcConfig(valid);
 assert.equal(result.startAllowed,false);
 assert.equal(result.registrationAllowed,false);
 assert.match(result.config,/lxc.start.auto = 0/);
 assert.match(result.config,/lxc.idmap = u 0 100000 65536/);
 assert.ok(result.config.includes('\n'));
});
test('rejects malicious bridge strings',()=>assert.throws(()=>renderOfflineLxcConfig({...valid,bridge:'br0\nlxc.start.auto = 1'}),/Invalid identifiers/));
test('rejects privileged mapping',()=>assert.throws(()=>renderOfflineLxcConfig({...valid,uidStart:0}),/Unsafe UID\/GID/));
test('rejects invalid rootfs fingerprint',()=>assert.throws(()=>renderOfflineLxcConfig({...valid,manifestSha256:'x'}),/Invalid identifiers/));
