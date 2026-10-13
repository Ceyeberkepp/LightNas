# Storage agent and operation framework

This milestone integrates an approved storage workflow into the existing LightNAS application. Open **Storage → Storage operations · preview and approval** after signing in as the appliance administrator. The screen also lives at `/storage-operations.html`.

The console uses the existing login cookie. The browser never receives the root agent token. `/api/storage/agent/*` is an allowlisted, owner-session-only broker; delegated accounts and API tokens are rejected. The broker sends authenticated requests to a separate root-owned Unix-socket service.

## Implemented surface

| Requirement | Integration |
| --- | --- |
| Physical discovery | lsblk, sysfs, udev, read-only wipefs signature checks, SMART/NVMe health |
| Independent models | Disks, pools, filesystems, persisted managed-share definitions, health |
| Impact previews | Exact disk identity/size/signatures, command/layout, before/after managed configuration, affected services, risks and rollback limits |
| Privileged execution | Allowlisted typed jobs in `lightnas-storage-agent.service`; shared-token Unix socket authenticated behind existing administrator-session authorization |
| Lifecycle | Durable job state, logs, streamed/replayable progress, cancellation before commit, restart interruption detection, rollback metadata and approved restoration previews |
| Share adapters | Deterministic SMB/NFS fragments, explicit users/CIDRs, root squashing, input validation, full Samba candidate validation, no-op detection and activation recovery |

Supported typed mutations:

- `shares.replace`: complete replacement of the **new agent’s managed shares**, not the existing built-in Files share or legacy SMB/SFTP shares.
- `filesystem.create`: whole-device ext4 or Btrfs initialization on one unused blank disk.
- `pool.create`: Btrfs RAID1 data and metadata on two or more unused blank disks.

The new workflow has its own files: `/etc/samba/lightnas-storage-agent.conf`, `/etc/exports.d/lightnas-storage-agent.exports`, and `/var/lib/lightnas-storage/shares.json`. Existing managed Samba definitions are checked for name conflicts. It does not overwrite the legacy host-agent fragment, application state, storage pool definitions or permissions.

Existing storage/content, ZFS and legacy network-share APIs retain their previous behavior. Their migration to this operation framework is still outstanding; this change does not claim that every legacy mutation is preview-gated.

## Installation

Run the updated **existing** `install.sh` on a Debian/Ubuntu test appliance. It retains the established installer and service account, adds required storage/NFS tools, creates a separate random storage-agent token, inserts the new Samba include into the global section without replacing host configuration, and starts the new service. The existing host agent remains installed.

The token is root:lightnas mode 0640 at `/etc/lightnas/storage-agent.token`. The socket is root:lightnas mode 0660 at `/run/lightnas-storage/storage.sock`. Restrict membership in the lightnas group: it has administrative agent access. Source should remain root-owned and not writable by the management service.

SMB share users must already exist and be provisioned in Samba, and share directories must already exist under `/srv/lightnas` with appropriate permissions. The adapter does not provision accounts or ACLs. NFS needs a working kernel NFS server on the host; this is not assumed available in an unprivileged LXC. SMB-only changes do not activate NFS exports.

Disk initialization is disabled by default. On a disposable test appliance, explicitly enable it with a systemd override for `lightnas-storage-agent`:

```ini
[Service]
Environment=NAS_ALLOW_STORAGE_INITIALIZATION=1
```

Restart that service after the override. Initialization rejects missing stable identities, incomplete safety inventory, read-only disks, existing signatures, partitions, mounts, holders and unsupported device paths. Approval needs both the preview hash and exact `INITIALIZE <disk identities>` phrase. Formatting is irreversible, and is never described as automatically recoverable.

## Existing application API

All routes below are under `/api/storage/agent` and require an administrator interactive session.

| Method | Suffix | Purpose |
| --- | --- | --- |
| GET | /inventory | Resource inventory and health |
| POST | /preview | Generate a five-minute preview |
| POST | /jobs/:id/approve | Single-use hash plus exact disk confirmation when needed |
| POST | /jobs/:id/cancel | Request cancellation before commit |
| POST | /jobs/:id/rollback-preview | Propose restoring prior managed share configuration |
| GET | /jobs | Job history |
| GET | /jobs/:id | Status, logs, output, rollback metadata |
| GET | /jobs/:id/events?after=0 | Incremental events |
| GET | /jobs/:id/stream | SSE with Last-Event-ID support |

Job progress reflects phases, not measured filesystem command completion. Safety discovery is fresh before approval and again before execution; it does not repeatedly probe SMART while rechecking disk identity.

## Validation and limitations

The new agent tests and existing storage/share regression tests pass. Existing-login integration verifies unauthorized/delegated access rejection, route allowlisting, missing-agent failure, and CSP-compatible external browser scripts. The runtime prohibits Unix-socket creation, so one Unix-socket integration test is explicitly skipped locally.

The complete existing test suite has inherited failures: baseline main had 52 failures in this environment; this branch has 51 with no newly failing test names. Restricted host network-address discovery was causing the owner overview API to fail; it now degrades with an explicit availability flag instead of breaking the dashboard.

Installer shell syntax, JavaScript syntax, the platform contract and focused storage tests are verified. No live appliance installation, Samba/NFS service activation, disk formatting, ISO build or visual desktop/mobile browser test has been performed here.

Multi-file share writes are individually fsynced, not a single filesystem transaction. Failed activation restores prior configuration where possible and records recovery errors. Restarted active jobs are interrupted, never automatically replayed. Other host processes can still race with disk discovery; initialization needs exclusive host maintenance. History is capped at 1,000 jobs pending archival.

Still outstanding: legacy-mutation migration, mount/unmount/persistent mounts, snapshots, encryption, ACLs/quotas, pool expansion/replacement and the wider product roadmap. Newly initialized filesystems are not automatically mounted or added to the existing storage-pool configuration.
