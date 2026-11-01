import test from 'node:test';
import assert from 'node:assert/strict';
import {ProtectionAdapter} from '../src/storage-agent/protection.js';

const created='tank/data@lightnas-BackupTask-1700000000';
const older=['tank/data@lightnas-BackupTask-1699999998','tank/data@lightnas-BackupTask-1699999999'];

function isolatedJob({visible=[true],replication=false,prune=older,failSend=false,sourceGuid='81234567',targetGuid='81234567',sourceCheckOk=true,targetCheckOk=true}={}){
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
   if(args[0]==='get'&&args.includes('guid')){
    events.push('verify-source-guid');
    return {ok:sourceCheckOk,stdout:sourceGuid+'\\n'};
   }
   if(bin==='/usr/bin/ssh'&&args.at(-1).startsWith('zfs get ')){
    events.push('verify-target-guid');
    return {ok:targetCheckOk,stdout:targetGuid+'\\n'};
   }
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
   ...(replication?{pipeline:[{bin:'zfs',args:['send',created]},{bin:'ssh',args:['receive']}],remoteVerification:{source:{bin:'/usr/sbin/zfs',args:['get','-H','-o','value','guid',created]},target:{bin:'/usr/bin/ssh',args:['-o','StrictHostKeyChecking=yes','zfs get -H -o value guid backup/data@lightnas-BackupTask-1700000000']},snapshot:'backup/data@lightnas-BackupTask-1700000000'}}:{})
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


test('verified remote replica GUID permits retention only after the receive and both GUID checks',async()=>{
 const {adapter,impact,commands,events}=isolatedJob({replication:true});
 await adapter.apply(impact);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot','destroy','destroy']);
 assert.ok(events.indexOf('remote-send')<events.indexOf('verify-source-guid'));
 assert.ok(events.indexOf('verify-source-guid')<events.indexOf('verify-target-guid'));
 assert.ok(events.indexOf('verify-target-guid')<events.indexOf('destroy:'+older[0]));
});

test('failure injection: successful remote receive with a different snapshot GUID retains older recovery points',async()=>{
 const {adapter,impact,commands}=isolatedJob({replication:true,targetGuid:'81234568'});
 await assert.rejects(adapter.apply(impact),/Remote replica snapshot GUID not verified/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: remote replica GUID lookup fails after receive and no retention is attempted',async()=>{
 const {adapter,impact,commands}=isolatedJob({replication:true,targetCheckOk:false});
 await assert.rejects(adapter.apply(impact),/Remote replica snapshot GUID not verified/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: local snapshot GUID lookup fails and no retention is attempted',async()=>{
 const {adapter,impact,commands}=isolatedJob({replication:true,sourceCheckOk:false});
 await assert.rejects(adapter.apply(impact),/Remote replica snapshot GUID not verified/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: malformed remote GUID output cannot authorize destructive retention',async()=>{
 const {adapter,impact,commands}=isolatedJob({replication:true,targetGuid:'81234567\\nUnexpected banner'});
 await assert.rejects(adapter.apply(impact),/Remote replica snapshot GUID not verified/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});

test('failure injection: missing replica verification plan cannot authorize retention',async()=>{
 const {adapter,impact,commands}=isolatedJob({replication:true});
 delete impact.context.remoteVerification;
 await assert.rejects(adapter.apply(impact),/Remote replica verification missing/);
 assert.deepEqual(commands.map(c=>c.args[0]),['snapshot']);
});
