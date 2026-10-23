import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat, rename, unlink } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { verifiedMigrationFile, registerVerifiedConvertedDisk } from './migration-transfer.mjs';

const exec = promisify(execFile);
const root = resolve(process.env.LIGHTNAS_MIGRATION_STAGING_DIR || '/var/lib/lightnas/imports/verified');
const tasks = new Map();
const compatible = /\.(vmdk|qcow2|raw|img)$/i;
export function conversionStatus(id) {
  const result = tasks.get(String(id));
  if (!result) throw Object.assign(new Error('conversion task not found'), { status: 404 });
  return { ...result };
}
async function run(program, args, timeout) {
  try { return await exec(program, args, { timeout, maxBuffer: 1024 * 1024 }); }
  catch (e) { throw Object.assign(new Error(program+' failed: '+String(e.stderr||e.message).slice(0,600)), { status: 409 }); }
}
export async function convertVerifiedDisk(input) {
  const file = verifiedMigrationFile(input?.jobId);
  if (input?.confirm !== 'CONVERT_VERIFIED_DISK') throw Object.assign(new Error('Explicit conversion approval required'), { status: 409 });
  if (!compatible.test(file.name)) throw Object.assign(new Error('Supported formats: VMDK, QCOW2, raw, img'), { status: 400 });
  const metadata = JSON.parse((await run('qemu-img', ['info','--output=json',file.path],30000)).stdout);
  if (!['vmdk','qcow2','raw'].includes(metadata.format)) throw Object.assign(new Error('Unsupported source image format'), { status: 409 });
  if (metadata['backing-filename'] || metadata['full-backing-filename']) throw Object.assign(new Error('Backing file chain must be consolidated first'), { status: 409 });
  const name = randomUUID()+'.qcow2';
  const output = resolve(root,name);
  if (!output.startsWith(root+sep)) throw new Error('invalid output path');
  const task = { id: randomUUID(), state:'queued', source:file.name, output:name, progressPercent:0, error:null, verified:false };
  tasks.set(task.id,task);
  void (async()=>{
    try {
      task.state='validating-source';
      const sourceHash = createHash('sha256');
      for await (const chunk of createReadStream(file.path)) sourceHash.update(chunk);
      if (sourceHash.digest('hex') !== file.sha256) throw new Error('Source disk changed after staging verification');
      task.state='converting';
      // qemu-img progress reporting is non-transactional. Do not report
      // successful completion until qemu-img check has finished.
      await run('qemu-img',['convert','-p','-f',metadata.format,'-O','qcow2',file.path,output],24*60*60*1000);
      task.state='verifying';
      await run('qemu-img',['check','-f','qcow2',output],120000);
      const result=await stat(output);
      if (!result.isFile() || result.size===0) throw new Error('empty converted image');
      const hash=createHash('sha256');
      for await (const chunk of createReadStream(output)) hash.update(chunk);
      task.importJobId=registerVerifiedConvertedDisk({filename:name,size:result.size,sha256:hash.digest('hex')});
      task.progressPercent=100;task.verified=true;task.state='completed';
    } catch(e) {
      task.error=e.message;task.state='failed';
      await unlink(output).catch(()=>{});
    }
  })();
  return { ...task };
}
