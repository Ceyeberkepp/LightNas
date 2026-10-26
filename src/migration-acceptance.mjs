// Fail-closed migration acceptance. Claims of zero data loss require evidence,
// not just a completed transfer or a successful boot.
const TYPES=new Set(['vm','container','app','storage','share','network','identity','setting']);
const SHA=/^[a-f0-9]{64}$/i;
const REQUIRED={
 vm:['sourceBackupVerified','destinationChecksumVerified','diskLayoutVerified','guestBootVerified','servicesHealthy','networkVerified','rollbackTested'],
 container:['sourceBackupVerified','destinationChecksumVerified','ownershipVerified','aclVerified','guestBootVerified','servicesHealthy','networkVerified','rollbackTested'],
 app:['sourceBackupVerified','destinationChecksumVerified','configurationVerified','persistentVolumesVerified','secretsReprovisioned','servicesHealthy','rollbackTested'],
 storage:['sourceSnapshotVerified','destinationChecksumVerified','fileCountVerified','ownershipVerified','aclVerified','rollbackTested'],
 share:['sourceSnapshotVerified','destinationChecksumVerified','fileCountVerified','ownershipVerified','aclVerified','clientAccessVerified','rollbackTested'],
 network:['configurationVerified','networkVerified','rollbackTested'],
 identity:['configurationVerified','ownershipVerified','aclVerified','rollbackTested'],
 setting:['configurationVerified','rollbackTested']
};
export function evaluateMigrationAcceptance(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!TYPES.has(input.type))
  throw Object.assign(new Error('Invalid migration acceptance request'),{status:400});
 const checks=input.checks;
 if(!checks||typeof checks!=='object'||Array.isArray(checks))
  throw Object.assign(new Error('Evidence checklist required'),{status:400});
 const missing=REQUIRED[input.type].filter(key=>checks[key]!==true);
 if(['vm','container','app','storage','share'].includes(input.type)&&(!SHA.test(input.sourceSha256||'')||input.sourceSha256!==input.destinationSha256))
  missing.push('matchingSourceDestinationSha256');
 if(input.sourcePreserved!==true)missing.push('sourcePreserved');
 if(input.operatorApproved!==true)missing.push('operatorApproved');
 // This is a recorded evidence review only. It cannot authorize a live cutover.
 return {phase:'migration-acceptance-review',type:input.type,
   evidenceComplete:missing.length===0,missing,
   sourcePreserved:input.sourcePreserved===true,
   dataLossProven:false,productionCutoverAuthorized:false,
   sourceDeletionAuthorized:false,rollbackExecutionAuthorized:false,
   note:'External verification, application-consistency testing and explicit cutover authorization remain required'};
}
