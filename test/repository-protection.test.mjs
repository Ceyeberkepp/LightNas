import test from 'node:test';
import assert from 'node:assert/strict';
import {auditProtection,auditRepository,branchRules,releaseLockRules,MERGE_CHECKS} from '../scripts/repository-protection.mjs';
const app=123;
function fixture(){return {branch:{name:'main',protected:true},actionsAppId:app,rulesets:[branchRules(app),releaseLockRules()]};}
test('complete enforced rules pass and require full i386 and exact-head aggregation',()=>{
 assert.equal(auditProtection(fixture()).passed,true);
 assert.ok(MERGE_CHECKS.includes('full-i386'));
 assert.ok(MERGE_CHECKS.includes('release-qualification'));
});
test('missing, disabled, partial, bypassable and forged-source protection fails',()=>{
 const variants=[
  x=>{x.branch.protected=false;},x=>{x.rulesets=[];},
  x=>{x.rulesets[0].enforcement='evaluate';},
  x=>{x.rulesets[0].bypass_actors=[{actor_type:'RepositoryRole',actor_id:5,bypass_mode:'always'}];},
  x=>{x.rulesets[0].conditions.ref_name.exclude=['refs/heads/main'];},
  x=>{x.rulesets[0].rules=x.rulesets[0].rules.filter(r=>r.type!=='pull_request');},
  x=>{x.rulesets[0].rules.find(r=>r.type==='pull_request').parameters.require_last_push_approval=false;},
  x=>{delete x.rulesets[0].rules.find(r=>r.type==='pull_request').parameters.required_approving_review_count;},
  x=>{x.rulesets[0].rules.find(r=>r.type==='required_status_checks').parameters.required_status_checks.pop();},
  x=>{x.rulesets[0].rules.find(r=>r.type==='required_status_checks').parameters.required_status_checks[0].integration_id=null;},
  x=>{x.rulesets[0].rules.find(r=>r.type==='required_status_checks').parameters.strict_required_status_checks_policy=false;},
  x=>{x.rulesets[1].rules=x.rulesets[1].rules.filter(r=>r.type!=='creation');},
  x=>{x.rulesets[1].bypass_actors=[{actor_type:'Integration',actor_id:1,bypass_mode:'always'}];}
 ];
 for(const mutate of variants){const f=fixture();mutate(f);assert.equal(auditProtection(f).passed,false);}
});
test('HTTP access failures cannot be treated as a passing audit',async()=>{
 await assert.rejects(auditRepository({repo:'example/nas',token:'test',api:async()=>({ok:false,status:403})}),/HTTP 403/);
});
test('rules payload requires verified Actions identity and never guesses release approvers',()=>{
 assert.throws(()=>branchRules(null),/app ID/);
 assert.deepEqual(releaseLockRules().bypass_actors,[]);
});
