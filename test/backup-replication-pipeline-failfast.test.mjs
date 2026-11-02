import test from 'node:test';
import assert from 'node:assert/strict';
import {replicate} from '../src/storage-agent/protection.js';

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
