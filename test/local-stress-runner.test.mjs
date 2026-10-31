import test from 'node:test';
import assert from 'node:assert/strict';
import {isPrivateAddress,parseOptions,assess,runStress,probes} from '../scripts/stress-local.mjs';

test('local stress runner accepts only HTTPS on appliance port 3080 and private addresses',()=>{
  for(const url of [
    'https://127.0.0.1:3080','https://192.168.0.41:3080',
    'https://172.27.183.87:3080','https://10.8.0.1:3080',
    'https://[::1]:3080','https://localhost:3080'
  ]) assert.equal(parseOptions(['--url',url]).url,url.replace(/\/$/,''));
  for(const url of [
    'http://127.0.0.1:3080','https://8.8.8.8:3080',
    'https://example.com:3080','https://127.0.0.1:3000',
    'https://user:pass@127.0.0.1:3080','https://127.0.0.1:3080/api/storage',
    'https://127.0.0.1:3080/?a=1'
  ]) assert.throws(()=>parseOptions(['--url',url]),/Only a private\/local HTTPS/);
  assert.equal(isPrivateAddress('172.15.0.1'),false);
  assert.equal(isPrivateAddress('172.32.0.1'),false);
});

test('high load and long-running tests require acknowledgment and remain capped',()=>{
  assert.throws(()=>parseOptions(['--rps','12']),/--ack-impact/);
  assert.throws(()=>parseOptions(['--seconds','300']),/--ack-impact/);
  assert.equal(parseOptions(['--rps','12','--seconds','300','--ack-impact']).rps,12);
  for(const args of [
    ['--rps','-1'],['--rps','100'],['--seconds','3600'],
    ['--concurrency','500'],['--timeout-ms','99999'],['--rps','Infinity'],
    ['--rps','garbage'],['--bogus','hello']
  ]) assert.throws(()=>parseOptions(args));
});

test('read-only probes cover public services and reject unauthenticated privileged APIs',()=>{
  assert.ok(probes.every(p=>p.path.startsWith('/')&&p.expected===200||p.expected===401));
  assert.ok(probes.some(p=>p.path==='/api/storage'&&p.expected===401));
  assert.ok(probes.some(p=>p.path==='/api/network'&&p.expected===401));
  assert.ok(probes.some(p=>p.path==='/api/files?all=1'&&p.expected===401));
  assert.equal(assess(probes[0],200,'{"version":"1","setupRequired":false}').ok,true);
  assert.equal(assess(probes[0],200,'{"version":"1","setupRequired":true}').ok,false);
  assert.equal(assess(probes.find(p=>p.path==='/api/network'),200,'{}').ok,false);
  assert.equal(assess(probes[0],429,'',new Headers()).ok,false);
  assert.equal(assess(probes[0],429,'',new Headers({'retry-after':'60'})).kind,'throttled');
  assert.equal(assess(probes[0],500,'{}').ok,false);
});

function mockRequest(_base,probe) {
  return Promise.resolve({
    status:probe.expected,
    headers:new Headers(),
    body:probe.type==='status'?'{"version":"2","setupRequired":false}':
      probe.type==='branding'?'{"brandName":"LightNAS"}':
      probe.type==='html'?'<html></html>':'{}',
    ms:2
  });
}

test('controlled run collects response codes and latency without doing writes', {timeout:10000},async()=>{
  const logs=[];
  const report=await runStress({
    ...parseOptions([]),seconds:0.45,rps:40,concurrency:3
  },{request:mockRequest,logger:{log:s=>logs.push(s)}});
  assert.equal(report.passed,true);
  assert.ok(report.requests>=5,JSON.stringify(report));
  assert.equal(report.failures,0);
  assert.equal(report.transportErrors,0);
  assert.equal(report.latencyMs.p95,2);
  assert.ok(logs[0].includes('"mode": "read-only"'));
});

test('preflight refuses uninitialized and inaccessible services before load starts',async()=>{
  let invoked=0;
  const request=async()=>{invoked++;return {status:200,body:'{"version":"1","setupRequired":true}',headers:new Headers()};};
  await assert.rejects(runStress({...parseOptions([]),seconds:0.01},{request,logger:{log(){}}}),/Preflight failed/);
  assert.equal(invoked,1);
});

test('load stops after repeated 5xx rather than pounding an unhealthy instance', {timeout:10000},async()=>{
  let attempts=0;
  const request=async(_base,probe)=>{
    attempts++;
    return {status:attempts===1?200:503,
      body:attempts===1?'{"version":"1","setupRequired":false}':'',
      headers:new Headers(),ms:1};
  };
  const report=await runStress({...parseOptions([]),seconds:1,rps:100,concurrency:2},
    {request,logger:{log(){}}});
  assert.equal(report.passed,false);
  assert.ok(report.failures>=10);
  assert.ok(report.requests<=20,'Runner should abort promptly');
});
