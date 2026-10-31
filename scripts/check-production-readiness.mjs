import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const REQUIRED_PRODUCTION_GATES = Object.freeze([
  'installer-full-cycle',
  'storage-ownership-recovery',
  'off-host-backup-restore',
  'management-network-rollback',
  'signed-update-recovery',
  'security-independent-review',
  'multiuser-mobile-stress',
  'release-licensing-support'
]);

const validTag = value => typeof value === 'string' && /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value);
const validUrl = value => {
  try {const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && Boolean(u.hostname);}
  catch {return false;}
};

export function evaluateProductionReadiness(manifest, {releaseTag, now = new Date()} = {}) {
  const blockers = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.schemaVersion !== 1)
    return {ready:false, blockers:['Invalid production readiness manifest schema.']};
  if (!validTag(releaseTag) || manifest.candidateTag !== releaseTag)
    blockers.push('A versioned release tag must match a pre-reviewed candidateTag.');
  if (!Array.isArray(manifest.gates)) return {ready:false, blockers:[...blockers,'Release gates list is missing.']};
  const seen = new Set();
  const nowMs = new Date(now).getTime();
  for (const gate of manifest.gates) {
    if (!gate || typeof gate !== 'object' || !REQUIRED_PRODUCTION_GATES.includes(gate.id)) {
      blockers.push('Unknown or invalid production release gate.');
      continue;
    }
    if (seen.has(gate.id)) {blockers.push(`Duplicate production gate: ${gate.id}.`);continue;}
    seen.add(gate.id);
    if (gate.status !== 'verified') {blockers.push(`${gate.id}: not independently verified.`);continue;}
    if (typeof gate.reviewer !== 'string' || gate.reviewer.trim().length < 3)
      blockers.push(`${gate.id}: human reviewer is missing.`);
    const time = Date.parse(gate.verifiedAt);
    if (typeof gate.verifiedAt !== 'string' || !Number.isFinite(time) ||
        !Number.isFinite(nowMs) || time > nowMs || nowMs - time > 90*86400000)
      blockers.push(`${gate.id}: recent verification date is missing or invalid.`);
    if (!Array.isArray(gate.evidence) || gate.evidence.length === 0 ||
      gate.evidence.some(item => !item || typeof item !== 'object' ||
        !validUrl(item.url) || typeof item.summary !== 'string' || item.summary.trim().length < 20))
      blockers.push(`${gate.id}: reviewed HTTPS evidence references and descriptions are required.`);
  }
  for (const id of REQUIRED_PRODUCTION_GATES)
    if (!seen.has(id)) blockers.push(`${id}: mandatory release gate is missing.`);
  return {ready:blockers.length === 0, blockers, gateCount:seen.size};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tagIndex = process.argv.indexOf('--tag');
  const releaseTag = tagIndex < 0 ? '' : process.argv[tagIndex + 1];
  const manifestPath = resolve('config/production-readiness.json');
  try {
    const manifest = JSON.parse(await readFile(manifestPath,'utf8'));
    const result = evaluateProductionReadiness(manifest,{releaseTag});
    if (!result.ready) {
      console.error('PRODUCTION RELEASE BLOCKED: Required independent evidence is incomplete.');
      for (const reason of result.blockers) console.error('- '+reason);
      process.exitCode = 1;
    } else {
      console.log('Production release evidence metadata is complete for '+releaseTag+'.');
      console.log('IMPORTANT: This does not independently authenticate evidence or replace release-owner review.');
    }
  } catch(error) {
    console.error('PRODUCTION RELEASE BLOCKED: '+error.message);
    process.exitCode = 1;
  }
}
