// Offline-only LXC registration preflight; does not invoke lxc-create or start any process.
const NAME=/^[A-Za-z][A-Za-z0-9-]{1,39}$/;
const NETWORK=/^[A-Za-z0-9_.:-]{1,48}$/;
const SHA=/^[a-f0-9]{64}$/i;
function bad(message){throw Object.assign(new Error(message),{status:400});}
export function previewOfflineLxcRegistration(input){
 if(!input||typeof input!=='object'||Array.isArray(input))bad('Invalid registration input');
 const {name,network,memoryMiB,cpus,rootfsManifestSha256,idMap,rootfsVerified}=input;
 if(!NAME.test(name)||!NETWORK.test(network)||!Number.isInteger(memoryMiB)||memoryMiB<128||
    memoryMiB>1048576||!Number.isInteger(cpus)||cpus<1||cpus>256||
    !SHA.test(rootfsManifestSha256||''))bad('Invalid resources, network, or rootfs fingerprint');
 const blockers=[];
 if(rootfsVerified!==true)blockers.push('Verified offline root filesystem required');
 if(!idMap||typeof idMap!=='object'||Array.isArray(idMap)||
   !Number.isInteger(idMap.uidStart)||!Number.isInteger(idMap.gidStart)||
   idMap.uidStart<100000||idMap.gidStart<100000||
   !Number.isInteger(idMap.range)||idMap.range<65536||
   idMap.uidStart+idMap.range>2147483647||idMap.gidStart+idMap.range>2147483647)
   blockers.push('Reviewed unprivileged UID/GID mappings required');
 blockers.push('Privileged agent must verify destination path, isolated ownership and ACL restoration');
 blockers.push('Privileged agent must verify network bridge and namespace configuration');
 return {phase:'lxc-registration-preflight',offline:true,readOnly:true,
   canRegister:false,canStart:false,approvedForExecution:false,
   destination:{name,network,memoryMiB,cpus},rootfsManifestSha256,
   blockers};
}
