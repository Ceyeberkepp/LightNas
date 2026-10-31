import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSeparateRsyncTrees,parseMountInfo} from '../src/storage-agent/mount-identity.js';
import {ProtectionAdapter} from '../src/storage-agent/protection.js';

const root='1 0 0:42 / / rw,relatime - ext4 /dev/sda rw';
const mount=(id,filesystemRoot,mountPoint,device='0:42')=>
  id+' 1 '+device+' '+filesystemRoot+' '+mountPoint+' rw - ext4 /dev/sda rw';
const topology=(...extra)=>[root,...extra].join('\n')+'\n';
const source='/data/source',target='/backup/target';
const task={id:'MirrorTest',kind:'rsync',source,target,mode:'mirror',direction:'push',
  retention:7,schedule:{frequency:'on-demand'}};
const registry={tasks:[],cloudRemotes:[],replicationProfiles:[]};

test('mountinfo identifies descendant bind aliases with different device/inode directory identities',()=>{
  const info=topology(mount(2,'/data/source/child','/backup/target'));
  assert.throws(()=>assertSeparateRsyncTrees(source,target,info),
    /overlap through a bind mount/);
});

test('mountpoint nested INSIDE rsync destination must not expose source for --delete',()=>{
  const info=topology(mount(2,'/data/source/child','/backup/target/photos'));
  assert.throws(()=>assertSeparateRsyncTrees(source,target,info),
    /overlap through a bind mount/);
});

test('mountpoint nested INSIDE rsync source must not copy into the target',()=>{
  const info=topology(mount(2,'/backup/target/child','/data/source/media'));
  assert.throws(()=>assertSeparateRsyncTrees(source,target,info),
    /overlap through a bind mount/);
});

test('same backing filesystem is permitted only when source and target trees do not overlap',()=>{
  const info=topology(mount(2,'/data/other','/backup/target'));
  const result=assertSeparateRsyncTrees(source,target,info);
  assert.equal(result.mounts.length,2);
  assert.equal(result.mounts[1].root,'/data/other');
});

test('mountinfo escaped spaces decode to the same backing filesystem tree',()=>{
  const info=topology(mount(2,'/data/source\\040docs/child','/backup/target'));
  assert.throws(()=>assertSeparateRsyncTrees('/data/source docs',target,info),
    /overlap through a bind mount/);
});

test('malformed, unreadable or missing Linux mount topology fails closed',()=>{
  assert.throws(()=>parseMountInfo(''),/unavailable/);
  assert.throws(()=>parseMountInfo('broken mount record'),/Malformed/);
  assert.throws(()=>parseMountInfo('2 1 0:42 /abc\\bad /mnt rw - ext4 /dev/sda rw'),/decode/);
  assert.throws(()=>assertSeparateRsyncTrees(source,target,mount(2,'/x','/unrelated')),
    /Cannot resolve backup path/);
});

function adapterWithMounts(getMounts){
  const calls=[];
  const adapter=new ProtectionAdapter({
    dir:'/unused-lightnas-mount-topology-tests',
    mountInfo:getMounts,
    run:async(bin,args)=>{calls.push({bin,args});return {ok:true};}
  });
  adapter.init=async()=>{};
  adapter.directory=async path=>({path,dev:42,ino:path===source?101:202});
  return {adapter,calls};
}

test('mirror execution refuses a new bind alias mounted after the preview',async()=>{
  let info=topology();
  const {adapter,calls}=adapterWithMounts(async()=>info);
  const normalized=await adapter.normalizeTask(task,registry);
  const impact={type:'protection.run',
    context:{task,source:normalized.source,target:normalized.target,
      mountTopology:normalized.mountTopology},
    commands:[{bin:'/usr/bin/rsync',
      args:['-a','--delete','--',source+'/',target+'/']}],
    result:{id:task.id,kind:'rsync'}};
  calls.length=0;
  info=topology(mount(2,'/data/source/private','/backup/target/hidden'));
  await assert.rejects(adapter.apply(impact),/overlap through a bind mount/);
  assert.equal(calls.length,0,'destructive rsync must never execute');
});

test('mirror execution refuses a changed non-overlapping mount after preview',async()=>{
  let info=topology();
  const {adapter,calls}=adapterWithMounts(async()=>info);
  const normalized=await adapter.normalizeTask(task,registry);
  const impact={type:'protection.run',
    context:{task,source:normalized.source,target:normalized.target,
      mountTopology:normalized.mountTopology},
    commands:[{bin:'/usr/bin/rsync',
      args:['-a','--delete','--',source+'/',target+'/']}],
    result:{id:task.id,kind:'rsync'}};
  calls.length=0;
  info=topology(mount(2,'/data/other','/backup/target'));
  await assert.rejects(adapter.apply(impact),/mount topology changed since preview/);
  assert.equal(calls.length,0);
});

test('cannot save an rsync task if mount topology is unreadable',async()=>{
  const {adapter,calls}=adapterWithMounts(async()=>{throw Error('mountinfo unavailable');});
  await assert.rejects(adapter.normalizeTask(task,registry),/mountinfo unavailable/);
  assert.equal(calls.length,0);
});

test('unchanged topology allows distinct directories and approved rsync execution',async()=>{
  const {adapter,calls}=adapterWithMounts(async()=>topology());
  const normalized=await adapter.normalizeTask(task,registry);
  const impact={type:'protection.run',
    context:{task,source:normalized.source,target:normalized.target,
      mountTopology:normalized.mountTopology},
    commands:[{bin:'/usr/bin/rsync',
      args:['-a','--delete','--',source+'/',target+'/']}],
    result:{id:task.id,kind:'rsync'}};
  calls.length=0;
  const result=await adapter.apply(impact);
  assert.equal(result.id,'MirrorTest');
  assert.deepEqual(calls.map(c=>c.bin),['/usr/bin/rsync']);
});
