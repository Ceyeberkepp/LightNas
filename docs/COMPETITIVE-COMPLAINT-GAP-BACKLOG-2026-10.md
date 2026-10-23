# Competitive complaint gap backlog — 2026-10-22

Scope: 100 synthesized pain-point categories from Proxmox VE, TrueNAS, VMware ESXi, and Red Hat. These are not statistically ranked support-ticket counts. Do not claim production readiness from source presence alone.

## Existing work — extend, do not duplicate
- Migration: public/migration-center.html; src/migration-discovery.mjs, migration-planner.mjs, migration-transfer.mjs; associated tests. Platform spec explicitly says importer is not released.
- Storage: src/storage-agent/*, public/storage-operations.*, docs/storage-operation-framework.md. Validate actual destructive-operation guards and restoration.
- Networking: src/network.mjs and scripts/lightnas-network-*; add timed connectivity rollback and interface identity tests.
- Security: docs/SECURITY-REVIEW-OAUTH-RBAC-VALIDATION-HTTPS.md; RBAC/scopes present but OIDC PKCE not verified.
- Updates: src/secure-updates.mjs; docs/NAS-IN-APP-UPDATES-AND-TIER-REPOSITORIES.md explicitly says publisher infrastructure not deployed.

## Priority backlog with acceptance criteria
### P0
1. Network transaction safety: detect physical NICs, route and bridge dependencies; dry-run and timed automatic rollback if management heartbeat disappears; preserve SSH and current session. Tests: DHCP/static, VLAN, bonds, NIC renaming, lost gateway.
2. Storage preflight/recovery: immutable disk IDs, SMART, mounted-device exclusions, complete impact preview, explicit approval, recoverable interruption states. Tests for device reorder, degraded pools, failed share validation, restore.
3. End-to-end backup and restore: scheduled jobs, off-host destination, integrity checks, encrypted backup, disaster recovery restore drills with objective success results.
4. Migration Center verification: real read-only source connectors for VMware/Proxmox/TrueNAS/Red Hat; scoped secrets, compatibility blockers, source snapshot/backup, dry-run, transfer resume, checksums, ACL/share/network mapping, destination verification; never silently claim 1:1 parity. For NAS-only product, VM inventory/export is allowed but VM runtime import is out of scope.
5. Signed update pipeline: deploy separate HTTPS immutable feed, expiry/replay-protected signatures, per-architecture manifests, staged updates, health-check rollback, no GitHub direct update dependency.
6. Auth/security: complete OIDC code+PKCE issuer/JWKS/state/nonce checks, deny-by-default RBAC route matrix, proxy trust, CSRF, input validation, SSRF defenses, rate limiting.
7. One-click diagnostics: actionable errors, redacted support bundle, preflight health, job correlation IDs, disk/network/app/share/upgrade diagnostics.

### P1
8. ZFS/Btrfs expansion compatibility and plain-language capacity warnings; never promise unsupported vdev changes.
9. SMB/NFS ACL visual simulator and effective-permission tester for Windows/Linux.
10. App install/upgrade rollback with dependency and data compatibility checks.
11. Hardware compatibility matrix and real BIOS/UEFI installer testing, including old x86, ARM and RISC-V targets with explicit supported capabilities.
12. Clear license entitlements and offline grace handling without telemetry or tracking pixels.

## Release gate
For each item: implementation linked, automated tests, failure injection, security review, installer/upgrade regression, user-facing documentation, real-device validation where applicable. Mark as planned/in progress/verified only with evidence. Keep NAS-only product scope; no hypervisor edition reintroduction.
