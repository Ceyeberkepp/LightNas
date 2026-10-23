import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDiskPaths,verifyOfflineVm} from '../src/migration-verify.mjs';
test('extracts only file-backed disk sources',()=>{
 assert.deepEqual(parseDiskPaths('<source file="/x/disk.qcow2"/><source dev="/dev/sda"/>'),['/x/disk.qcow2']);
});
test('offline verification reports missing NIC and does not claim boot checks',async()=>{
 const result=await verifyOfflineVm({name:'TestVM'},{command:async(tool,args)=>{
  if(args.includes('dumpxml'))return '<domain><memory unit="KiB">4194304</memory></domain>';
  return 'shut off';
 }});
 assert.equal(result.passed,false);assert.equal(result.bootTested,false);assert.equal(result.cutoverPerformed,false);
 assert.ok(result.issues.some(x=>x.includes('NIC')));
});
