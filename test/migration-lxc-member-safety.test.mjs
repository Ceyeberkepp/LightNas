import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectArchiveMemberTypes} from '../src/migration-lxc-preflight.mjs';
test('accepts regular files and folders in archive listing',()=>{
 assert.equal(inspectArchiveMemberTypes('-rw-r--r-- user/group 4 2026-01-01 00:00 etc/os-release\ndrwxr-xr-x user/group 0 2026-01-01 00:00 etc/'),2);
});
for(const [name,code] of [['symlink','l'],['hardlink','h'],['character-device','c'],['block-device','b'],['fifo','p']]){
 test('rejects '+name,()=>assert.throws(()=>inspectArchiveMemberTypes(code+'rw-r--r-- owner/group 0 2026-01-01 00:00 unsafe'),/links, special files/));
}
