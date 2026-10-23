import test from 'node:test';
import assert from 'node:assert/strict';
import {previewOfflineLxcRegistration} from '../src/migration-lxc-registration.mjs';
const base={name:'RestoredLxc',network:'bridge0',memoryMiB:2048,cpus:2,
 rootfsManifestSha256:'a'.repeat(64),rootfsVerified:true,
 idMap:{uidStart:100000,gidStart:100000,range:65536}};
test('valid preview cannot register or start a container',()=>{
 const p=previewOfflineLxcRegistration(base);
 assert.equal(p.canRegister,false);assert.equal(p.canStart,false);
 assert.equal(p.offline,true);
});
test('missing verified rootfs is blocked',()=>{
 const p=previewOfflineLxcRegistration({...base,rootfsVerified:false});
 assert.match(p.blockers.join(' '),/Verified offline/);
});
test('privileged ID mappings are blocked',()=>{
 const p=previewOfflineLxcRegistration({...base,idMap:{uidStart:0,gidStart:0,range:65536}});
 assert.match(p.blockers.join(' '),/unprivileged/);
});
test('invalid network settings are rejected',()=>{
 assert.throws(()=>previewOfflineLxcRegistration({...base,network:'bridge;rm -rf'}),/Invalid resources/);
});
