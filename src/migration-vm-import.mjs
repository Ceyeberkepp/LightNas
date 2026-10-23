import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, copyFile, lstat, rm } from 'node:fs/promises';
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
  const staged = verifiedMigrationFile(input.jobId);
  if (!/\.(qcow2|raw|img)$/i.test(staged.name)) {
    throw Object.assign(new Error('Only verified QCOW2 or raw images can be imported directly; convert VMDK/OVA separately'), { status: 409 });
  }
  const runtime = (await runtimeInventory()).virtualization;
  if (!runtime?.available || !runtime.enabled || runtime.provider?.startsWith('proxmox')) {
    throw Object.assign(new Error('Local LightNAS libvirt runtime required'), { status: 409 });
  }
  if (!runtime.pools?.includes(pool) || !runtime.networks?.includes(network)) {
    throw Object.assign(new Error('Selected storage pool or virtual network is unavailable'), { status: 409 });
  }
  if (runtime.machineDetails?.some(item => item.name === name)) {
    throw Object.assign(new Error('Destination VM already exists'), { status: 409 });
  }
  const storage = await resolveStoragePool(pool, 'images', true);
  const folder = join(storage.root, 'images', name);
  const disk = join(folder, name + (staged.name.toLowerCase().endsWith('.qcow2') ? '.qcow2' : '.img'));
  // Validate qemu sees a standalone image. Backing chains cannot silently
  // reach files outside the verified staging directory.
  const metadata = JSON.parse(await command('qemu-img', ['info','--output=json',staged.path]));
  if (metadata['backing-filename'] || metadata['full-backing-filename'] || metadata.format === 'vmdk') {
    throw Object.assign(new Error('Images with external backing files are not eligible for direct import'), { status: 409 });
  }
  await command('virsh', ['-c','qemu:///system','dominfo',name]).then(
    () => { throw Object.assign(new Error('VM name exists in libvirt'), { status: 409 }); },
    error => { if (!/failed:|not found|Domain not found/i.test(error.message)) throw error; }
  );
  await mkdir(folder, { recursive: false });
  try {
    await copyFile(staged.path, disk, 1); // COPYFILE_EXCL: never overwrite
    const copied = await lstat(disk);
    if (!copied.isFile() || copied.size !== staged.size) throw new Error('Copied disk failed size verification');
    const detail = runtime.networkDetails?.find(item => item.name === network);
    const netArg = detail?.type === 'host-bridge' ? 'bridge=' + network : 'network=' + network;
    const diskFormat = metadata.format === 'qcow2' ? 'qcow2' : 'raw';
    const args = ['--connect','qemu:///system','--name',name,
      '--memory',String(memoryMiB),'--vcpus',String(cpus),
      '--disk',`path=${disk},format=${diskFormat},bus=sata`,
      '--network',netArg+',model=e1000','--graphics','vnc,listen=127.0.0.1',
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
    return { name, state:'defined-offline', disk, network, pool, sourceSha256: staged.sha256,
      warning:'VM has NOT started; confirm boot firmware, drivers, NIC and application data before cutover.' };
  } catch (error) {
    // Never delete a disk once libvirt has defined it: preserve recovery data.
    let defined = false;
    try { await exec('virsh',['-c','qemu:///system','dominfo',name],{timeout:10000}); defined = true; } catch {}
    if (!defined) await rm(folder,{recursive:true,force:true}).catch(()=>{});
    throw error;
  }
}
