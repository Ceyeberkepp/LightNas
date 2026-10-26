// Network migration preview. Never changes host interfaces, trunks, switches, routes or DNS.
const IFACE=/^[A-Za-z][A-Za-z0-9_.:-]{0,31}$/;
const validVlan=n=>Number.isInteger(n)&&n>=1&&n<=4094;
function bad(s){throw Object.assign(new Error(s),{status:400});}
export function previewNetworkMigration(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!Array.isArray(input.networks)||input.networks.length>256)bad('Invalid network inventory');
 const selected=input.transferNetworkSettings===true;
 const existing=new Set(),results=[];
 for(const net of input.networks){
  if(!net||typeof net!=='object'||Array.isArray(net)||!IFACE.test(net.name||'')||existing.has(net.name))bad('Invalid or duplicate interface');
  existing.add(net.name);
  if(!['access','trunk','bridge'].includes(net.mode))bad('Invalid network mode');
  const tags=net.mode==='trunk'?net.allowedVlans:net.mode==='access'?[net.vlan]:[];
  if(!Array.isArray(tags)||tags.length>128||tags.some(x=>!validVlan(x))||new Set(tags).size!==tags.length)bad('Invalid VLAN or trunk list');
  const target=input.mappings&&Object.hasOwn(input.mappings,net.name)?input.mappings[net.name]:null;
  const issues=[];
  if(!target||!IFACE.test(target.interface||''))issues.push('Explicit destination bridge or NIC required');
  if(net.mode==='trunk')issues.push('Verify switch trunk allowed VLANs, tagged/native VLAN and MTU');
  if(net.gateway||net.dns)issues.push('Validate IP gateway DNS and routing on isolated test network');
  if(net.management===true)issues.push('Management interface cutover requires console access and rollback timer');
  issues.push('Live destination and switch configuration must be verified before activation');
  results.push({name:net.name,mode:net.mode,allowedVlans:tags,targetInterface:target?.interface||null,
   issues,readyForExecution:false,selectedForTransfer:selected});
 }
 return {phase:'network-migration-preflight',discovered:true,selectedForTransfer:selected,readOnly:true,networkChangesApplied:false,
  cutoverAuthorized:false,results};
}
