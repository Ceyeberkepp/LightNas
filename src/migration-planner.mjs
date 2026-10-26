// LightNAS migration discovery and planning contract.
// No source credentials, secrets, raw disk bytes or machine identifiers are
// transmitted. Import execution must be a separate, administrator-approved job.
export const MIGRATION_SOURCES = Object.freeze({
  vmware: {
    label: 'VMware vSphere / ESXi',
    discovery: ['vCenter/ESXi inventory', 'VM configuration', 'VMDK disks', 'port groups and VLANs', 'datastores', 'guest networks', 'snapshots'],
    adapters: ['VM inventory and disk export', 'VMDK to local image conversion', 'port group mapping'],
    constraints: ['No automatic transfer of vCenter SSO, vSAN, distributed switches, or ESXi host configuration', 'Snapshots must be consolidated or exported explicitly']
  },
  proxmox: {
    label: 'Proxmox VE',
    discovery: ['nodes and clusters', 'QEMU VMs', 'LXC containers', 'bridges/VLANs', 'storage definitions', 'backups', 'guest devices'],
    adapters: ['API inventory', 'vzdump backup import', 'QEMU disk conversion', 'LXC rootfs and config review'],
    constraints: ['Unprivileged LXC ID mappings need review', 'Ceph and cluster settings need destination-specific mapping']
  },
  truenas: {
    label: 'TrueNAS SCALE / CORE',
    discovery: ['datasets and ZFS pools', 'SMB/NFS shares', 'users/groups and ACLs', 'snapshots', 'apps/jails', 'VMs where supported', 'network interfaces'],
    adapters: ['read-only configuration export', 'dataset transfer via supported backup/replication', 'share/ACL mapping'],
    constraints: ['ZFS pool import is never automatic', 'Apps/jails cannot always be converted to Linux containers', 'Identity and ACL semantics require validation']
  },
  redhat: {
    label: 'Red Hat Enterprise Linux / KVM',
    discovery: ['libvirt domains', 'QCOW2/raw volumes', 'LVM and storage pools', 'bridges and VLANs', 'Podman containers', 'SELinux contexts', 'system services'],
    adapters: ['libvirt XML review', 'virt-compatible disk conversion', 'OCI container export/import where compatible'],
    constraints: ['SELinux policies and RHEL subscriptions do not automatically transfer', 'System containers, services and network profiles need explicit mapping']
  }
});

const TYPES = new Set(['vm', 'container', 'storage', 'network', 'share', 'setting', 'identity', 'app']);
const NAME = /^[A-Za-z0-9][A-Za-z0-9_. -]{0,119}$/;
function plainText(value, max = 180) {
  const text = String(value ?? '').trim();
  if (text.length > max || /[\x00-\x1f]/.test(text)) throw new Error('invalid migration field');
  return text;
}
export function supportedMigrationSources() {
  return Object.entries(MIGRATION_SOURCES).map(([id, info]) => ({
    id, label: info.label, discovery: [...info.discovery],
    adapters: [...info.adapters], constraints: [...info.constraints]
  }));
}
export function planMigration({ source, items, mappings = {} }) {
  if (!Object.hasOwn(MIGRATION_SOURCES, source)) throw new Error('unsupported migration source');
  if (!Array.isArray(items) || items.length > 2000) throw new Error('invalid source inventory');
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) throw new Error('invalid destination mappings');
  const ids = new Set();
  const steps = items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid inventory item');
    const id = plainText(item.id, 128);
    const name = plainText(item.name);
    const type = plainText(item.type, 20);
    if (!id || !name || !NAME.test(name) || !TYPES.has(type) || ids.has(id)) throw new Error('invalid or duplicate inventory item');
    ids.add(id);
    const destination = mappings[id];
    if (destination && (typeof destination !== 'object' || Array.isArray(destination))) throw new Error('invalid destination mapping');
    const mapped = destination && destination.target ? plainText(destination.target) : '';
    const requiresMapping = ['vm', 'container', 'storage', 'network', 'share', 'identity'].includes(type);
    const needsAdapter = type === 'app';
    return {
      order: index + 1, id, name, type,
      target: mapped || null,
      status: needsAdapter ? 'needs-app-migration-adapter' : (!requiresMapping || mapped ? 'ready-for-review' : 'needs-mapping'),
      actions: ['read-only discovery', 'map destination', 'estimate capacity/downtime', 'back up source', 'test restore', 'approval', 'copy', 'verify', 'optional cutover'],
      destructive: false,
      automaticCutover: false
    };
  });
  return {
    schemaVersion: 1,
    source, sourceLabel: MIGRATION_SOURCES[source].label,
    phase: 'planning', sourceIsReadOnly: true,
    transmitsTelemetry: false, trackingPixels: false,
    requiresAdminApproval: true,
    steps,
    blockers: steps.filter(step => step.status !== 'ready-for-review').map(step => step.id),
    migrationStarted: false
  };
}
