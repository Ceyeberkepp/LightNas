// Generate a non-executable LXC configuration preview. Never writes to /var/lib/lxc.
const NAME=/^[A-Za-z][A-Za-z0-9-]{1,39}$/;
const BRIDGE=/^[A-Za-z][A-Za-z0-9_.-]{0,47}$/;
const HASH=/^[a-f0-9]{64}$/i;
function requireSafe(condition,message){if(!condition)throw Object.assign(new Error(message),{status:400});}
export function renderOfflineLxcConfig(input) {
 requireSafe(input&&typeof input==='object'&&!Array.isArray(input),'Invalid config request');
 const {name,bridge,memoryMiB,cpus,uidStart,gidStart,idRange,manifestSha256}=input;
 requireSafe(NAME.test(name)&&BRIDGE.test(bridge)&&HASH.test(manifestSha256||''),'Invalid identifiers or manifest fingerprint');
 requireSafe(Number.isInteger(memoryMiB)&&memoryMiB>=128&&memoryMiB<=1048576&&
  Number.isInteger(cpus)&&cpus>=1&&cpus<=256,'Invalid resources');
 requireSafe(Number.isSafeInteger(uidStart)&&Number.isSafeInteger(gidStart)&&
  uidStart>=100000&&gidStart>=100000&&Number.isSafeInteger(idRange)&&idRange>=65536&&
  uidStart+idRange<=2147483647&&gidStart+idRange<=2147483647,'Unsafe UID/GID mapping');
 const lines=[
  'lxc.uts.name = '+name,
  'lxc.apparmor.profile = generated',
  'lxc.idmap = u 0 '+uidStart+' '+idRange,
  'lxc.idmap = g 0 '+gidStart+' '+idRange,
  'lxc.cgroup2.memory.max = '+(memoryMiB*1024*1024),
  'lxc.cgroup2.cpuset.cpus = 0-'+(cpus-1),
  'lxc.net.0.type = veth',
  'lxc.net.0.link = '+bridge,
  'lxc.net.0.flags = down',
  'lxc.start.auto = 0'
 ];
 return {phase:'lxc-offline-config-preview',name,manifestSha256,config:lines.join('\\n')+'\\n',
  registrationAllowed:false,startAllowed:false,
  blockers:['Resolve approved rootfs path in restricted agent','Verify host network and idmap reservations',
   'Apply approved ownership, xattrs and ACL handling before registration']};
}
