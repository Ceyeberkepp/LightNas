import { verifiedResumableImport } from './migration-resumable.mjs';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, lstat, unlink, stat, copyFile } from 'node:fs/promises';
import { resolve, basename, join, sep } from 'node:path';
import { constants } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

const sourceRoot = resolve(process.env.LIGHTNAS_MIGRATION_IMPORT_DIR || '/var/lib/lightnas/imports/incoming');
const targetRoot = resolve(process.env.LIGHTNAS_MIGRATION_STAGING_DIR || '/var/lib/lightnas/imports/verified');
const jobs = new Map();
const allowedExt = /\.(qcow2|raw|img|vmdk|ova|ovf|vma|zst|gz|xz|tar|xml|json)$/i;

function contained(root, relative) {
  const full = resolve(root, relative);
  if (!full.startsWith(root + sep)) throw new Error('file path escapes migration staging');
  return full;
}
function publicJob(job) {
  const { id, source, target, state, bytesCopied, totalBytes, digest, error, startedAt, endedAt } = job;
  return { id, source, target, state, bytesCopied, totalBytes, digest, error, startedAt, endedAt, verified: state === 'verified' };
}
export function migrationJob(id) {
  const job = jobs.get(String(id));
  if (!job) throw Object.assign(new Error('migration job not found'), { status: 404 });
  return publicJob(job);
}
export async function startMigrationImport(input) {
  const filename = String(input?.filename || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/.test(filename) || !allowedExt.test(filename)) throw Object.assign(new Error('unsupported import filename'), { status: 400 });
  if (jobs.size >= 1000) throw Object.assign(new Error('job history is full'), { status: 503 });
  const source = contained(sourceRoot, filename);
  const info = await lstat(source);
  if (!info.isFile() || info.size <= 0) throw new Error('migration source is not a regular nonempty file');
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const resolved = await handle.stat();
    if (!resolved.isFile() || resolved.ino !== info.ino || resolved.dev !== info.dev) throw new Error('source changed while validating');
  } finally { await handle.close(); }
  await mkdir(targetRoot, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const target = contained(targetRoot, id + '-' + basename(filename));
  const temporary = target + '.partial';
  const job = { id, source: filename, target: basename(target), state: 'copying', bytesCopied: 0, totalBytes: info.size,
    digest: null, error: null, startedAt: new Date().toISOString(), endedAt: null };
  jobs.set(id, job);
  void (async () => {
    try {
      const hash = createHash('sha256');
      const reader = createReadStream(source, { flags: 'r', highWaterMark: 1024 * 1024 });
      reader.on('data', chunk => { hash.update(chunk); job.bytesCopied += chunk.length; });
      await pipeline(reader, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
      if (job.bytesCopied !== info.size) throw new Error('source changed size during copy');
      job.state = 'verifying';
      const targetHash = createHash('sha256');
      for await (const chunk of createReadStream(temporary)) targetHash.update(chunk);
      job.digest = hash.digest('hex');
      if (targetHash.digest('hex') !== job.digest) throw new Error('SHA-256 verification failed');
      const currentSource = await stat(source);
      if (currentSource.size !== info.size || currentSource.mtimeMs !== info.mtimeMs || currentSource.ino !== info.ino || currentSource.dev !== info.dev) throw new Error('Source changed during migration copy');
      await rename(temporary, target);
      job.state = 'verified';
    } catch (error) {
      job.error = error.message;
      job.state = 'failed';
      await unlink(temporary).catch(() => {});
    } finally { job.endedAt = new Date().toISOString(); }
  })();
  return publicJob(job);
}

export function verifiedMigrationFile(jobId) {
  const job = jobs.get(String(jobId));
  if (!job || job.state !== 'verified' || !job.digest) {
    throw Object.assign(new Error('A completed, checksum-verified staging job is required.'), { status: 409 });
  }
  return { path: contained(targetRoot, job.target), name: job.target, sha256: job.digest, size: job.totalBytes };
}

export function registerVerifiedConvertedDisk({ filename, size, sha256 }) {
  if (!/^[a-f0-9-]{36}\.qcow2$/.test(filename) || !Number.isSafeInteger(size) || size <= 0 || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('invalid converted disk receipt');
  const id = randomUUID();
  jobs.set(id, { id, source: filename, target: filename, state: 'verified', bytesCopied:size, totalBytes:size,
    digest:sha256, error:null, startedAt:new Date().toISOString(), endedAt:new Date().toISOString() });
  return id;
}

export async function promoteVerifiedResumableImport(id) {
 const source=await verifiedResumableImport(id);
 if(!allowedExt.test(source.name))throw Object.assign(new Error('Unsupported migration payload type'),{status:400});
 await mkdir(targetRoot,{recursive:true,mode:0o700});
 const jobId=randomUUID();
 const targetName=jobId+'-'+basename(source.name);
 const target=contained(targetRoot,targetName);
 const part=target+'.partial';
 try {
  await copyFile(source.path,part,constants.COPYFILE_EXCL);
  const info=await lstat(part);
  if(!info.isFile()||info.size!==source.size)throw new Error('Staged file size mismatch');
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(part))hash.update(chunk);
  if(hash.digest('hex')!==source.sha256)throw new Error('Staged file checksum mismatch');
  // Do not trust source receipts alone; validate the original once more before promotion.
  await verifiedResumableImport(id);
  await rename(part,target);
  const now=new Date().toISOString();
  const job={id:jobId,source:source.name,target:targetName,state:'verified',
   bytesCopied:source.size,totalBytes:source.size,digest:source.sha256,
   error:null,startedAt:now,endedAt:now};
  jobs.set(jobId,job);
  return publicJob(job);
 } catch(error) {
  await unlink(part).catch(()=>{});
  throw error;
 }
}
