// Read-only NAS migration permission review. No users, shares or ACLs are changed.
const namePattern = /^[A-Za-z0-9][A-Za-z0-9_.@ -]{0,127}$/;
const own = (obj,key) => Object.prototype.hasOwnProperty.call(obj,key);
const bad = message => { throw Object.assign(new Error(message),{status:400}); };
const validName = value => typeof value === 'string' && namePattern.test(value) && value.trim() === value;
export function checkShareMigration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) bad('Invalid share inventory');
  const { shares, identities, mappings } = input;
  if (!Array.isArray(shares) || shares.length > 500 ||
      !Array.isArray(identities) || identities.length > 2000 ||
      !mappings || typeof mappings !== 'object' || Array.isArray(mappings)) bad('Invalid share inventory');
  const identityTypes = new Map();
  for (const identity of identities) {
    if (!identity || !validName(identity.id) || !['user','group'].includes(identity.type) ||
        identityTypes.has(identity.id)) bad('Invalid or duplicate identity');
    identityTypes.set(identity.id, identity.type);
  }
  const seen = new Set();
  const results = shares.map(share => {
    if (!share || !validName(share.id) || !validName(share.name) ||
        !['smb','nfs'].includes(share.protocol) || !Array.isArray(share.acl) ||
        share.acl.length > 1000 || seen.has(share.id)) bad('Invalid or duplicate share');
    seen.add(share.id);
    const issues = [];
    const target = own(mappings, share.id) ? mappings[share.id] : null;
    if (!target || typeof target !== 'object' || Array.isArray(target) ||
        !validName(target.pool) || !validName(target.name)) issues.push('Explicit destination pool and name required');
    if (share.protocol === 'nfs') issues.push('NFS client access and root squash require manual review');
    if (!share.acl.length) issues.push('Empty ACL requires manual access review');
    const principals = new Set();
    for (const entry of share.acl) {
      if (!entry || !validName(entry.identityId) ||
          !['read','write','full'].includes(entry.permission) || typeof entry.deny !== 'boolean')
        bad('Invalid access entry');
      if (principals.has(entry.identityId)) issues.push('Duplicate principal ACL needs manual review');
      principals.add(entry.identityId);
      const mapped = own(mappings,entry.identityId) ? mappings[entry.identityId] : null;
      if (!identityTypes.has(entry.identityId)) issues.push('Unresolved source identity: '+entry.identityId);
      if (!mapped || typeof mapped !== 'object' || Array.isArray(mapped) ||
          !validName(mapped.target) || !['user','group'].includes(mapped.type) ||
          mapped.type !== identityTypes.get(entry.identityId))
        issues.push('Missing or mismatched destination identity: '+entry.identityId);
      if (entry.deny) issues.push('Explicit deny ACL needs manual semantics review');
    }
    issues.push('Administrator must verify destination filesystem ACL and share semantics before applying');
    return {id:share.id,name:share.name,protocol:share.protocol,ready:false,
      destination:target && validName(target.name) ? target.name : null,issues:[...new Set(issues)]};
  });
  return {phase:'permission-preflight',readOnly:true,approvedForExecution:false,
    canApplyAutomatically:false,results,blocked:results.length};
}
