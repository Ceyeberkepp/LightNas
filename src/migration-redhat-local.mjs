// Safe ingestion of a local Red Hat libvirt/Podman discovery export.
const VM=/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/;
function bad(reason){throw Object.assign(new Error(reason),{status:400});}
export function normalizeRedHatInventory(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||input.source!=='redhat')bad('Expected Red Hat inventory export');
 if(!Array.isArray(input.vms)||!Array.isArray(input.containers)||input.vms.length+input.containers.length>2000)
  bad('Invalid Red Hat inventory size');
 const seen=new Set();
 const normalize=(rows,type)=>rows.map(x=>{
  if(!x||typeof x!=='object'||Array.isArray(x)||!VM.test(x.name||'')||!ID.test(x.id||''))bad('Invalid Red Hat inventory item');
  const id=type+':'+x.id;
  if(seen.has(id))bad('Duplicate inventory ID');
  seen.add(id);
  return {id,name:x.name,type};
 });
 return {source:'redhat',discoveryOnly:true,credentialsStored:false,
  items:[...normalize(input.vms,'vm'),...normalize(input.containers,'container')],
  warnings:['Local inventory only: no VM images, secrets, container layers or ACLs have been exported']};
}
export function buildSourceExportManifest(input){
 const normalized=normalizeRedHatInventory(input);
 return {schemaVersion:1,createdAt:null,source:'redhat',
  inventory:normalized.items,exportState:'manifest-only',imagesExported:false,
  secretsExported:false,credentialsStored:false};
}
