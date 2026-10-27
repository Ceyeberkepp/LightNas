import {verifyWorkloadTransferBundle} from './migration-workload-bundle.mjs';
import {importVerifiedVm} from './migration-vm-import.mjs';
import {preserveVerifiedApplication} from './migration-app-preserve.mjs';
// Execute only the two restore stages currently implemented. Never imply
// compatibility for an unimplemented container or live app restore.
export async function executeVerifiedWorkloadRestore(input, adapters={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    input.confirm!=='EXECUTE_VERIFIED_OFFLINE_RESTORE')
   throw Object.assign(new Error('Explicit offline restore approval required'),{status:409});
 const verify=adapters.verify||verifyWorkloadTransferBundle;
 const evidence=await verify(input);
 if(!evidence||evidence.artifactCount!==input.artifacts?.length||
    evidence.dependenciesReviewed!==true||evidence.cutoverAuthorized!==false)
   throw Object.assign(new Error('Verified workload manifest required'),{status:409});
 if(input.type==='vm'){
  const disks=input.artifacts.filter(a=>a.kind==='vm-disk').map(a=>a.jobId);
  if(disks.length<1||disks.length!==input.artifacts.length)
   throw Object.assign(new Error('VM includes unsupported external artifacts; use full guest restore workflow'),{status:409});
  const execute=adapters.vm||importVerifiedVm;
  const result=await execute({name:input.name,pool:input.pool,network:input.network,
    firmware:input.firmware,cpus:input.cpus,memoryMiB:input.memoryMiB,
    interfaces:input.interfaces,
    disks,confirm:'IMPORT_VERIFIED_VM'});
  return {phase:'restored-offline',type:'vm',result,sourcePreserved:true,
    destinationFunctionalityVerified:false,cutoverAuthorized:false};
 }
 if(input.type==='app'){
  const execute=adapters.app||preserveVerifiedApplication;
  const result=await execute({name:input.name,pool:input.pool,artifacts:input.artifacts,
    databaseConsistencyVerified:input.databaseConsistencyVerified,
    dependenciesReviewed:true,confirm:'PRESERVE_VERIFIED_APP'});
  return {phase:'preserved-offline',type:'app',result,sourcePreserved:true,
    destinationFunctionalityVerified:false,cutoverAuthorized:false};
 }
 throw Object.assign(new Error('Container restore execution is not yet safely supported by this pipeline'),{status:409});
}
