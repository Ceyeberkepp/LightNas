// Migration boot-test authorization and rollback preview; does not power on guests.
const NAME=/^[A-Za-z][A-Za-z0-9-]{1,39}$/;
const SHA=/^[a-f0-9]{64}$/i;
function reject(s){throw Object.assign(new Error(s),{status:400});}
export function previewMigrationBootTest(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!NAME.test(input.name)||!SHA.test(input.diskSha256||''))
  reject('A valid VM identifier and verified disk checksum are required');
 const checks=[
  ['offlineVerified', 'VM must pass disk, firmware and configuration verification'],
  ['isolatedNetwork', 'Boot test must use an isolated, non-production network'],
  ['snapshotConfirmed', 'A restorable pre-boot snapshot or backup is required'],
  ['sourceUnchanged', 'Original source workload must remain intact'],
  ['rollbackReviewed', 'Rollback scope and downtime must be reviewed']
 ];
 const blockers=checks.filter(([field])=>input[field]!==true).map(([,text])=>text);
 if(input.productionNetwork===true)blockers.push('Production network is not permitted for automated boot test');
 return {phase:'migration-boot-test-plan',name:input.name,diskSha256:input.diskSha256,
  readOnly:true,bootStarted:false,rollbackPerformed:false,
  canExecute:false,blockers,requiredChecks:checks.map(([key])=>key),
  nextStep:'Integrate isolated hypervisor test runner, timeouts and verified rollback'};
}
export function previewMigrationRollback(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!NAME.test(input.name)||!SHA.test(input.backupSha256||''))
  reject('Verified backup identity required');
 const steps=[
  'Stop or isolate restored destination workload using the controlled runtime',
  'Validate immutable source backup and checksum before disk changes',
  'Restore backup to a separate replacement target; never overwrite the source',
  'Verify restored target offline and review network and identity mappings',
  'Require explicit operator confirmation before production cutover'
 ];
 return {phase:'migration-rollback-plan',name:input.name,backupSha256:input.backupSha256,
  steps,executed:false,destructiveActionsAuthorized:false};
}
