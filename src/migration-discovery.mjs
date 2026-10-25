import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { planMigration, supportedMigrationSources } from './migration-planner.mjs';

// Read-only source inventory API. Never retain credentials or disable TLS checks.
function internal(address) {
  if (address.startsWith('10.') || address.startsWith('192.168.') || address.startsWith('127.')) return !address.startsWith('127.');
  if (address.startsWith('172.')) { const n = Number(address.split('.')[1]); return n >= 16 && n <= 31; }
  if (address.startsWith('fd') || address.startsWith('fc')) return true;
  return false;
}
async function assertInternal(host) {
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('loopback destinations are forbidden');
  const ips = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!ips.length || ips.some(ip => !internal(ip.address))) throw new Error('source must resolve only to private LAN addresses');
}
async function jsonRequest(base, path, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(new URL(path, base), { method: 'GET', headers, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error('source inventory request rejected (' + response.status + ')');
    if (Number(response.headers.get('content-length') || 0) > 2000000) throw new Error('inventory response too large');
    const body = await response.text();
    if (body.length > 2000000) throw new Error('inventory response too large');
    return JSON.parse(body);
  } finally { clearTimeout(timer); }
}
async function proxmoxPasswordSession(base, username, password) {
  if (!/^[A-Za-z0-9_.@-]{1,100}$/.test(username) || !password || password.length > 1024) throw new Error('Valid Proxmox username and password required');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(new URL('api2/json/access/ticket', base), {
      method:'POST', redirect:'error', signal:controller.signal,
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({username,password})
    });
    if (!response.ok) throw new Error('Proxmox login rejected ('+response.status+')');
    const raw = await response.text();
    if (raw.length > 10000) throw new Error('Login response too large');
    const ticket = JSON.parse(raw)?.data?.ticket;
    if (typeof ticket !== 'string' || !/^PVE:[A-Za-z0-9_-]+:.{1,2000}$/.test(ticket)) throw new Error('Proxmox did not return a valid login ticket');
    return {Cookie:'PVEAuthCookie='+ticket};
  } finally {clearTimeout(timeout);}
}
function mapItems(items, type, sourcePrefix) {
  return (Array.isArray(items) ? items : []).map((x, i) => ({
    id: String(sourcePrefix + ':' + (x.vmid ?? x.id ?? x.name ?? i)).slice(0, 128),
    name: String(x.name || x.hostname || x.volid || x.vmid || 'Unnamed source').slice(0, 120),
    type
  }));
}
export async function inspectMigrationSource(input) {
  const source = String(input?.source || '');
  if (!['proxmox','vmware','truenas','redhat'].includes(source)) throw new Error('unsupported source');
  if (source === 'redhat') throw new Error('Red Hat connection needs a local, reviewed libvirt/Podman inventory export; remote SSH credentials are not accepted by this endpoint.');
  const host = String(input?.host || '').trim();
  const token = String(input?.token || '').trim();
  const username = String(input?.username || '').trim();
  const password = typeof input?.password === 'string' ? input.password : '';
  if (!/^[a-zA-Z0-9.:-]{1,253}$/.test(host) || (source !== 'proxmox' && !token) || token.length > 2048) throw new Error('source hostname and scoped token required');
  if (host.includes('..') || host.includes('@') || host.includes('/') || host.includes('#')) throw new Error('invalid source host');
  await assertInternal(host);
  const port = source === 'proxmox' ? 8006 : source === 'truenas' ? 443 : 443;
  const base = 'https://' + (isIP(host) === 6 ? '[' + host + ']' : host) + ':' + port + '/';
  let items = [];
  if (source === 'proxmox') {
    const headers = username && password ? await proxmoxPasswordSession(base, username, password) : { Authorization: 'PVEAPIToken=' + token };
    if(!token && !(username && password)) throw new Error('Proxmox username/password or API token required');
    const result = await jsonRequest(base, 'api2/json/cluster/resources', headers);
    const rows = result?.data || [];
    items = [
      ...mapItems(rows.filter(x => x.type === 'qemu'), 'vm', 'qemu'),
      ...mapItems(rows.filter(x => x.type === 'lxc'), 'container', 'lxc'),
      ...mapItems(rows.filter(x => x.type === 'storage'), 'storage', 'storage')
    ];
  } else if (source === 'vmware') {
    const headers = { 'vmware-api-session-id': token };
    const [vms, datastores, networks] = await Promise.all([
      jsonRequest(base, 'api/vcenter/vm', headers),
      jsonRequest(base, 'api/vcenter/datastore', headers),
      jsonRequest(base, 'api/vcenter/network', headers)
    ]);
    items = [
      ...mapItems((vms || []).map(x => ({ id: x.vm, name: x.name })), 'vm', 'vmware-vm'),
      ...mapItems((datastores || []).map(x => ({ id: x.datastore, name: x.name })), 'storage', 'vmware-datastore'),
      ...mapItems((networks || []).map(x => ({ id: x.network, name: x.name })), 'network', 'vmware-network')
    ];
  } else {
    const headers = { Authorization: 'Bearer ' + token };
    const [pools, shares, vms] = await Promise.all([
      jsonRequest(base, 'api/v2.0/pool', headers),
      jsonRequest(base, 'api/v2.0/sharing/smb', headers),
      jsonRequest(base, 'api/v2.0/vm', headers)
    ]);
    items = [
      ...mapItems(pools, 'storage', 'truenas-pool'),
      ...mapItems(shares, 'share', 'truenas-smb'),
      ...mapItems(vms, 'vm', 'truenas-vm')
    ];
  }
  if (items.length > 2000) throw new Error('inventory exceeds first-pass limit; narrow the migration scope');
  // A discovery response is an inventory, not confirmation of migration support.
  return { source, items, discoveryOnly: true, credentialsStored: false, capabilities: supportedMigrationSources().find(x => x.id === source) };
}
export function previewMigrationManifest(input) {
  return planMigration(input);
}
