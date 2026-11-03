import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,assertHead,REQUIRED_CHECKS,verify} from '../scripts/check-pr-exact-head.mjs';
const head='a'.repeat(40),baseSha='b'.repeat(40);
function items(conclusion='success'){return REQUIRED_CHECKS.map(name=>({name,status:'completed',conclusion,head_sha:head}));}

test('release qualification requires exact-head i386 job completion, not workflow-level success',()=>{
 const checks=items();
 checks.find(c=>c.name==='full-i386').status='in_progress';
 const result=evaluate(checks);
 assert.equal(result.passed,false);
 assert.ok(result.pending.includes('full-i386'));
 assert.equal(evaluate(items()).passed,true);
});

test('no missing, skipped, cancelled or failed architecture job qualifies a merge',()=>{
 assert.equal(evaluate(items().filter(c=>c.name!=='full-i386')).passed,false);
 for(const state of ['skipped','cancelled','failure','neutral','timed_out']){
  const c=items();c[0].conclusion=state;
  assert.equal(evaluate(c).passed,false,state);
 }
});

test('stale head and main update are rejected',()=>{
 const obj={expected:head,pr:{head:{sha:head},base:{sha:baseSha}},base:{sha:baseSha},comparison:{behind_by:0,status:'ahead'}};
 assert.doesNotThrow(()=>assertHead(obj));
 assert.throws(()=>assertHead({...obj,expected:'c'.repeat(40)}),/head changed/);
 assert.throws(()=>assertHead({...obj,pr:{head:{sha:head},base:{sha:'c'.repeat(40)}}}),/base snapshot/);
 assert.throws(()=>assertHead({...obj,comparison:{behind_by:1,status:'diverged'}}),/behind main/);
});

test('integration mock reads only exact SHA and blocks pending full-i386',async()=>{
 const responses={
  '/pulls/91':{head:{sha:head},base:{sha:baseSha}},
  '/branches/main':{commit:{sha:baseSha}},
  ['/compare/'+baseSha+'...'+head]:{behind_by:0,status:'ahead'},
  ['/commits/'+head+'/check-runs?per_page=100&page=1']:{check_runs:items().map(c=>c.name==='full-i386'?{...c,status:'queued'}:c)}
 };
 const seen=[];
 const api=async(url)=>{const path=new URL(url).pathname.replace('/repos/example/nas','')+new URL(url).search;seen.push(path);return {ok:true,json:async()=>responses[path]};};
 const result=await verify({repo:'example/nas',prNumber:91,sha:head,token:'test',api});
 assert.equal(result.passed,false);
 assert.ok(result.pending.includes('full-i386'));
 assert.equal(seen.length,4);
});
