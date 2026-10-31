# Production release gate (AMD64 NAS first)

Status: **BLOCKED. LightNAS is pre-production.** Automated CI passing does not establish a safe customer release. Never attach production workloads or irreplaceable data to an unqualified development build.

## What this change does

A production release manifest in `config/production-readiness.json` lists eight mandatory gates, **all blocked by default**. `scripts/check-production-readiness.mjs` refuses to approve a release candidate if even one gate is missing, outdated, marked blocked, lacks a named reviewer or lacks a described HTTPS evidence reference, or if the candidate tag does not match. This is a check of **evidence metadata only**, not automatic authentication of documents or a substitute for independent engineering review.

The `production-release-gate.yml` GitHub workflow runs on v* tags or manual dispatch. It executes the complete application suite, platform contract and high/critical npm dependency audit, then checks evidence metadata. It **publishes nothing** and does not connect to or operate a production system. Its failure blocks this check but cannot technically prevent an administrator from publishing a GitHub release by some other means; require protected tags, release approval and repository rules separately.

## Eight prerequisites

1. **Installation:** Fresh AMD64 installation on disposable BIOS/UEFI test media, hardware driver and network detection, reboot, state-preserving upgrade/reinstall, successful rollback from an interrupted installation. Record actual model, firmware, OS, disk topology and timestamps.
2. **Storage safety:** Inventory identity remains consistent across device renumbering; installed/owned disks are never auto-assigned; mounted, degraded and unknown disks are never auto-initialized; attempted operations require explicit impact preview and recoverability testing.
3. **Backup/disaster recovery:** Scheduled encrypted off-host backup, verified hashes, restoration to separate disposable storage and complete data/application/configuration recovery with measured RPO/RTO. A configured backup job alone is not evidence of restoration.
4. **Networking:** Safe previews, connection preservation and timed automatic rollback for wrong gateways, VLANs, interface renames and lost management heartbeats, on physical and virtual test hosts.
5. **Updates:** Publisher-owned HTTPS immutable signed release metadata, architecture-verified artifacts, expiry/replay protections, controlled staged upgrade, health gates, rollback and reinstallation without losing user datasets. Current in-app update installation remains intentionally disabled.
6. **Security:** Least-privilege API/multi-user authorization, MFA and reset/revocation, HTTPS proxy trust, CodeQL/dependency/container image scans, independent penetration review and remediation evidence.
7. **Workloads and UX:** Real iOS Safari and desktop browsers, long conversations and AI composer, thousands of photos with retries, constrained 2 GB RAM/35 GB disk, multiple user load, power cuts/interruptions, app lifecycle and extended soak tests.
8. **Commercial release:** Production-use license, maintenance/update/incident response policy, data retention and recovery support contacts, stable release notes, support boundaries and customer installation documentation.

## Evidence requirements

Before updating any gate to `verified`, capture a named reviewer, ISO 8601 verification date no older than 90 days, HTTPS links to independently reviewed immutable test logs or reports, a meaningful summary describing outcomes, and a documented environment. Re-run on the exact candidate commit or document what remained unchanged. Include failure injection and recovery results, not only happy-path logs. Do not insert placeholder evidence to turn the CI status green.

## What still needs actual implementation

This gate **does not implement** off-host disaster recovery, signed update publication, automated network rollback, penetration testing or release packaging. The appropriate follow-on work must implement and independently validate those capabilities before marking their gates verified. Keep real appliance operations out of automated repository workflows unless they run against disposable, isolated test equipment and explicit approved test assets.

## Safety

Do not format or initialize disks, assign unknown block devices to LightNAS, import or alter a customer's storage pool, restart a production host, or cut over management networking as part of release-readiness checks. Use temporary state, isolated virtual disks, nonproduction fixtures, and real hardware explicitly set aside for testing.

## NetworkManager apply / confirm / rollback implementation

The privileged host agent now stages NetworkManager-managed route, profile,
device and uplink changes using the NetworkManager D-Bus Checkpoint API. It
snapshots the local persistent NetworkManager connection profiles before
creating a short-lived checkpoint, then applies the requested change. The
browser receives a one-time confirmation token and has **120 seconds** to
confirm successful continued management access. Otherwise, NetworkManager
owns the automatic timeout-based rollback; an explicit Cancel requests
rollback immediately. The token is required for confirm and cancel.

The root-owned `lightnas-network-recovery.service` runs before
NetworkManager during startup and before the LightNAS privileged host daemon.
If an unconfirmed change survived a restart, it attempts the checkpoint
rollback and restores saved persistent connection profiles before the network
service starts. A failed recovery blocks NetworkManager startup rather than
assuming an unsafe change is valid.

This is a real code path with isolated test coverage, **not** proof of
production readiness. Before marking the network release gate verified, test
actual hardware and network equipment with DHCP, static-IP changes, wrong
gateway, VLANs, bonds/bridges, dropped management sessions, NetworkManager
restart, abrupt power loss, browser cancellation, timed expiry and recovery.

**Known limitations to close before the gate is approved:** NetworkManager
checkpoints do not cover raw `ip route` commands or UFW firewall mutations;
these remain rejected when they could sever management access. Changes to
external or non-keyfile network configuration outside
`/etc/NetworkManager/system-connections` require their own backup and
recovery adapter. A certificate identifying an old IP address will not
automatically remain valid after switching the appliance to a new IP.
