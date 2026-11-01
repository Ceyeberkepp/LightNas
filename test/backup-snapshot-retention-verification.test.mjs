import test from 'node:test';
import assert from 'node:assert/strict';
import {ProtectionAdapter} from '../src/storage-agent/protection.js';

const created='tank/data@lightnas-BackupTask-1700000000';
const older=['tank/data@lightnas-BackupTask-1699999998','tank/data@lightnas-BackupTask-1699999999'];

function isolatedJob({visible=[true],replication=false,prune=older,failSend=false}={}){
 const commands=[],events=[];
 let inventoryReads=0;
 const datasets={inventory:async()=>{
  const present=visible[Math.min(inventoryReads++,visible.length-1)];
  events.push('inventory:'+present);
  return {available:true,snapshots:present?[{name:created}]:[]};
 }};
 const adapter=new ProtectionAdapter({
  dir:'/unused-isolated-backup-test',
  datasets,
  run:async(bin,args)=>{
   commands.push({bin,args});
   events.push(args[0]+':'+args[1]);
   return {ok:true};
  },
  pipeline:async()=>{
   events.push('remote-send');
   if(failSend)throw Error('Injected remote send failure');
  }
 });
 adapter.init=async()=>{};
 const impact={
  type:'protection.run',
  context:{
   task:{id:'BackupTask',kind:replication?'replication':'snapshot'},
   snapshot:created,
   prune,
   ...(replication?{pipeline:[{bin:'zfs',args:['send',created]},{bin:'ssh',args:['receive']}]}:{})
  },
  commands:[{bin:'/usr/sbin/zfs',args:['snapshot',created]}],
  result:{id:'BackupTask',kind:replication?'replication':'snapshot'}
 };
 return {adapter,impact,commands,events,reads:()=>inventoryReads};
}

test('failure injection: successful snapshot command without ZFS inventory proof never prunes older recovery points',async()=>{
 const {adapter,impact,commands,events}=isolatedJob({visible:[false]});
 await assert.rejects(adapter.apply(impact),/Created snapshot not verified/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
 assert.equal(events.some(e=>e.startsWith('destroy:')),false);
});

test('verified snapshot can complete retention only after inventory checks',async()=>{
 const {adapter,impact,commands,events,reads}=isolatedJob();
 const result=await adapter.apply(impact);
 assert.equal(result.snapshot,created);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot','destroy','destroy']);
 assert.equal(reads(),3,'verify before retention and before each destructive prune');
 assert.ok(events.indexOf('inventory:true')<events.indexOf('destroy:'+older[0]));
});

test('failure injection: snapshot disappearing during remote transfer prevents any retention deletion',async()=>{
 const {adapter,impact,commands,events}=isolatedJob({visible:[true,false],replication:true});
 await assert.rejects(adapter.apply(impact),/Created snapshot not verified/);
 assert.ok(events.includes('remote-send'));
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: remote send error retains every older snapshot',async()=>{
 const {adapter,impact,commands}=isolatedJob({replication:true,failSend:true});
 await assert.rejects(adapter.apply(impact),/Injected remote send failure/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: snapshot loss between retention deletions stops remaining pruning',async()=>{
 const {adapter,impact,commands}=isolatedJob({visible:[true,true,false]});
 await assert.rejects(adapter.apply(impact),/Created snapshot not verified/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot','destroy']);
 assert.deepEqual(commands[1].args,['destroy',older[0]]);
});
