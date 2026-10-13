# Storage agent and operation framework

This milestone integrates an approved storage workflow into the existing LightNAS application. Open **Storage → Storage operations · preview and approval** after signing in as the appliance administrator. The screen also lives at `/storage-operations.html`.

The Storage and Network Shares screens link to the approved workflow, and managed SMB/NFS definitions appear in the administrator’s existing share list. Existing pool-definition and space dialogs display an impact review before submitting approval.

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
- `pool.definition.create/update/delete`: register existing mounted data sources, change content policy, or remove definitions without deleting files.
- `space.create/update/delete`: create and label managed directories or remove an empty space.

The new workflow has its own files: `/etc/samba/lightnas-storage-agent.conf`, `/etc/exports.d/lightnas-storage-agent.exports`, and `/var/lib/lightnas-storage/shares.json`. Existing managed Samba definitions are checked for name conflicts. It preserves the legacy host-agent share fragment and application state. Approved pool-definition jobs update the existing storage-pools.json registry, and approved space jobs use a separate storage-spaces.json registry read by the existing API. Existing directory permissions are not changed; new directories use root:lightnas ownership and mode 0770.

Existing pool-definition and space dialogs now receive HTTP 428 with an exact preview and require explicit approval before the root agent changes anything. They show progress and permit cancellation before commit. Backend guards intercept legacy host-storage control routes before their previous mutation handlers.

Legacy ZFS mutations, raw disk cleaning, Proxmox storage configuration, and legacy SMB/SFTP account provisioning/removal are disabled with a clear unsupported-operation response until their typed adapters are implemented. Existing definitions and data remain readable. Supported SMB/NFS changes use the new approved workflow. Ordinary file upload/download/deletion and storage-content transfer remain file-data operations with their existing access controls; they are not host storage-configuration mutations.

## Installation

Run the updated **existing** `install.sh` on a Debian/Ubuntu test appliance. It retains the established installer and service account, adds required storage/NFS tools, creates a separate random storage-agent token, inserts the new Samba include into the global section without replacing host configuration, and starts the new service. The existing host agent remains installed.

The token is root:lightnas mode 0640 at `/etc/lightnas/storage-agent.token`. The socket is root:lightnas mode 0660 at `/run/lightnas-storage/storage.sock`. Restrict membership in the lightnas group: it has administrative agent access. Source should remain root-owned and not writable by the management service.

SMB share users must already exist and be provisioned in Samba, and share directories must already exist under `/srv/lightnas` or a registered pool’s Files content directory with appropriate permissions. The adapter validates the Samba credential record and actual read/traverse/write access for each SMB user; it does not provision accounts or ACLs. Existing parent directories must grant traversal to the LightNAS service account before a source can be registered. New managed directories are created using file-descriptor-anchored traversal that refuses symlinks. NFS needs a working kernel NFS server on the host; this is not assumed available in an unprivileged LXC. SMB-only changes do not activate NFS exports. NFS jobs require a running kernel NFS service and verify the export after activation. Successful activation is recorded with a configuration hash and boot identifier; matching files without an activation record are not treated as a verified no-op.

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
| GET | /inventory | Resource inventory, pool definitions, share roots and health |
| GET | /shares | Managed share definitions without a hardware scan |
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

The complete existing test suite has inherited failures: the earlier baseline had 52 failures, while PR #237 reduced this to 51. The merged-main baseline has 301 passing tests, 51 failures and one skipped test. This completion branch has 322 passing tests, the same 51 failing test names, and one skip; no new failures were introduced. The focused storage/share/login group has 58 passes and one environment-blocked Unix-socket skip. Restricted host network-address discovery was causing the owner overview API to fail; it now degrades with an explicit availability flag instead of breaking the dashboard.

Installer shell syntax, JavaScript syntax, the platform contract and focused storage tests are verified. No live appliance installation, Samba/NFS service activation, disk formatting, ISO build or visual desktop/mobile browser test has been performed here.

Multi-file share writes are individually fsynced, not a single filesystem transaction. Failed activation restores prior configuration where possible and records recovery errors. Restarted active jobs are interrupted, never automatically replayed. Other host processes can still race with disk discovery; initialization needs exclusive host maintenance. History is capped at 1,000 jobs pending archival.

Still outstanding: typed adapters for the explicitly disabled legacy controls, mount/unmount/persistent mounts, snapshots, encryption, ACLs/quotas, pool expansion/replacement and the wider product roadmap. Newly initialized filesystems are not automatically mounted or added to the existing storage-pool configuration.


## Impact and recovery details

Pool/space previews include before/after definitions, registry filename and previous/new ownership and mode, mounted-source identity, every managed directory to create, empty-directory removal metadata, resulting permissions, and file-preservation behavior. The agent re-plans against current state before approval and before execution. It journals newly created directories in rollback metadata, verifies the written registry, and restores prior definitions on failure. Rollback never removes populated directories; retained paths are recorded. Empty-space recovery restores the previous mode and ownership.

Share previews include host Samba/NFS configuration context so external configuration edits invalidate the preview. API job responses redact nested credential fields from pre-existing remote provider definitions. Filesystem initialization remains irreversible and explicitly reports that automatic data rollback is unavailable.
