# LightNAS migration and commercial-policy specification (draft)

Status: engineering specification; NOT a released importer, payment processor, or legally approved agreement.

## Source-specific migration workflows

All flows follow: Connect locally or via administrator-approved credentials → read-only discovery → inventory → compatibility mapping → source backup → destination space check → dry-run → approval → transfer → verification → optional cutover. Never change source configuration during discovery. Credentials must not enter application logs or migration report files. Prefer credential scopes with read-only privileges and short-lived secrets; support certificates and TLS verification.

| Source | VMs | Containers/apps | Storage | Networking | Configuration |
| --- | --- | --- | --- | --- | --- |
| VMware vCenter/ESXi | VMDK/OVF inventory and conversion review | Only supported guest formats, not arbitrary container conversion | VMFS/NFS/vSAN references mapped to a LightNAS destination; no direct vSAN import | vSwitch/port group/VLAN and NIC mapping, preserve MAC only where safe | Boot firmware, CPU, guest tools, snapshots, permissions reviewed |
| Proxmox VE | QEMU disk/config inventory, vzdump restore when compatible | LXC rootfs/config, UID mapping and privileged status review | Directory, LVM, ZFS, Ceph, backups mapped; never assume equal semantics | vmbr, VLAN, firewall, NICs and DHCP mapped | Boot order, disks, hooks, passthrough devices reviewed |
| TrueNAS SCALE/CORE | Supported SCALE VMs; CORE bhyve conversions require assessment | SCALE app manifests, CORE jail conversions are NOT transparent | Datasets, ZFS snapshots, SMB/NFS shares and ACL ownership mapping | Interface, bridge, VLAN and routes reviewed | Accounts, groups, SMB identity, scheduled tasks validated |
| Red Hat/KVM | libvirt XML, QCOW2/raw, UEFI/NVRAM considerations | Podman/OCI definitions where portable, services are NOT automatically containers | LVM/XFS/ext4 and storage pool mapping | NetworkManager/libvirt bridges, bonds, VLANs and firewalls reviewed | SELinux labels, identity, systemd units, subscriptions not transferable wholesale |

Show blockers individually and never promise full parity where platform features are incompatible. For sensitive workload data, migration logs must redact paths that contain credentials, tokens, personal data and healthcare information. No automatic destructive target formatting, snapshot deletion, source shutdown or DNS cutover.

## Privacy: no tracking pixels

LightNAS application, installer, licensing pages, and checkout must not load third-party tracking pixels, advertising tags, analytics beacons, or fingerprinting scripts. No hidden telemetry or advertising IDs. Only essential transactional requests to a selected processor, clearly explained in the privacy notice, may be used. Block outbound marketing scripts in Content Security Policy; audit transitive checkout integrations and processor embeds because an external processor may maintain its own legally required fraud/security logging. Security and operational logs remain local by default; users control optional diagnostic sharing.

## Payment-age checks

Use an **18+ purchaser confirmation** during checkout and route purchases subject to stricter age or capacity laws to the appropriate verification workflow. The confirmation alone does not establish legal adulthood, and age-verification obligations vary by jurisdiction. Prefer a payment processor's legally appropriate age/identity checks if actually required; do not collect birth date or identity document images by default. Do not store unnecessary sensitive identity documents, and never represent a checked box as verified identity. Do not expose paid license capabilities until processor-confirmed settlement/authorization and signed license receipt validation.

## Commercial tiers and billing terms — drafting checklist

- Community: state the licensed noncommercial/evaluation scope actually granted by the current LICENSE. Do not mislabel it open source. Identify any future community license change separately.
- Pro and Enterprise: describe exact included NAS features, seat/node limits, support SLA if offered, renewal frequency, currency, taxes, billing period, and trial terms in the purchase order. No invented prices or commitments.
- Explicitly disclose auto-renewal, reminder/cancellation methods, effective cancellation date, recurring authorization, refund policy, price changes and any prorations before checkout. Do not use prechecked consent.
- Accept Terms of Sale and EULA separately with clear version/date, link, timestamp and purchaser's confirmed action. Store only audit essentials; do not store raw payment card data. Merchant of record and regional consumer law need confirmation.
- If a user does not consent to an optional commercial feature, do not block access to features already licensed.
- Have qualified legal counsel review consumer protection, export, privacy, warranty disclaimers, limitation of liability, healthcare/regulated use, data processing, and governing-law clauses before publication.

## EULA requirements

Describe license grant and permitted use by tier; ownership and third-party components; security and update responsibility; source and destination data handling; migration risks and customer backup obligations; warranty/service disclaimers subject to mandatory law; support and liability terms; termination effects and export of user data; and contact details. **Existing LICENSE controls until formally replaced**. Drafts do not constitute an executed agreement.

## Delivery gates

1. Source inventory adapters tested with read-only fixtures and failure cases.
2. Schema mapping reviewed for networks (including actual DHCP/DNS), boot firmware, disks, snapshots, ACLs and guest identities.
3. Capacity planning, backups, checksums and rollback instructions validated.
4. Pilot migrations tested for each platform on disposable guests.
5. No-tracking audit performed on own pages and external payment checkout.
6. Age/payment/terms/EULA flows integrated only after processor choice and counsel review.
