import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { verifiedMigrationFile } from './migration-transfer.mjs';

const exec = promisify(execFile);
const permitted = /\.(tar|tar\.gz|tgz|tar\.xz|tar\.zst)$/i;
const VOLUME = /^rootfs(?:\:|\s)/m;
function safeEntry(name) {
  if (!name || name.startsWith('/') || name.includes('\\') || /[\x00-\x1f]/.test(name)) return false;
  const parts = name.split('/');
  return !parts.some(part => part === '..');
}
export async function inspectVerifiedLxcArchive(jobId) {
  const source = verifiedMigrationFile(jobId);
  if (!permitted.test(source.name)) throw Object.assign(new Error('Select a verified Proxmox LXC tar archive'), { status: 409 });
  const info = await lstat(source.path);
  if (!info.isFile() || info.size !== source.size) throw Object.assign(new Error('Archive has changed since staging'), { status: 409 });
  const hash = createHash('sha256');
  for await (const block of createReadStream(source.path)) hash.update(block);
  if (hash.digest('hex') !== source.sha256) throw Object.assign(new Error('Archive checksum mismatch'), { status: 409 });
  let stdout;
  try {
    ({ stdout } = await exec('tar', ['-taf', source.path], { timeout: 90000, maxBuffer: 8 * 1024 * 1024 }));
  } catch (error) {
    throw Object.assign(new Error('Cannot enumerate LXC archive: '+String(error.stderr || error.message).slice(0,200)), { status: 409 });
  }
  const entries = stdout.split('\n').filter(Boolean);
  if (entries.length > 200000 || entries.some(entry => !safeEntry(entry))) {
    throw Object.assign(new Error('Archive contains unsafe paths or exceeds inventory limit'), { status: 409 });
  }
  const hasRootfs = entries.some(entry => /(^|\/)etc\/(?:os-release|debian_version)$/.test(entry));
  const configCandidates = entries.filter(entry => /(^|\/)(?:pct\.conf|vzdump-lxc\.conf|config)$/.test(entry)).slice(0,10);
  return {
    source: source.name, archiveSha256: source.sha256,
    entryCount: entries.length, hasLinuxRootfsMarker: hasRootfs,
    configurationFiles: configCandidates,
    canRestoreAutomatically: false,
    notes: [
      'Preserve UID/GID ownership, xattrs, ACLs and mount point mappings',
      'Review bind mounts, devices, privileged status, network and VLAN before restore',
      'Original Proxmox LXC configuration cannot be applied directly to LightNAS',
      'Archive safety checks are a preflight only, not safe extraction certification'
    ]
  };
}
