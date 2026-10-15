import test from 'node:test';
import assert from 'node:assert/strict';
import {KubernetesAdapter,KUBERNETES_TYPES} from '../src/storage-agent/kubernetes.js';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function fixture(options={}) {
 const calls=[];
 let resourceVersion='3';
 let replicas=2;
 const run=async(bin,args)=>{
  calls.push({bin,args});
  if(args[0]==='is-active')return {ok:true,stdout:'active'};
  if(args[0]==='--version')return {ok:true,stdout:'k3s version v1.37.1+k3s1'};
  if(args.includes('deployment')&&args.includes('get'))return {ok:true,stdout:JSON.stringify({metadata:{uid:'deployment-uid',resourceVersion},spec:{replicas}})};
  if(args.includes('scale'))replicas=Number(args.find(v=>v.startsWith('--replicas=')).split('=')[1]);
  return {ok:true,stdout:'{}',stderr:''};
 };
 const adapter=new KubernetesAdapter({run,architecture:'amd64',memoryMiB:4096,cores:2,exists:async()=>false,...options});
 return {adapter,calls,change:()=>resourceVersion='4'};
}

test('typed Kubernetes operations reject arbitrary commands and install fields',async()=>{
 const {adapter}=fixture();
 assert.equal(KUBERNETES_TYPES.length,4);
 await assert.rejects(adapter.plan({type:'kubernetes.exec',command:'sh'}),/Unsupported/);
 await assert.rejects(adapter.plan({type:'kubernetes.install',command:'sh'}),/Unexpected/);
});

test('deployment scale binds approval to identity, revision and old replica count',async()=>{
 const {adapter,change}=fixture();
 const impact=await adapter.plan({type:'kubernetes.scale',namespace:'default',name:'web',replicas:3});
 assert.equal(impact.identity.uid,'deployment-uid');
 assert.ok(impact.commands[0].args.includes('--current-replicas=2'));
 assert.ok(impact.commands[0].args.includes('--resource-version=3'));
 await adapter.validate(impact);
 change();
 await assert.rejects(adapter.validate(impact),/state changed/);
});

test('scale verifies the resulting deployment and rejects invalid replicas',async()=>{
 const {adapter}=fixture();
 await assert.rejects(adapter.plan({type:'kubernetes.scale',namespace:'default',name:'web',replicas:101}),/Replicas/);
 const impact=await adapter.plan({type:'kubernetes.scale',namespace:'default',name:'web',replicas:3});
 assert.equal((await adapter.apply(impact)).replicas,3);
});

test('restart patch has optimistic resource and UID checks',async()=>{
 const {adapter}=fixture();
 const input=adapter.prepare({type:'kubernetes.restart',namespace:'default',name:'web'});
 const impact=await adapter.plan(input);
 const patch=JSON.parse(impact.commands[0].args.at(-1));
 assert.deepEqual(patch.metadata,{uid:'deployment-uid',resourceVersion:'3'});
 assert.equal(patch.spec.template.metadata.annotations['kubectl.kubernetes.io/restartedAt'],input.restartStamp);
});

test('join secret stays out of command arguments and temporary request is removed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lightnas-kube-'));
 const token='K10'+'a'.repeat(64)+'::server:private-password';
 const {adapter,calls}=fixture({dir,exists:async p=>p==='/run/systemd/system'||p==='/sys/fs/cgroup'});
 const originalRun=adapter.run;
 adapter.run=async(bin,args,...rest)=>{
  assert.ok(!JSON.stringify(args).includes(token));
  if(bin==='/usr/bin/systemd-run'){
   const path=args.at(-1),request=JSON.parse(await readFile(path,'utf8'));
   assert.equal(request.token,token);
  }
  return originalRun(bin,args,...rest);
 };
 try{
  const impact=await adapter.plan({type:'kubernetes.install',mode:'agent',server:'https://192.168.1.2:6443',private:{token}});
  await adapter.apply(impact);
  const path=calls.find(c=>c.bin==='/usr/bin/systemd-run').args.at(-1);
  await assert.rejects(readFile(path),{code:'ENOENT'});
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('existing installations are never overwritten and runtime gaps remain explicit',async()=>{
 await assert.rejects(fixture({exists:async()=>true}).adapter.plan({type:'kubernetes.install'}),/not be overwritten/);
 await assert.rejects(fixture({architecture:'riscv64'}).adapter.plan({type:'kubernetes.install'}),/No pinned K3s/);
 const status=await fixture({architecture:'riscv64'}).adapter.inventory();
 assert.equal(status.supported,false);
 assert.deepEqual(status.pods,[]);
});
