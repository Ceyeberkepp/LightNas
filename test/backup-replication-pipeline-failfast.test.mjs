import test from 'node:test';
import assert from 'node:assert/strict';
import {replicate} from '../src/storage-agent/protection.js';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// All failure injection uses isolated Node subprocesses, never ZFS, SSH,
// production disks, network interfaces or an appliance.
const command=script=>({bin:process.execPath,args:['-e',script]});

test('replication accepts a fully consumed stream with two zero exits',async()=>{
 await assert.doesNotReject(replicate([
  command("process.stdout.write('verified-payload')"),
  command("let bytes='';process.stdin.on('data',data=>bytes+=data);process.stdin.on('end',()=>process.exit(bytes==='verified-payload'?0:8))")
 ],10000));
});

test('failure injection: nonzero sender exit promptly terminates a hung receiver',async()=>{
 const started=Date.now();
 await assert.rejects(replicate([
  command('process.exit(7)'),
  command('process.stdin.resume();setInterval(()=>{},1000)')
 ],10000),/Replication failed/);
 assert.ok(Date.now()-started<7000,'A known failed sender must not wait for the pipeline timeout');
});

test('failure injection: nonzero receiver exit promptly terminates a live sender',async()=>{
 const started=Date.now();
 await assert.rejects(replicate([
  command('setInterval(()=>process.stdout.write("data"),10)'),
  command('process.exit(9)')
 ],10000),/Replication failed/);
 assert.ok(Date.now()-started<7000,'A known failed receiver must not wait for the pipeline timeout');
});

test('failure injection: receiver exiting zero without consuming the stream is not success',async()=>{
 await assert.rejects(replicate([
  command('setInterval(()=>process.stdout.write("data"),10)'),
  command('process.exit(0)')
 ],10000),/Replication failed/);
});

test('failure injection: failed sender spawn terminates the other subprocess',async()=>{
 const started=Date.now();
 await assert.rejects(replicate([
  {bin:'/nonexistent/lightnas-replication-sender',args:[]},
  command('process.stdin.resume();setInterval(()=>{},1000)')
 ],10000),/Replication failed/);
 assert.ok(Date.now()-started<7000,'A spawn failure must not leave the receiver waiting');
});

test('failure injection: pipeline timeout rejects both otherwise healthy but hung children',async()=>{
 await assert.rejects(replicate([
  command('setInterval(()=>{},1000)'),
  command('process.stdin.resume();setInterval(()=>{},1000)')
 ],250),/Replication failed/);
});

test('failure injection: synchronous sender spawn validation rejects without starting receiver',async()=>{
 await assert.rejects(replicate([
  {bin:process.execPath,args:['\\0']},
  command('process.exit(0)')
 ],10000),/Replication failed/);
});

test('failure injection: synchronous receiver spawn rejection never orphans sender',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lightnas-replication-spawn-'));
 const pidFile=join(dir,'sender.pid');
 try{
  const script=`require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`;
  await assert.rejects(replicate([
   command(script),
   {bin:process.execPath,args:['\\0']}
  ],10000),/Replication failed/);
  // A sender that was scheduled but killed before its first instruction may
  // never write its PID. If it did start, it must have been reaped.
  await new Promise(resolve=>setTimeout(resolve,350));
  const raw=await readFile(pidFile,'utf8').catch(error=>{
   if(error.code==='ENOENT')return null;
   throw error;
  });
  if(raw)assert.throws(()=>process.kill(Number(raw),0),{code:'ESRCH'},'Sender survived a rejected receiver spawn');
 }finally{
  // Clean up a leaked process even if the regression fails, to avoid
  // leaving test children alive on CI runners.
  await new Promise(resolve=>setTimeout(resolve,350));
  const raw=await readFile(pidFile,'utf8').catch(()=>null);
  if(raw)try{process.kill(Number(raw),'SIGKILL');}catch{}
  await rm(dir,{recursive:true,force:true});
 }
});
