import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const exec = promisify(execFile);
const vmName = /^[A-Za-z][A-Za-z0-9-]{1,39}$/;
const roots = (process.env.LIGHTNAS_VM_VERIFY_ROOTS || '/var/lib/lightnas/storage:/var/lib/libvirt/images')
  .split(':').filter(Boolean).map(x=>resolve(x));

async function command(tool, args) {
  try { return (await exec(tool,args,{timeout:30000,maxBuffer:1024*1024})).stdout.trim(); }
  catch (e) { throw Object.assign(new Error(tool+' verification command failed'),{status:409}); }
}
export function parseDiskPaths(domainXml) {
  // Matches only local file-backed libvirt disk source attributes.
  return [...String(domainXml).matchAll(/<source\s+file=['"]([^'"]+)['"]/g)].map(x=>x[1]);
}
export async function verifyOfflineVm(input, dependency = {}) {
  const name=String(input?.name || '');
  if (!vmName.test(name)) throw Object.assign(new Error('Invalid VM name'),{status:400});
  const run=dependency.command || command;
  const xml=await run('virsh',['-c','qemu:///system','dumpxml',name]);
  const state=await run('virsh',['-c','qemu:///system','domstate',name]);
  const issues=[];
  if (!/shut off|shutoff/i.test(state)) issues.push('VM is not powered off; no automatic boot or cutover will occur');
  const paths=parseDiskPaths(xml);
  if (!paths.length) issues.push('No local file-backed disk was found in domain XML');
  const images=[];
  for(const disk of paths) {
    try {
      const absolute=await (dependency.realpath || realpath)(disk);
      if (!roots.some(root=>absolute.startsWith(root+sep))) {
        issues.push('Disk is outside approved storage roots');continue;
      }
      const info=await (dependency.stat || stat)(absolute);
      if (!info.isFile() || info.size <= 0) {issues.push('Missing or empty disk');continue;}
      const metadata=JSON.parse(await run('qemu-img',['info','--output=json',absolute]));
      if(metadata['backing-filename'] || metadata['full-backing-filename']) issues.push('Disk has unverified backing image');
      images.push({name:disk.split('/').pop(),format:metadata.format,sizeBytes:info.size});
    } catch { issues.push('Unable to inspect a configured disk'); }
  }
  if(!/<interface\b/.test(xml)) issues.push('No virtual NIC is defined');
  if(!/<memory\b/.test(xml)) issues.push('Domain memory configuration not found');
  return {name,state,images,passed:issues.length===0,issues,bootTested:false,applicationVerified:false,cutoverPerformed:false};
}
