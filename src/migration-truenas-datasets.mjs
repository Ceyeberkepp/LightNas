// Dataset migration preflight only; does not import a ZFS pool or copy files.
import {listStoragePools} from './storage-pools.mjs';
const dataset=/^[A-Za-z0-9][A-Za-z0-9_.:-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.:-]*)*$/;
const poolId=/^[A-Za-z0-9_-]{1,48}$/;
function invalid(message){throw Object.assign(new Error(message),{status:400});}
export function evaluateDatasetTransfer(input,inventory){
 if(!input||typeof input!=='object'||Array.isArray(input)||!Array.isArray(input.datasets)||input.datasets.length>500)
  invalid('Invalid dataset inventory');
 const ids=new Set();
 const results=input.datasets.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.name!=='string'||
     !dataset.test(item.name)||item.name.includes('..')||ids.has(item.name)||
     !Number.isSafeInteger(item.usedBytes)||item.usedBytes<0)
    invalid('Invalid or duplicate dataset');
  ids.add(item.name);
  const mappings=input.mappings;
  const map=mappings&&typeof mappings==='object'&&!Array.isArray(mappings)&&Object.hasOwn(mappings,item.name)?mappings[item.name]:null;
  const target=map&&typeof map==='object'&&!Array.isArray(map)&&poolId.test(map.pool)?inventory.pools?.find(p=>p.id===map.pool):null;
  const issues=[];
  if(!target||!target.online||!target.writable||!target.content?.includes('files'))issues.push('Explicit writable online file-storage destination required');
  if(target?.capacityKnown!==false&&Number.isFinite(target?.availableBytes)&&target.availableBytes<item.usedBytes)issues.push('Insufficient reported destination space');
  if(item.encrypted===true)issues.push('Encrypted source requires separate key and unlock procedure');
  if(item.snapshots===true)issues.push('Snapshot and retention preservation requires review');
  issues.push('UID/GID, NFSv4/SMB ACLs, xattrs and share configuration require manual verification');
  return {name:item.name,sourceBytes:item.usedBytes,targetPool:target?.id||null,readyForTransfer:false,issues};
 });
 return {phase:'truenas-dataset-preflight',readOnly:true,approvedForExecution:false,results,blocked:results.length};
}
export async function preflightDatasetTransfer(input,providers={}){
 const storage=await (providers.listStoragePools||listStoragePools)();
 return evaluateDatasetTransfer(input,storage);
}
