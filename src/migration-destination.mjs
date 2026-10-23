import { runtimeInventory } from './runtimes-next.mjs';
import { listStoragePools } from './storage-pools.mjs';
import { planMigration } from './migration-planner.mjs';

const acceptedTypes = new Set(['vm','container','storage','network','share','setting','identity']);
const allowedTargets = /^[A-Za-z0-9_.:-]{1,80}$/;

// The destination preflight is read-only. Do not silently map VLANs or
// private LAN addresses: operators must choose existing resources explicitly.
export async function checkMigrationDestinations(input, providers = {}) {
  const plan = planMigration(input);
  // A read-only readiness report must never trust inherited mapping keys.
  const mappings = input.mappings || {};
  const [runtime, storage] = await Promise.all([
    (providers.runtimeInventory || runtimeInventory)(),
    (providers.listStoragePools || listStoragePools)()
  ]);
  const pools = (storage.pools || []).filter(x => x.online && x.writable);
  const vm = runtime.virtualization || {};
  const containers = runtime.containers || {};
  const results = plan.steps.map(step => {
    const mapping = Object.hasOwn(mappings, step.id) ? mappings[step.id] : {};
    const target = String(mapping.target || '');
    const issues = [];
    if (!acceptedTypes.has(step.type)) issues.push('unsupported resource type');
    if (step.type === 'setting') issues.push('manual configuration translation and permission review required');
    if (!target || !allowedTargets.test(target)) issues.push('choose a valid destination resource');
    else if (step.type === 'vm' && (!vm.available || !vm.enabled)) issues.push('local or connected VM runtime unavailable');
    else if (step.type === 'container' && (!containers.available || !containers.enabled)) issues.push('LXC runtime unavailable');
    else if (step.type === 'vm' && !pools.some(p => p.id === target && p.content?.includes('images'))) issues.push('destination is not a writable VM disk pool');
    else if (step.type === 'container' && !pools.some(p => p.id === target && p.content?.includes('rootdir'))) issues.push('destination is not a writable container rootdir pool');
    else if (step.type === 'storage' && !pools.some(p => p.id === target)) issues.push('destination pool is not writable and online');
    else if (step.type === 'network' && ![...(vm.networks || []), ...(containers.networks || [])].includes(target)) issues.push('destination network does not exist');
    else if (['share','identity'].includes(step.type)) issues.push('manual configuration translation and permission review required');
    if (mapping?.vlan != null && (!Number.isInteger(mapping.vlan) || mapping.vlan < 1 || mapping.vlan > 4094)) issues.push('VLAN must be between 1 and 4094');
    return { id:step.id, name:step.name, type:step.type, target:target || null, ready:issues.length===0, issues };
  });
  return {
    source:plan.source, phase:'destination-preflight', readOnly:true,
    approvedForExecution:false,
    results, ready:results.filter(x=>x.ready).length,
    blocked:results.filter(x=>!x.ready).length
  };
}
