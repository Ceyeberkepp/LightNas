// Approval is a bounded validation contract, not authorization to run tar or create containers.
import {planVerifiedLxcRestore} from './migration-lxc-restore-plan.mjs';
const validHash=/^[a-f0-9]{64}$/i;
const knownDecisions=['idMappingReviewed','aclReviewed','mountsReviewed','networkReviewed','backupConfirmed','downtimeApproved'];
export function evaluateLxcRestoreApproval(plan,input) {
 if(!plan||plan.phase!=='lxc-restore-plan'||!plan.readyForManualReview)
   throw Object.assign(new Error('Destination and archive preflight must pass'),{status:409});
 if(!input||typeof input!=='object'||Array.isArray(input))
   throw Object.assign(new Error('Invalid restore approval'),{status:400});
 const decisions=input.decisions;
 if(!decisions||typeof decisions!=='object'||Array.isArray(decisions))
   throw Object.assign(new Error('Review decisions required'),{status:400});
 const missing=knownDecisions.filter(key=>decisions[key]!==true);
 const matches=validHash.test(input.archiveSha256||'')&&input.archiveSha256.toLowerCase()===plan.archiveSha256?.toLowerCase();
 if(!matches)missing.push('archiveSha256');
 if(input.confirm!=='REVIEW_LXC_RESTORE')missing.push('confirm');
 return {phase:'lxc-restore-approval',reviewComplete:missing.length===0,
   approvedForExecution:false,restoreStarted:false,missing,
   archiveSha256:plan.archiveSha256,destination:plan.destination,
   nextStep:'Implement isolated root-owned restore executor with rollback before execution is allowed'};
}
export async function reviewVerifiedLxcRestore(input,providers={}) {
 const plan=await planVerifiedLxcRestore(input,providers);
 return evaluateLxcRestoreApproval(plan,input);
}
