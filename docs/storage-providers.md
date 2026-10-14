# Storage providers

The Add menu retains all 14 providers. Its fields and validation come from a shared provider definition, so adding a provider no longer opens a Directory form or rejects an otherwise valid backing volume because its label is not Directory/Btrfs.

| Provider | Creation path | Required backing storage |
| --- | --- | --- |
| Directory | Register a mounted volume | Writable mounted data directory |
| LVM | Register a mounted logical volume | Existing VG/LV; `lvs` verifies device and VG identity |
| LVM-Thin | Register a mounted thin logical volume | Existing thin LV; thin-pool and segment type are verified |
| BTRFS | Register a mounted filesystem | Actual Btrfs filesystem |
| NFS | Connect server/export, or register an existing mount | Reachable writable NFSv4 export; endpoint must match an existing mount |
| SMB/CIFS | Connect server/share, or register an existing mount | Reachable SMB 3.1.1 share and account, or existing CIFS mount |
| GlusterFS | Connect server/volume, or register an existing mount | Gluster volume and installed Gluster client |
| iSCSI | Register a mounted LUN filesystem | Existing active iSCSI session, formatted/mounted LUN; session target and portal are verified through sysfs |
| CephFS | Connect monitors/filesystem/client, or register an existing mount | CephFS filesystem, client key, Ceph kernel support/client |
| RBD | Register a mapped, mounted image filesystem | Existing kernel-mapped RBD image; pool/image identity is verified through sysfs |
| ZFS over iSCSI | Register the mounted exported LUN | Active iSCSI session plus the exporting server's ZFS pool name; this does not administer the remote ZFS pool |
| ZFS | Register a mounted dataset | Existing ZFS dataset; dataset and mount point are verified |
| Proxmox Backup Server | Connect native datastore | HTTPS PBS endpoint, datastore and API token with audit/read permissions; displays capacity and native backup snapshots |
| ESXi | Connect native datastore | HTTPS ESXi host, datastore and account with datastore browsing permission; displays existing datastore files |

## Network mounts

Select **Connect server** to create a new NFS, SMB, GlusterFS or CephFS connection. The impact preview includes the exact `/mnt/lightnas/<name>` mount, systemd mount unit, credential reference and content directories. Approving the job creates and enables the persistent mount, verifies it appeared, and then creates the LightNAS content layout. Existing data is preserved.

The source server must grant the LightNAS account access. NFS root-squash is retained: if a server refuses ownership changes, inherited ACLs must already allow the LightNAS account to read/write/traverse the new directories. LightNAS does not disable root-squash or weaken server permissions.

Passwords and Ceph keys are submitted as private job inputs and stored under `/var/lib/lightnas-storage/provider-credentials` in root-only files. Public previews, job responses and `storage-pools.json` contain no provider secrets. Removing a mounted storage definition preserves its data and managed connection; it does not unmount or destroy existing volumes.

The updated one-click installer installs NFS/CIFS/LVM/iSCSI clients, and installs Gluster, Ceph, PBS and ZFS clients when the distribution has a package candidate. Kernel support and remote services cannot be supplied by a UI dropdown; a missing host helper or inaccessible server produces a specific setup failure while keeping the provider available.

## Native remote repositories

PBS is not exposed as an ordinary writable directory: writing random backup files into its chunk store would bypass the backup protocol. PBS connections authenticate with `PBSAPIToken=TOKENID:TOKENSECRET`, show live capacity, and browse native snapshots. Writing/restoring backups still uses the native PBS backup client.

ESXi connections authenticate directly to an ESXi host, verify its SDK identity, and browse the selected datastore. The current application integration is read-only; use ESXi datastore tools for writes. Remote datastore paths are excluded from local VM/container disk and media paths.

Use the system trusted CA certificates, or enter the remote server certificate's SHA-256 fingerprint for a self-signed certificate. Fingerprint verification happens before sending authentication headers. TLS validation is never globally disabled.

## Local/block storage

Registering a mounted LVM/thin-LVM, ZFS, RBD or iSCSI volume makes its existing filesystem usable for the selected content types. This flow does not create a VG, allocate a raw thin LV, log in to a new iSCSI target, map a new RBD image, import/format a disk or create a ZFS pool. Prepare/expose that backing storage first; destructive disk initialization remains a separate approved operation.

The compact storage dialog and content checkbox layout are retained.
