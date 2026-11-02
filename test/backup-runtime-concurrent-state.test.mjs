import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProtectionAdapter} from '../src/storage-agent/protection.js';

async function isolated(t){
 const dir=await mkdtemp(join(tmpdir(),'lightnas-backup-runtime-race-'));
 const adapter=new ProtectionAdapter({dir});
 await adapter.init();
 t.after(()=>rm(dir,{recursive:true,force:true}));
 return {adapter,dir};
}

test('concurrent scheduler claims and job completions persist every task state',async t=>{
 const {adapter,dir}=await isolated(t);
 const operations=Array.from({length:32},(_,i)=>{
  const task='Backup'+String(i%8);
  return adapter.record(task,{['marker'+i]:i});
 });
 await Promise.all(operations);
 const state=await adapter.runtime();
 assert.equal(Object.keys(state).length,8,'all eight independent backup tasks survive');
 for(let i=0;i<32;i++)
  assert.equal(state['Backup'+(i%8)]['marker'+i],i,
   'a racing write must not erase another task or field');
 const files=await readdir(join(dir,'protection'));
 assert.deepEqual(files,['runtime.json'],'atomic writes must not leave orphaned state files');
});

test('a backup completion cannot erase the scheduler nextRun claim',async t=>{
 const {adapter}=await isolated(t);
 const due='2026-11-03T01:00:00.000Z';
 await Promise.all([
  adapter.record('CriticalBackup',{nextRun:due,lastRun:'2026-11-02T00:00:00Z'}),
  adapter.record('CriticalBackup',{lastJob:'job-123',status:'succeeded'}),
  adapter.record('DailyReplica',{nextRun:'2026-11-03T03:00:00.000Z'}),
  adapter.record('CriticalBackup',{error:null,verifiedAt:'2026-11-02T00:01:00Z'})
 ]);
 const state=await adapter.runtime();
 assert.equal(state.CriticalBackup.nextRun,due);
 assert.equal(state.CriticalBackup.lastJob,'job-123');
 assert.equal(state.CriticalBackup.status,'succeeded');
 assert.equal(state.CriticalBackup.verifiedAt,'2026-11-02T00:01:00Z');
 assert.equal(state.DailyReplica.nextRun,'2026-11-03T03:00:00.000Z');
});

test('an errored first state update reports its failure without permanently blocking later updates',async t=>{
 const {adapter}=await isolated(t);
 const originalRuntime=adapter.runtime.bind(adapter);
 let first=true;
 adapter.runtime=async()=>{
  if(first){first=false;throw Error('Injected state read failure');}
  return originalRuntime();
 };
 const failed=adapter.record('CriticalBackup',{status:'running'});
 const recovery=adapter.record('CriticalBackup',{status:'failed',error:'Read failed'});
 await assert.rejects(failed,/Injected state read failure/);
 await recovery;
 assert.deepEqual((await adapter.runtime()).CriticalBackup,{status:'failed',error:'Read failed'});
});
