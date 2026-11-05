# Five open release blockers

No issue below is closed by this patch. Do not mark operational acceptance
complete on the basis of mocked tests, a passing workflow, or deferred features.
All eight production-readiness gates remain blocked.

## #424 and #438: enforceable repository controls

`config/repository-rules/main.json` is an API-format proposal for an active
main ruleset with no bypass actors, stale-approval dismissal, independent
last-push approval, resolved review threads, deletion/force-push protection,
strict up-to-date checks, and the complete required job list including
`full-i386`, `release-qualification`, and `repository-protection-audit`.
The GitHub Actions integration ID 15368 was verified from actual main check
runs, rather than inferred from a check's display name.

`config/repository-rules/release-hold.json` prevents creation, replacement and
deletion of v* tags for everyone. It is a release hold, not an approver workflow.
Changing that policy for a release requires separate reviewed authorization;
no approver account has been guessed or granted a bypass.

These JSON files do not activate GitHub settings. The available GitHub
connection has no administration write capability. An administrator must
activate and verify these rules in GitHub. The read-only audit intentionally
fails while controls are absent or unverifiable. The production release
workflow now also checks the live controls.

After activation, use an isolated disposable PR with no main changes to verify
GitHub rejects a merge while i386 is pending and independently rejects a merge
without a current independent approval. Inspect actual mergeability and policy
responses; local evaluator tests do not replace this live negative test. Never
merge a deliberately failing test PR as an attempted policy test.

Read-only audit (token requires metadata/check-read access):

```sh
GITHUB_REPOSITORY=Ceyeberkepp/LightNas node scripts/repository-protection.mjs
```

Supply `GITHUB_TOKEN` through the environment, never command arguments or logs.

## #437: ZFS deletion identity

Normal production retention preserves old recovery points and reports
`atomic-identity-pruning-unavailable`. A name/GUID check followed by name-based
destroy cannot prove atomic identity safety against an external privileged ZFS
writer. Neither a process-local lock, a hold, nor a rename establishes that
proof. No atomic deletion implementation is claimed here.

A deterministic test now actually replaces multiple candidate identities after
the final identity observation and verifies that fresh-adapter retries retain
all replacement snapshots. This tests the safe deferred production path, not
working automatic pruning or real reboot recovery. Storage/security review and
a supported atomic primitive or rigorously enforced ownership model remain
required before enabling destructive pruning. Capacity must be monitored while
old snapshots accumulate.

## #447: guest migration

The installer preserves existing guest configs and does not stop/rewrite them.
The inventory helper is read-only; it is not an executable migration protocol.
An explicit, durable per-guest migration still needs immutable approval,
original-state/config snapshots, safe quiescence, write-ahead journaling,
reboot recovery and independently checked connectivity before commit.
Automatic hard poweroff is forbidden. Isolated LXC/libvirt tests remain needed.

## #449: host network cutover

PR #453 fixes fail-open ownership detection before first-boot DHCP. Existing
physical management policy requires separate approval; the old transparent
bridge cutover is not accepted as safe. NetworkManager checkpoint tests cover
its existing recovery implementation, not a general unmanaged/networkd bridge
migration with guest dependencies. That durable protocol and isolated physical
NIC/switch, DHCP-loss and reboot/power-loss validation remain outstanding.

No production host, disk, guest or network was operated during these checks.
