import test from 'node:test';
import assert from 'node:assert/strict';
import { ProtectionAdapter } from '../src/storage-agent/protection.js';

function adapterWithDirectories(directoryMap) {
  const calls = [];
  const adapter = new ProtectionAdapter({
    dir:'/unused-lightnas-test-dir',
    run:async (bin,args) => { calls.push({bin,args}); return {ok:true}; }
  });
  adapter.init = async () => {};
  adapter.directory = async path => {
    const entry=directoryMap[path];
    if (!entry) throw Error('Unknown test directory');
    return {path,dev:entry.dev,ino:entry.ino};
  };
  return {adapter,calls};
}

const task={
  id:'MirrorTest', kind:'rsync', source:'/backup/source', target:'/backup/target',
  mode:'mirror', direction:'push', retention:7,
  schedule:{frequency:'on-demand'}
};
const registry={tasks:[],cloudRemotes:[],replicationProfiles:[]};

test('reject rsync source and target aliases across different bind-mount paths',async()=>{
  const paths={
    '/backup/source':{dev:1,ino:42},
    '/backup/target':{dev:1,ino:42}
  };
  const {adapter,calls}=adapterWithDirectories(paths);
  await assert.rejects(adapter.normalizeTask(task,registry),/separate directory trees.*bind-mounted aliases/);
  assert.equal(calls.length,0,'must not invoke rsync even for a version probe');
});

test('allow distinct on-disk directories even on the same filesystem',async()=>{
  const paths={
    '/backup/source':{dev:1,ino:42},
    '/backup/target':{dev:1,ino:43}
  };
  const {adapter,calls}=adapterWithDirectories(paths);
  const value=await adapter.normalizeTask(task,registry);
  assert.equal(value.source.ino,42);
  assert.equal(value.target.ino,43);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0],{bin:'/usr/bin/rsync',args:['--version']});
});

test('reject after-preview alias changes before running a destructive mirror',async()=>{
  const paths={
    '/backup/source':{dev:1,ino:42},
    '/backup/target':{dev:1,ino:43}
  };
  const {adapter,calls}=adapterWithDirectories(paths);
  const impact={
    type:'protection.run',context:{
      task,source:{path:task.source,dev:1,ino:42},
      target:{path:task.target,dev:1,ino:43}
    },
    result:{id:'MirrorTest',kind:'rsync'},
    commands:[{bin:'/usr/bin/rsync',args:['-a','--delete','--',task.source+'/',task.target+'/']}]
  };
  paths['/backup/target']={dev:1,ino:42};
  await assert.rejects(adapter.apply(impact),/same directory/);
  assert.equal(calls.length,0);
  paths['/backup/target']={dev:1,ino:44};
  await assert.rejects(adapter.apply(impact),/changed since preview/);
  assert.equal(calls.length,0);
  paths['/backup/target']={dev:1,ino:43};
  await assert.doesNotReject(adapter.apply(impact));
  assert.equal(calls.length,1);
});
