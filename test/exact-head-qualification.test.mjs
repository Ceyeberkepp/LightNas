import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,assertHead,REQUIRED_CHECKS,REQUIRED_SOURCES,verify,trustedChecks} from '../scripts/check-pr-exact-head.mjs';
const head='a'.repeat(40),baseSha='b'.repeat(40),repo='example/nas';
const workflows=new Map();
for(const [name,[workflow,path]] of Object.entries(REQUIRED_SOURCES))workflows.set(path,{name:workflow,path});
const runs=[...workflows.values()].map((x,i)=>({id:100+i,event:'pull_request',head_sha:head,...x}));
const runFor=name=>runs.find(r=>r.path===REQUIRED_SOURCES[name][1]);
function items(conclusion='success'){
 return REQUIRED_CHECKS.map((name,i)=>({name,status:'completed',conclusion,head_sha:head,app:{slug:'github-actions'},details_url:'https://github.com/'+repo+'/actions/runs/'+runFor(name).id+'/job/'+(200+i),workflow_name:REQUIRED_SOURCES[name][0],workflow_path:REQUIRED_SOURCES[name][1]}));
}
function mock(responses){const seen=[];return {seen,api:async(url)=>{const path=new URL(url).pathname.replace('/repos/'+repo,'')+new URL(url).search;seen.push(path);return {ok:true,json:async()=>responses[path]};}};}
function responses(checks=items(),workflowRuns=runs){return {
 '/pulls/91':{head:{sha:head},base:{sha:baseSha}},
 '/branches/main':{commit:{sha:baseSha}},
 ['/compare/'+baseSha+'...'+head]:{behind_by:0,status:'ahead'},
 ['/commits/'+head+'/check-runs?per_page=100&page=1']:{check_runs:checks},
 ['/actions/runs?head_sha='+head+'&event=pull_request&per_page=100&page=1']:{workflow_runs:workflowRuns}
};}
test('requires full exact-head i386 completion',()=>{
 const checks=items();checks.find(c=>c.name==='full-i386').status='in_progress';
 assert.equal(evaluate(checks).passed,false);
 assert.ok(evaluate(checks).pending.includes('full-i386'));
 assert.equal(evaluate(items()).passed,true);
});
test('no missing, skipped, cancelled, neutral or failed job qualifies',()=>{
 assert.equal(evaluate(items().filter(c=>c.name!=='full-i386')).passed,false);
 for(const state of ['skipped','cancelled','failure','neutral','timed_out']){
  const c=items();c[0].conclusion=state;assert.equal(evaluate(c).passed,false,state);
 }
});
test('stale head or base is rejected',()=>{
 const obj={expected:head,pr:{head:{sha:head},base:{sha:baseSha}},base:{sha:baseSha},comparison:{behind_by:0,status:'ahead'}};
 assert.doesNotThrow(()=>assertHead(obj));
 assert.throws(()=>assertHead({...obj,expected:'c'.repeat(40)}),/head changed/);
 assert.throws(()=>assertHead({...obj,pr:{head:{sha:head},base:{sha:'c'.repeat(40)}}}),/base snapshot/);
 assert.throws(()=>assertHead({...obj,comparison:{behind_by:1,status:'diverged'}}),/behind main/);
});
test('integration only accepts expected exact-head GitHub Actions workflow run',async()=>{
 const checks=items().map(c=>c.name==='full-i386'?{...c,status:'queued'}:c);
 const {api,seen}=mock(responses(checks));
 const result=await verify({repo,prNumber:91,sha:head,token:'test',api});
 assert.equal(result.passed,false);
 assert.ok(result.pending.includes('full-i386'));
 assert.equal(seen.length,5);
});
test('forged successful check from another workflow cannot mask failed native i386',()=>{
 const checks=items();checks.find(c=>c.name==='full-i386').conclusion='failure';
 checks.push({...checks.find(c=>c.name==='full-i386'),conclusion:'success',details_url:'https://github.com/'+repo+'/actions/runs/999/job/999',started_at:'2099-01-01T00:00:00Z'});
 const result=evaluate(trustedChecks(checks,runs,repo,head));
 assert.equal(result.passed,false);
 assert.ok(result.failed.some(x=>x.includes('full-i386')));
});
test('missing SHA, non-Actions app, wrong workflow file or foreign repository cannot satisfy required job',()=>{
 const variants=[
  c=>({...c,head_sha:undefined}),
  c=>({...c,app:{slug:'other-ci'}}),
  c=>({...c,details_url:'https://github.com/other/repo/actions/runs/100/job/123'}),
  c=>({...c,details_url:'https://github.com/example/nas/actions/runs/999/job/123'}),
 ];
 for(const mutate of variants){
  const checks=items();checks[0]=mutate(checks[0]);
  assert.ok(evaluate(trustedChecks(checks,runs,repo,head)).pending.includes(checks[0].name));
 }
 const alteredRuns=runs.map(r=>r.path==='.github/workflows/concurrent-api-qualification.yml'?{...r,path:'.github/workflows/evil.yml'}:r);
 assert.ok(evaluate(trustedChecks(items(),alteredRuns,repo,head)).pending.includes('qualification (22)'));
});
test('successful exact-head workflow matrix passes with provenance checks',async()=>{
 const {api}=mock(responses());
 assert.equal((await verify({repo,prNumber:91,sha:head,token:'test',api})).passed,true);
});
