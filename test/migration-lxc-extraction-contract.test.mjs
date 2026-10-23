import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLxcExtractionContract} from '../src/migration-lxc-extraction-contract.mjs';
const hash='a'.repeat(64);
const approved={reviewComplete:true,approvedForExecution:false,archiveSha256:hash};
const base={archive:'backup.tar.zst',archiveSha256:hash,rootfsEntries:[{path:'etc/os-release',type:'file'},{path:'etc',type:'directory'}],destination:{pool:'pool1',name:'RestoredLxc'},approval:approved};
test('safe extraction contract never authorizes filesystem mutation',()=>{
 const result=validateLxcExtractionContract(base);
 assert.equal(result.extractionStarted,false);
 assert.equal(result.approvedForExecution,false);
 assert.equal(result.entries,2);
});
for(const path of ['/etc/passwd','../etc/passwd','etc/../passwd','etc//passwd','etc\\passwd']){
 test('reject unsafe archive path '+path,()=>assert.throws(()=>validateLxcExtractionContract({...base,rootfsEntries:[{path,type:'file'}]}),/Unsafe/));
}
test('reject symlinks and special files',()=>assert.throws(()=>validateLxcExtractionContract({...base,rootfsEntries:[{path:'etc/link',type:'symlink'}]}),/Unsafe/));
test('reject duplicate archive members',()=>assert.throws(()=>validateLxcExtractionContract({...base,rootfsEntries:[base.rootfsEntries[0],base.rootfsEntries[0]]}),/duplicate/));
test('reject mismatched archive approval',()=>assert.throws(()=>validateLxcExtractionContract({...base,approval:{...approved,archiveSha256:'b'.repeat(64)}}),/review required/));
test('reject approval claiming execution authorization',()=>assert.throws(()=>validateLxcExtractionContract({...base,approval:{...approved,approvedForExecution:true}}),/review required/));
