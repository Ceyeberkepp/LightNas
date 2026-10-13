# Storage, protection and certificate features

The screenshot feature set is implemented through LightNAS's existing **Pools & datasets**, **Backups** and **Settings → Security** screens. Navigation, theme, card/table/dialog classes and the desktop/mobile layout system are retained. An external CSP-compatible script supplies the extra controls; it does not load TrueNAS UI or code.

| Screenshot feature | LightNAS implementation |
| --- | --- |
| Dataset list/search and details | Root ZFS inventory; used/free, written/child/snapshot allocation, compression ratio, sync, atime, dedup, case sensitivity, encryption and key status |
| Generic / SMB / Apps / Multiprotocol presets | Typed creation with explicit preset properties; SMB/multiprotocol use POSIX ACL support. Presets do not create share definitions automatically |
| Add Zvol | Bounded size, reserved or sparse provisioning; new volumes are not automatically attached to guests or published through iSCSI |
| Space management | Dataset quota/refquota/reservation and existing Unix user/group quotas |
| Permissions | Owner/group IDs and nonrecursive Unix mode editing; current POSIX ACL inspection |
| Usage | Managed share paths, protection tasks and Docker bind mounts associated with the selected dataset; unavailable discovery is explicit |
| Snapshot / Snapshot Tasks | Manual ZFS snapshots plus approved hourly/daily/weekly policies and bounded retention of this exact task's snapshots |
| Cloud Backup / Cloud Sync | Rclone copy or explicitly approved mirror, push/pull; S3-compatible, Drive, Google Photos, Dropbox, Azure Blob, B2 and Storj connection profiles |
| Rsync tasks | Local directory copy or explicitly approved mirror with safe-link handling; remote transfers use the separate cloud/SSH controls |
| Replication | Full ZFS snapshot streams over SSH to a new unmounted receiving dataset, with a pinned host key; no destructive receive flags |
| Certificates / CSR | PEM certificate/key matching, metadata/expiry, RSA-3072 signing requests, public CSR download and signed-CSR import using the retained private key |
| ACME DNS authenticators | Scoped Cloudflare DNS profiles, Certbot issuance and background renewal inside the root service |
| App Store thumbnails | Catalog icon/thumbnail metadata with selfh.st PNG fallback, same-origin caching, lazy loading and fixed-size initials fallback |

## Approval and execution

All new host mutations use the existing administrator-session broker and serialized root-owned storage service. Previews include commands, source identities, destination policy, changed properties, configuration state, rollback limitations and deletion authority. The agent rechecks those inputs before approval and execution. Cancellation is accepted before commit; copy/replication/ACME commands cannot be cancelled through the UI once commit starts.

Saved recurring policies explicitly authorize future runs against the same source/destination. Schedules use **UTC**, not the browser's local timezone. A 30-second scheduler loop runs in `lightnas-storage-agent.service`, durably advances the next run before execution and never replays missed runs automatically. Operation history retains progress/log/recovery evidence; selected task details show the last job's status. The current storage-job retention ceiling remains 1,000 jobs; archival is still needed for long-running deployments.

Snapshot retention touches only names matching `<source>@lightnas-<task-id>-<numeric-run-stamp>`. Reserve that namespace for LightNAS. Copy overwrites same-named destination files but preserves destination-only files. Mirror can delete destination-only files and requires explicit confirmation when authorizing the policy or manually running it. Scheduled mirror runs use that previously approved deletion policy. File-level copy/mirror previews describe the destination policy, not a frozen inventory of every future file.

Property failures attempt to restore the previous value/source (including inherited properties). Unix permission rollback restores owner/group/mode; it does not recreate full ACL semantics. Newly created datasets, zvols or snapshots are not automatically destroyed after partial failure. Copy/replication has no automatic data rollback, and failed remote receives need inspection. SSH receive creates a new dataset for each successful full transfer; incremental replication and remote retention are not yet implemented.

Legacy backup definitions remain readable through **Saved definitions**. They are not executable jobs and are not silently migrated. The legacy run endpoint now returns an explicit error instead of recording a request as queued work. New executable jobs use the existing backup toolbar and table.

## Installation and host requirements

The one-click installer adds rsync, rclone, Certbot and the Cloudflare DNS plugin, restarts the root storage service, and installs ZFS userland when a package candidate is available. It does not force DKMS/kernel-module installation or import pools. Dataset/zvol/snapshot/replication operations require a functioning host ZFS runtime and actual accessible pools; unprivileged LXC environments may not expose it. These features do not convert ext4/Btrfs storage into ZFS.

Cloud accounts/OAuth tokens, a reachable SSH receiving host with suitable permissions, domain ownership and scoped DNS credentials must be configured by the operator. Google Photos follows Google's restricted API: rclone downloads only media uploaded through it, and an operator-owned OAuth client is needed for continued service. Available backends also depend on the installed rclone version. Saving a profile validates its shape, not end-to-end provider connectivity; a real task run/issuance verifies access.

Keys, tokens and provider credentials are stored under root-only `/var/lib/lightnas-storage/{certificates,protection}` directories with mode-0600 files. API responses omit private payloads and nested credentials; signing requests are public. Importing/issuing a certificate does not switch the live HTTP/TLS listener, restart the NAS, or modify an external reverse proxy. ACME renewals refresh managed certificate files approximately every twelve hours while the agent is running; deployment to a TLS listener remains an operator integration.

## Thumbnail handling and attribution

App logos come from trusted catalog image hosts or the [selfh.st icon collection](https://github.com/selfhst/icons), maintained by selfh.st under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Logos remain their respective owners' marks. Images are cached without modifying them. The appliance fetches them on the server, so the browser's restrictive same-origin image CSP remains in place and client browsers do not contact icon hosts. Unsupported hosts, private-network redirects, oversized content and active SVG/HTML content are rejected. Internet access is required for an uncached logo; failures use an initials fallback without moving the card. Cached logos remain available offline.

## Verification limits

Tests execute approved-job, scheduler, rendering and validation paths, use real OpenSSL for certificate/CSR generation, and mock ZFS, SSH, rclone, DNS/provider and privileged filesystem operations. No live pool mutation, cloud transfer, remote receive, DNS challenge, full installer execution or visual browser regression has been verified in this environment. The Chromium download failed, so DOM/rendering checks do not substitute for visual desktop/mobile checks on an appliance.
