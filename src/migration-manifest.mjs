// Portable, strictly validated migration manifests for administrator review.
// These records never include credentials, secrets, or guest file contents.
import { planMigration } from './migration-planner.mjs';

const allowedPlatforms=new Set(['vmware','proxmox','truenas','redhat']);
function safeString(x,max=160){const s=String(x??'');if(s.length>max||/[\x00-\x1f]/.test(s))throw Object.assign(new Error('Invalid manifest field'),{status:400});return s;}
export function normalizeMigrationManifest(input){
 const platform=safeString(input?.source,24);
 if(!allowedPlatforms.has(platform))throw Object.assign(new Error('Unsupported migration platform'),{status:400});
 const items=input?.items;
 if(!Array.isArray(items)||items.length>2000)throw Object.assign(new Error('Invalid inventory'),{status:400});
 const cleaned=items.map((x,i)=>({
  id:safeString(x?.id,128),name:safeString(x?.name,120),type:safeString(x?.type,20)
 }));
 const plan=planMigration({source:platform,items:cleaned});
 return {format:'lightnas-migration-manifest',version:1,platform,items:cleaned,
  mappingsRequired:plan.blockers,discoveryOnly:true,containsCredentials:false};
}
export function migrationManifestFromInventory(source,inventory){
 return normalizeMigrationManifest({source,items:inventory});
}
