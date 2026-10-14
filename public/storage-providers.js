// Shared by the UI and root storage agent: keep every provider selectable.
export const STORAGE_PROVIDERS = Object.freeze([
  {id:'directory',label:'Directory',help:'Use an existing mounted data volume.',fields:[]},
  {id:'lvm',label:'LVM',help:'Use a mounted logical volume in an existing volume group.',fields:['vgName']},
  {id:'lvm-thin',label:'LVM-Thin',help:'Use a mounted thin logical volume from an existing thin pool.',fields:['vgName','thinPool']},
  {id:'btrfs',label:'BTRFS',help:'Use a mounted Btrfs filesystem or subvolume.',fields:[]},
  {id:'nfs',label:'NFS',help:'Connect an NFS export or use an existing NFS mount.',fields:['server','exportPath'],connect:true},
  {id:'smb-cifs',label:'SMB/CIFS',help:'Connect an SMB share or use an existing CIFS mount.',fields:['server','share','username','domain'],connect:true,credential:'password'},
  {id:'glusterfs',label:'GlusterFS',help:'Connect a Gluster volume or use an existing GlusterFS mount.',fields:['server','volume'],connect:true},
  {id:'iscsi',label:'iSCSI',help:'Use the mounted filesystem on a connected iSCSI LUN. Existing LUN data is preserved.',fields:['portal','target']},
  {id:'cephfs',label:'CephFS',help:'Connect a Ceph filesystem or use an existing CephFS mount.',fields:['monitors','filesystem','username'],connect:true,credential:'secret'},
  {id:'rbd',label:'RBD',help:'Use an existing mapped and mounted Ceph RBD image.',fields:['rbdPool','image']},
  {id:'zfs-over-iscsi',label:'ZFS over iSCSI',help:'Use a mounted filesystem on a connected LUN exported by your ZFS server.',fields:['portal','target','zfsPool']},
  {id:'zfs',label:'ZFS',help:'Use an existing mounted ZFS dataset.',fields:['dataset']},
  {id:'proxmox-backup-server',label:'Proxmox Backup Server',help:'Connect a native PBS datastore with an API token. Browse backup snapshots without exposing its chunk store as a normal directory.',fields:['server','datastore','username','fingerprint'],remote:true,credential:'secret',content:['backup']},
  {id:'esxi',label:'ESXi',help:'Connect a native ESXi datastore over HTTPS. Browse its existing files; remote VM disks are not local VM disk paths.',fields:['server','datastore','username','fingerprint'],remote:true,credential:'password',content:['iso','images','backup','snippets','files']}
]);
export function providerDefinition(id){const provider=STORAGE_PROVIDERS.find(p=>p.id===id);if(!provider)throw Error('Unknown storage provider');return provider;}
export function acceptsSource(id,source){
  if(id==='directory')return true;
  if(id==='btrfs'||id==='zfs')return source.type===id;
  if(id==='nfs')return ['nfs','nfs4'].includes(source.type);
  if(id==='smb-cifs')return ['cifs','smb3'].includes(source.type);
  if(id==='glusterfs')return ['glusterfs','fuse.glusterfs'].includes(source.type);
  if(id==='cephfs')return ['ceph','fuse.ceph','fuse.ceph-fuse'].includes(source.type);
  if(id==='lvm'||id==='lvm-thin')return /^\/dev\/(mapper\/|dm-)/.test(source.device);
  if(id==='rbd')return /^\/dev\/rbd\d+(?:p\d+)?$/.test(source.device);
  if(id==='iscsi'||id==='zfs-over-iscsi')return /^\/dev\/(sd[a-z]+\d*|mapper\/|dm-)/.test(source.device);
  return false;
}
