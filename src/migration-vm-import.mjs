import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, copyFile, lstat, rm, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { verifiedMigrationFile } from './migration-transfer.mjs';
import { runtimeInventory } from './runtimes-next.mjs';
import { resolveStoragePool } from './storage-pools.mjs';

const exec = promisify(execFile);
const vmNamePattern = /^[a-zA-Z][a-zA-Z0-9-]{1,39}$/;
async function command(tool, args, timeout = 60000) {
  try { return (await exec(tool, args, { timeout, maxBuffer: 1048576 })).stdout.trim(); }
  catch (error) { throw Object.assign(new Error(tool + ' failed: ' + (error.stderr || error.message).slice(0, 800)), { status: 409 }); }
}
export async function importVerifiedVm(input) {
  const name = String(input?.name || '');
  const pool = String(input?.pool || '');
  const network = String(input?.network || '');
  const firmware = String(input?.firmware || 'bios');
  const memoryMiB = Number(input?.memoryMiB);
  const cpus = Number(input?.cpus);
  if (!vmNamePattern.test(name) || !/^[a-zA-Z0-9_-]{1,48}$/.test(pool) ||
      !/^[a-zA-Z0-9_.:-]{1,48}$/.test(network) || !['bios','uefi'].includes(firmware) ||
      !Number.isInteger(memoryMiB) || memoryMiB < 1024 || memoryMiB > 65536 ||
      !Number.isInteger(cpus) || cpus < 1 || cpus > 32) {
    throw Object.assign(new Error('Invalid VM name, pool, network or resource settings'), { status: 400 });
  }
  if (input?.confirm !== 'IMPORT_VERIFIED_VM') {
    throw Object.assign(new Error('Explicit VM import confirmation required'), { status: 409 });
  }
  // Preserve multiple guest NICs, but never alter destination host networking.
  const interfaces = input.interfaces === undefined
    ? [{network,model:'e1000'}] : input.interfaces;
  const macPattern=/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
  if(!Array.isArray(interfaces)||interfaces.length<1||interfaces.length>12)
    throw Object.assign(new Error('Supply 1–12 guest network adapters'),{status:400});
  const macs=new Set();
  for(const nic of interfaces){
    if(!nic||typeof nic!=='object'||Array.isArray(nic)||
       !/^[A-Za-z0-9_.:-]{1,48}$/.test(nic.network||'')||
       !['virtio','e1000','rtl8139','vmxnet3'].includes(nic.model||'e1000')||
       (nic.mac!==undefined&&!macPattern.test(nic.mac)))
      throw Object.assign(new Error('Invalid VM guest NIC, model or MAC'),{status:400});
    if(nic.mac){
      const value=nic.mac.toLowerCase();
      if(macs.has(value)||(parseInt(value.slice(0,2),16)&1))
        throw Object.assign(new Error('Guest MAC address duplicated or multicast'),{status:400});
      macs.add(value);
    }
  }
  // Import every supplied disk, in boot order. Reject duplicate jobs and
  // unsupported media rather than silently creating a partial guest.
  const diskJobs = input.disks === undefined ? [input.jobId] : input.disks;
  if (!Array.isArray(diskJobs) || diskJobs.length < 1 || diskJobs.length > 16 ||
      diskJobs.some(x => typeof x !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(x)) ||
      new Set(diskJobs).size !== diskJobs.length)
    throw Object.assign(new Error('Supply 1–16 distinct verified VM disk job IDs in boot order'), {status:400});
  const stagedDisks = diskJobs.map(jobId => verifiedMigrationFile(jobId));
  const staged = stagedDisks[0];
  if (stagedDisks.some(file => !/\.(qcow2|raw|img)$/i.test(file.name))) {
    throw Object.assign(new Error('Only verified QCOW2 or raw images can be imported directly; convert VMDK/OVA separately'), { status: 409 });
  }
  const runtime = (await runtimeInventory()).virtualization;
  if (!runtime?.available || !runtime.enabled || runtime.provider?.startsWith('proxmox')) {
    throw Object.assign(new Error('Local LightNAS libvirt runtime required'), { status: 409 });
  }
  if (!runtime.pools?.includes(pool) || interfaces.some(nic=>!runtime.networks?.includes(nic.network))) {
    throw Object.assign(new Error('Selected storage pool or virtual network is unavailable'), { status: 409 });
  }
  if (runtime.machineDetails?.some(item => item.name === name)) {
    throw Object.assign(new Error('Destination VM already exists'), { status: 409 });
  }
  const storage = await resolveStoragePool(pool, 'images', true);
  const folder = join(storage.root, 'images', name);
  const verifiedDisks = [];
  // Validate ALL images before writing or defining any VM.
  for (const [index, file] of stagedDisks.entries()) {
    const metadata = JSON.parse(await command('qemu-img', ['info','--output=json',file.path]));
    if (metadata['backing-filename'] || metadata['full-backing-filename'] ||
        !['qcow2','raw'].includes(metadata.format))
      throw Object.assign(new Error('Disk '+(index+1)+' uses unsupported format or an external backing chain'),{status:409});
    verifiedDisks.push({file,format:metadata.format,
      disk:join(folder,'disk-'+String(index).padStart(2,'0')+(metadata.format==='qcow2'?'.qcow2':'.img'))});
  }
  await command('virsh', ['-c','qemu:///system','dominfo',name]).then(
    () => { throw Object.assign(new Error('VM name exists in libvirt'), {status:409}); },
    error => { if (!/failed:|not found|Domain not found/i.test(error.message)) throw error; }
  );
  await mkdir(folder,{recursive:true});
  try {
    for (const {file,disk} of verifiedDisks) {
      await copyFile(file.path,disk,1);
      const copied=await lstat(disk);
      if (!copied.isFile() || copied.size!==file.size)throw Error('VM disk size verification failed');
      const hash=createHash('sha256');
      for await(const chunk of createReadStream(disk))hash.update(chunk);
      if(hash.digest('hex')!==file.sha256)throw Error('VM disk integrity verification failed');
    }
    const nicArgs=interfaces.flatMap(nic=>{
      const detail=runtime.networkDetails?.find(item=>item.name===nic.network);
      const netArg=(detail?.type==='host-bridge'?'bridge=':'network=')+nic.network;
      return ['--network',netArg+',model='+(nic.model||'e1000')+(nic.mac?',mac='+nic.mac:'')];
    });
    const diskArgs=verifiedDisks.flatMap(({disk,format})=>['--disk',`path=${disk},format=${format},bus=sata`]);
    const args = ['--connect','qemu:///system','--name',name,
      '--memory',String(memoryMiB),'--vcpus',String(cpus),
      ...diskArgs,
      ...nicArgs,'--graphics','vnc,listen=127.0.0.1',
      '--import','--osinfo','generic','--noautoconsole','--noreboot',
      '--print-xml'];
    if (firmware === 'uefi') args.push('--boot','uefi');
    const xml = await command('virt-install', args, 90000);
    if (!xml.includes('<domain')) throw new Error('VM definition was not generated');
    // Creation is deliberately defined but never started. Admin verifies disk
    // controller, firmware, NIC mappings and boots manually after import.
    const { writeFile } = await import('node:fs/promises');
    const xmlFile = join(folder, 'import.xml');
    await writeFile(xmlFile, xml, { flag: 'wx', mode: 0o600 });
    await command('virsh',['-c','qemu:///system','define',xmlFile],30000);
    return { name, state:'defined-offline', disks:verifiedDisks.map(({disk,file})=>({path:disk,sha256:file.sha256})), network, interfaces, pool,
      warning:'VM has NOT started; confirm boot firmware, drivers, NIC and application data before cutover.' };
  } catch (error) {
    // Never delete a disk once libvirt has defined it: preserve recovery data.
    let defined = false;
    try { await exec('virsh',['-c','qemu:///system','dominfo',name],{timeout:10000}); defined = true; } catch {}
    if (!defined) await rm(folder,{recursive:true,force:true}).catch(()=>{});
    throw error;
  }
}
