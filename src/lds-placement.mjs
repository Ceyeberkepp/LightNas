import {createHash} from 'node:crypto';

/** Deterministic, failure-domain-aware placement for an experimental LDS cluster.
 * This is not a storage engine, replication protocol, or durability guarantee.
 */
export function placeReplicas({objectId, nodes, replicas = 3, failureDomain = 'host', requiredBytes = 1}) {
  if (typeof objectId !== 'string' || objectId.length === 0) throw new TypeError('objectId required');
  if (!Array.isArray(nodes) || !Number.isSafeInteger(replicas) || replicas < 1 || !Number.isSafeInteger(requiredBytes) || requiredBytes < 1) throw new TypeError('invalid placement request');
  const seen = new Set();
  const candidates = nodes.map(node => {
    if (!node || typeof node.id !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}$/.test(node.id) || seen.has(node.id)) throw new TypeError('invalid or duplicate node id');
    seen.add(node.id);
    const domain = node.domains?.[failureDomain];
    if (typeof domain !== 'string' || domain.length === 0) throw new TypeError('missing failure domain');
    const capacity = node.freeBytes;
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw new TypeError('invalid capacity');
    return {...node, domain};
  }).filter(node => node.healthy === true && node.freeBytes >= requiredBytes);
  const domainCount = new Set(candidates.map(node => node.domain)).size;
  if (domainCount < replicas) return Object.freeze({ok:false, reason:'INSUFFICIENT_FAILURE_DOMAINS', required:replicas, available:domainCount, nodes:[]});
  const score = id => createHash('sha256').update(`${objectId}\0${id}`).digest('hex');
  candidates.sort((a,b) => score(b.id).localeCompare(score(a.id)) || a.id.localeCompare(b.id));
  const selected=[], usedDomains=new Set();
  for (const node of candidates) {
    if (usedDomains.has(node.domain)) continue;
    selected.push(node.id); usedDomains.add(node.domain);
    if (selected.length === replicas) break;
  }
  return Object.freeze({ok:true, nodes:Object.freeze(selected), failureDomain, replicas});
}
