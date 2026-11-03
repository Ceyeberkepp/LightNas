#!/usr/bin/env node
// Exact-head qualification. Advisory until GitHub branch rulesets require this
// job and forbid admin bypass. Fail closed on missing, skipped or pending jobs.
import {setTimeout as delay} from 'node:timers/promises';

export const REQUIRED_CHECKS=Object.freeze([
 'qualification (22)','qualification (24)','dependency-audit',
 'native-runtime (amd64, linux/amd64, node:22-bookworm-slim)',
 'native-runtime (arm64, linux/arm64, node:22-bookworm-slim)',
 'native-runtime (armhf, linux/arm/v7, node:22-bookworm-slim)',
 'native-runtime (riscv64, linux/riscv64, debian:sid-slim)',
 'full-i386','validate'
]);
const SHA=/^[a-f0-9]{40}$/i;
export function evaluate(checks,expected=REQUIRED_CHECKS){
 const statuses=new Map();
 for(const check of checks){
  if(!expected.includes(check.name))continue;
  const prior=statuses.get(check.name);
  if(!prior||String(check.started_at||check.created_at||'')>String(prior.started_at||prior.created_at||''))statuses.set(check.name,check);
 }
 const pending=[],failed=[];
 for(const name of expected){
  const c=statuses.get(name);
  if(!c||c.status!=='completed')pending.push(name);
  else if(c.conclusion!=='success')failed.push(name+' ('+c.conclusion+')');
 }
 return {passed:pending.length===0&&failed.length===0,pending,failed};
}
export function assertHead({expected,pr,base,comparison}){
 if(!SHA.test(expected)||pr.head.sha!==expected)throw Error('PR head changed; exact-head approval is stale');
 if(pr.base.sha!==base.sha)throw Error('PR base snapshot is stale');
 if(comparison.behind_by!==0)throw Error('PR head is behind main; update branch before merge');
 if(comparison.status==='diverged'&&comparison.behind_by>0)throw Error('PR merge base requires update');
}
async function github(path,token,api){
 const response=await api('https://api.github.com'+path,{
  headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
 });
 if(!response.ok)throw Error('GitHub check API failed: HTTP '+response.status+' '+path);
 return response.json();
}
export async function verify({repo,prNumber,sha,token,api=fetch,baseBranch='main'}){
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)||!Number.isSafeInteger(prNumber)||prNumber<1||!SHA.test(sha)||!token)throw Error('Invalid qualification inputs');
 const pr=await github('/repos/'+repo+'/pulls/'+prNumber,token,api);
 const base=await github('/repos/'+repo+'/branches/'+encodeURIComponent(baseBranch),token,api);
 const comparison=await github('/repos/'+repo+'/compare/'+base.commit.sha+'...'+sha,token,api);
 assertHead({expected:sha,pr,base:{sha:base.commit.sha},comparison});
 let checks=[];
 for(let page=1;page<=20;page++){
  const result=await github('/repos/'+repo+'/commits/'+sha+'/check-runs?per_page=100&page='+page,token,api);
  checks.push(...(result.check_runs||[]));
  if((result.check_runs||[]).length<100)break;
  if(page===20)throw Error('Too many check runs; refuses incomplete pagination');
 }
 const current=checks.filter(c=>!c.head_sha||c.head_sha===sha);
 return evaluate(current);
}
async function main(){
 const {GITHUB_REPOSITORY,GITHUB_TOKEN,PR_NUMBER,PR_HEAD_SHA,PR_BASE_BRANCH='main'}=process.env;
 const number=Number(PR_NUMBER);
 const deadline=Date.now()+75*60*1000;
 while(true){
  const result=await verify({repo:GITHUB_REPOSITORY,prNumber:number,sha:PR_HEAD_SHA,token:GITHUB_TOKEN,baseBranch:PR_BASE_BRANCH});
  if(result.failed.length)throw Error('Required exact-head jobs failed/skipped: '+result.failed.join(', '));
  if(result.passed){console.log('Full exact-head CI is complete and successful for '+PR_HEAD_SHA);return;}
  if(Date.now()>=deadline)throw Error('Required exact-head jobs remain incomplete: '+result.pending.join(', '));
  console.log('Waiting on exact-head checks: '+result.pending.join(', '));
  await delay(20000);
 }
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
