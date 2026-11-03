#!/usr/bin/env node
// Read-only audit. Repository files cannot activate GitHub rulesets.
import {pathToFileURL} from 'node:url';
import {REQUIRED_CHECKS} from './check-pr-exact-head.mjs';
export const MERGE_CHECKS=Object.freeze(['test','release-qualification','repository-protection-audit',...REQUIRED_CHECKS]);
export function branchRules(actionsAppId){
 if(!Number.isSafeInteger(actionsAppId)||actionsAppId<1)throw Error('Verified GitHub Actions app ID required');
 return {name:'LightNAS main qualification',target:'branch',enforcement:'active',bypass_actors:[],
  conditions:{ref_name:{include:['refs/heads/main'],exclude:[]}},rules:[
   {type:'deletion'},{type:'non_fast_forward'},
   {type:'pull_request',parameters:{required_approving_review_count:1,dismiss_stale_reviews_on_push:true,
    require_code_owner_review:false,require_last_push_approval:true,required_review_thread_resolution:true}},
   {type:'required_status_checks',parameters:{strict_required_status_checks_policy:true,
    do_not_enforce_on_create:false,required_status_checks:MERGE_CHECKS.map(context=>({context,integration_id:actionsAppId}))}}
  ]};
}
function targets(rule,ref){
 const conditions=rule.conditions?.ref_name;
 // Accept only explicit target rules here. Broad patterns need independent
 // inspection rather than guessing GitHub's fnmatch semantics.
 return conditions?.include?.includes(ref)&&Array.isArray(conditions.exclude)&&conditions.exclude.length===0;
}
export function auditProtection({branch,rulesets,actionsAppId}){
 const failures=[];
 if(branch?.name!=='main'||branch.protected!==true)failures.push('main is not protected');
 const applicable=(rulesets||[]).filter(r=>r.target==='branch'&&r.enforcement==='active'&&targets(r,'refs/heads/main'));
 // Require a single complete ruleset so bypasses in a partial ruleset cannot
 // appear to provide protections from a different one.
 const valid=applicable.some(r=>{
  if(!Array.isArray(r.bypass_actors)||r.bypass_actors.length)return false;
  const types=new Map((r.rules||[]).map(rule=>[rule.type,rule.parameters||{}]));
  const pr=types.get('pull_request'),status=types.get('required_status_checks');
  if(!types.has('deletion')||!types.has('non_fast_forward')||!pr||!status)return false;
  if(!Number.isInteger(pr.required_approving_review_count)||pr.required_approving_review_count<1||pr.dismiss_stale_reviews_on_push!==true||
    pr.require_last_push_approval!==true||pr.required_review_thread_resolution!==true)return false;
  if(status.strict_required_status_checks_policy!==true||status.do_not_enforce_on_create===true)return false;
  return Number.isSafeInteger(actionsAppId)&&actionsAppId>0&&MERGE_CHECKS.every(name=>
   status.required_status_checks?.some(c=>c.context===name&&c.integration_id===actionsAppId));
 });
 if(!valid)failures.push('missing complete active main ruleset with no bypass, independent review and full Actions checks');
 const tags=(rulesets||[]).filter(r=>r.target==='tag'&&r.enforcement==='active'&&targets(r,'refs/tags/v*'));
 if(!tags.some(r=>Array.isArray(r.bypass_actors)&&r.bypass_actors.length===0&&
   ['creation','update','deletion'].every(t=>r.rules?.some(x=>x.type===t))))
  failures.push('release tags are not locked against unapproved creation, replacement and deletion');
 return {passed:failures.length===0,failures};
}
export function releaseLockRules(){
 // No approver identities are guessed. This locks release tags for everyone
 // until a separately reviewed release authorization changes the policy.
 return {name:'LightNAS release hold',target:'tag',enforcement:'active',bypass_actors:[],
  conditions:{ref_name:{include:['refs/tags/v*'],exclude:[]}},rules:[{type:'creation'},{type:'update'},{type:'deletion'}]};
}
export async function auditRepository({repo,token,api=fetch}){
 if(!/^[\w.-]+\/[\w.-]+$/.test(repo)||!token)throw Error('Repository and read token required');
 const get=async path=>{
  const res=await api('https://api.github.com/repos/'+repo+'/'+path,{headers:{
   Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
  if(!res.ok)throw Error('Cannot verify repository protection: HTTP '+res.status+' '+path);
  return res.json();
 };
 const branch=await get('branches/main');
 const summaries=[];
 for(let page=1;page<=20;page++){
  const batch=await get('rulesets?includes_parents=true&per_page=100&page='+page);
  if(!Array.isArray(batch))throw Error('Invalid ruleset response');
  summaries.push(...batch);
  if(batch.length<100)break;
  if(page===20)throw Error('Incomplete ruleset pagination');
 }
 const rulesets=[];
 for(const rule of summaries){
  if(!Number.isSafeInteger(rule.id)||rule.source_type!=='Repository')throw Error('Inherited or invalid ruleset requires separate review');
  rulesets.push(await get('rulesets/'+rule.id));
 }
 // GitHub returns the app identity on the repository's actual check runs.
 const checks=await get('commits/'+branch.commit.sha+'/check-runs?per_page=100');
 const identities=new Set((checks.check_runs||[]).filter(c=>c.app?.slug==='github-actions').map(c=>c.app.id));
 if(identities.size!==1)throw Error('Cannot establish a unique GitHub Actions app identity');
 const actionsAppId=[...identities][0];
 return {...auditProtection({branch,rulesets,actionsAppId}),actionsAppId,branchSha:branch.commit.sha};
}
async function main(){
 const result=await auditRepository({repo:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN});
 console.log(JSON.stringify(result,null,2));
 if(!result.passed)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main().catch(e=>{console.error(e.message);process.exitCode=1;});
