// Fail-closed dependency manifest for guest migrations. Read-only planning.
const KIND=new Set(['disk','volume','bind-mount','database','configuration','identity','permission','secret','network','service','snapshot','application-data','certificate','job','license']);
const NAME=/^[A-Za-z0-9][A-Za-z0-9_.:/ -]{0,159}$/;
function bad(s){throw Object.assign(new Error(s),{status:400});}
export function reviewGuestDependencies(input){
 if(!input||typeof input!=='object'||!['vm','container','app'].includes(input.type)||
  !Array.isArray(input.dependencies)||input.dependencies.length>2000)bad('Invalid guest dependency manifest');
 if(input.inventoryComplete!==true)bad('Full source inventory required to review a guest');
 const ids=new Set();
 const dependencies=input.dependencies.map(x=>{
  if(!x||typeof x!=='object'||!KIND.has(x.kind)||!NAME.test(x.id||'')||ids.has(x.id))bad('Invalid or duplicate guest dependency');
  ids.add(x.id);
  const external=x.external===true,verified=x.destinationVerified===true;
  const blocked=!verified || (external&&x.explicitlyIncluded!==true) ||
    (x.kind==='database'&&x.applicationConsistentBackup!==true) ||
    (x.kind==='secret'&&x.secureReprovisionVerified!==true);
  return {id:x.id,kind:x.kind,external,selected:!external||x.explicitlyIncluded===true,
    status:blocked?'blocked':'verified-for-review',
    reason:!verified?'Destination not verified':external&&x.explicitlyIncluded!==true?'External dependency needs explicit inclusion':
      x.kind==='database'&&x.applicationConsistentBackup!==true?'Consistent database backup and restore required':
      x.kind==='secret'&&x.secureReprovisionVerified!==true?'Secret must be securely reprovisioned':null};
 });
 const blockers=dependencies.filter(x=>x.status==='blocked').map(x=>x.id);
 return {phase:'guest-dependency-review',type:input.type,dependencies,blockers,
   coverage,allDependenciesVerified:blockers.length===0,transferStarted:false,
   guestActivationAuthorized:false,sourceDeletionAuthorized:false,
   note:'Guest disk alone does not establish that external volumes, databases, identities or services migrated'};
}
