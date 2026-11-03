#!/usr/bin/env node
// Advisory until non-bypass branch rulesets require this exact-head check.
// Only accept jobs from trusted GitHub Actions workflows on the PR head SHA.
import {setTimeout as delay} from 'node:timers/promises';
export const REQUIRED_SOURCES=Object.freeze({
 'qualification (22)': ['Concurrent API qualification','.github/workflows/concurrent-api-qualification.yml'],
 'qualification (24)': ['Concurrent API qualification','.github/workflows/concurrent-api-qualification.yml'],
 'dependency-audit': ['Production dependency vulnerability gate','.github/workflows/dependency-audit.yml'],
 'native-runtime (amd64, linux/amd64, node:22-bookworm-slim)': ['Native platform runtime qualification','.github/workflows/platform-matrix.yml'],
 'native-runtime (arm64, linux/arm64, node:22-bookworm-slim)': ['Native platform runtime qualification','.github/workflows/platform-matrix.yml'],
 'native-runtime (armhf, linux/arm/v7, node:22-bookworm-slim)': ['Native platform runtime qualification','.github/workflows/platform-matrix.yml'],
 'native-runtime (riscv64, linux/riscv64, debian:sid-slim)': ['Native platform runtime qualification','.github/workflows/platform-matrix.yml'],
 'full-i386': ['Native platform runtime qualification','.github/workflows/platform-matrix.yml'],
 'validate': ['Build LightNAS ISO','.github/workflows/build-iso.yml']
});
export const REQUIRED_CHECKS=Object.freeze(Object.keys(REQUIRED_SOURCES));
const SHA=/^[a-f0-9]{40}$/i;
const MAX_PAGES=20;
const WAIT_MINUTES=350; // i386 source build can take almost six hours.
export function evaluate(checks,expected=REQUIRED_CHECKS){
 const statuses=new Map();
 for(const check of checks){
  const source=REQUIRED_SOURCES[check.name];
  if(!expected.includes(check.name)||!source)continue;
  if(check.app?.slug!=='github-actions'||check.workflow_name!==source[0]||check.workflow_path!==source[1])continue;
  // A new queued job has no started_at. Never let an older started job
  // outrank a newer queued check from the same exact SHA.
  if(!check.created_at||!Number.isSafeInteger(check.id))continue;
  const prior=statuses.get(check.name);
  if(!prior||check.created_at>prior.created_at||
     (check.created_at===prior.created_at&&check.id>prior.id))statuses.set(check.name,check);
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
}
async function github(path,token,api){
 const response=await api('https://api.github.com'+path,{
  headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
 });
 if(!response.ok)throw Error('GitHub check API failed: HTTP '+response.status+' '+path);
 return response.json();
}
async function pages(repo,resource,token,api,key){
 const collected=[];
 for(let page=1;page<=MAX_PAGES;page++){
  const separator=resource.includes('?')?'&':'?';
  const result=await github('/repos/'+repo+'/'+resource+separator+'per_page=100&page='+page,token,api);
  const batch=result[key];
  if(!Array.isArray(batch))throw Error('Malformed GitHub '+key+' response');
  collected.push(...batch);
  if(batch.length<100)return collected;
 }
 throw Error('Too many '+key+' results; refusing incomplete pagination');
}
export function trustedChecks(checks,runs,repo,sha){
 // Only the latest workflow invocation per source path can qualify.
 // A newer queued/running rerun at the same SHA invalidates older green jobs.
 const latestRuns=new Map();
 for(const run of runs){
  if(run.head_sha!==sha||run.event!=='pull_request'||
     !Number.isSafeInteger(run.id)||!run.created_at||!run.path)continue;
  const prior=latestRuns.get(run.path);
  if(!prior||run.created_at>prior.created_at||
     (run.created_at===prior.created_at&&run.id>prior.id))latestRuns.set(run.path,run);
 }
 const prefix='https://github.com/'+repo+'/actions/runs/';
 return checks.flatMap(check=>{
  if(check.head_sha!==sha||check.app?.slug!=='github-actions')return [];
  const url=check.details_url||'';
  if(!url.startsWith(prefix))return [];
  const match=/^(\\d+)\\/job\\/\\d+(?:\\?.*)?$/.exec(url.slice(prefix.length));
  if(!match)return [];
  const expected=REQUIRED_SOURCES[check.name];
  if(!expected)return [];
  const run=latestRuns.get(expected[1]);
  if(!run||run.id!==Number(match[1])||run.name!==expected[0])return [];
  const workflowFailed=run.status==='completed'&&run.conclusion!=='success';
  return [{...check,workflow_name:run.name,workflow_path:run.path,
   status:workflowFailed?'completed':run.status==='completed'?check.status:run.status,
   conclusion:workflowFailed?(run.conclusion||'failure'):check.conclusion}];
 });
}
export async function verify({repo,prNumber,sha,token,api=fetch,baseBranch='main'}){
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)||!Number.isSafeInteger(prNumber)||prNumber<1||!SHA.test(sha)||!token)throw Error('Invalid qualification inputs');
 const pr=await github('/repos/'+repo+'/pulls/'+prNumber,token,api);
 const base=await github('/repos/'+repo+'/branches/'+encodeURIComponent(baseBranch),token,api);
 const comparison=await github('/repos/'+repo+'/compare/'+base.commit.sha+'...'+sha,token,api);
 assertHead({expected:sha,pr,base:{sha:base.commit.sha},comparison});
 const [runs,checks]=await Promise.all([
  pages(repo,'actions/runs?head_sha='+sha+'&event=pull_request',token,api,'workflow_runs'),
  pages(repo,'commits/'+sha+'/check-runs',token,api,'check_runs')
 ]);
 return evaluate(trustedChecks(checks,runs,repo,sha));
}
async function main(){
 const {GITHUB_REPOSITORY,GITHUB_TOKEN,PR_NUMBER,PR_HEAD_SHA,PR_BASE_BRANCH='main'}=process.env;
 const number=Number(PR_NUMBER);
 const deadline=Date.now()+WAIT_MINUTES*60*1000;
 while(true){
  const result=await verify({repo:GITHUB_REPOSITORY,prNumber:number,sha:PR_HEAD_SHA,token:GITHUB_TOKEN,baseBranch:PR_BASE_BRANCH});
  if(result.failed.length)throw Error('Required exact-head jobs failed/skipped: '+result.failed.join(', '));
  if(result.passed){console.log('Full exact-head CI is complete and successful for '+PR_HEAD_SHA);return;}
  if(Date.now()>=deadline)throw Error('Required exact-head jobs remain incomplete: '+result.pending.join(', '));
  console.log('Waiting on exact-head checks: '+result.pending.join(', '));
  await delay(120000);
 }
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
