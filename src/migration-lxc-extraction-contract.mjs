// Safe, non-executing extraction contract for a future narrow root-owned agent.
// No shell invocation or filesystem writes occur in this module.
const archiveName=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}\.tar(?:\.(?:gz|xz|zst))?$/;
const sha256=/^[a-f0-9]{64}$/i;
const component=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export function validateLxcExtractionContract(request) {
 if(!request || typeof request!=='object' || Array.isArray(request))throw new Error('Invalid extraction request');
 const {archive,archiveSha256,rootfsEntries,destination,approval}=request;
 if(typeof archive!=='string'||!archiveName.test(archive)||!sha256.test(archiveSha256))
   throw new Error('Verified archive filename and SHA-256 required');
 if(!Array.isArray(rootfsEntries)||!rootfsEntries.length||rootfsEntries.length>200000)
   throw new Error('Bounded archive member inventory required');
 const entries=new Set();
 for(const entry of rootfsEntries) {
  if(!entry||typeof entry!=='object'||Array.isArray(entry)||!['file','directory'].includes(entry.type)||
     typeof entry.path!=='string'||entry.path.length>4096||entry.path.startsWith('/')||
     entry.path.includes('\\')||entry.path.split('/').some(x=>!x||x==='.'||x==='..')||
     entries.has(entry.path))throw new Error('Unsafe or duplicate archive entry');
  entries.add(entry.path);
 }
 if(!destination||typeof destination!=='object'||Array.isArray(destination)||
    !component.test(destination.pool)||!component.test(destination.name)||
    destination.pool==='.'||destination.name==='.')
   throw new Error('Invalid destination identifiers');
 if(!approval||approval.reviewComplete!==true||approval.approvedForExecution!==false||
    approval.archiveSha256!==archiveSha256)
   throw new Error('Matching completed manual review required');
 return {phase:'lxc-extraction-contract',archive,archiveSha256,
   destination:{pool:destination.pool,name:destination.name},
   entries:entries.size,approvedForExecution:false,extractionStarted:false,
   nextStep:'Implement root-owned extractor with safe dirfd traversal, resource limits, and rollback'};
}
