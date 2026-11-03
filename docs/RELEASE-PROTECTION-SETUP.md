# LightNAS main and release-tag protection — owner action required

**Current verified state (2026-11-02):** `main` is unprotected (`protected: false`) and the repository has no rulesets (`[]`). The GitHub integration available to this engineering workflow cannot administer branch protection. **This document does not activate protection.**

## Protect `main`

Open **Repository → Settings → Rules → Rulesets → New branch ruleset** (requires GitHub repo administration access). Name it `LightNAS main: review and exact-head CI`; set **Enforcement: Active** and target `main`.

- Require pull requests; require at least one **independent** approving review, dismiss stale reviews on new commits, require review of the most recent push, and resolve review conversations.
- Require branch up-to-date with `main` before merge (strict status check policy).
- Require these exact check names to succeed **on the PR's actual head SHA**:
  - `release-qualification`
  - `qualification (22)`
  - `qualification (24)`
  - `dependency-audit`
  - `native-runtime (amd64, linux/amd64, node:22-bookworm-slim)`
  - `native-runtime (arm64, linux/arm64, node:22-bookworm-slim)`
  - `native-runtime (armhf, linux/arm/v7, node:22-bookworm-slim)`
  - `native-runtime (riscv64, linux/riscv64, debian:sid-slim)`
  - `full-i386`
  - `validate` (Build LightNAS ISO; always emitted for PRs)
- Block force pushes and branch deletion. Allow **no routine administrative bypass**. Keep direct pushes to `main` disabled.

`release-qualification` is additional fail-closed orchestration, **not** a substitute for the repository ruleset. It polls the exact PR head SHA until every listed job is fully completed and successful; skipped or pending i386 is **not** accepted. The ruleset must enforce the job; workflows alone do not stop a privileged or direct merge.

## Protect `v*` release tags

Create a separate **active tag ruleset** targeting `v*`. Restrict tag creation, movement and deletion to explicitly designated release approvers (the repository owner must designate their IDs/roles). Require verified signatures and a separate release approval process. Never grant routine admin bypass. The `Production release evidence gate` workflow also checks `config/production-readiness.json`, but runs after a tag is pushed; it **cannot alone prevent initial unauthorized tag creation**.

Do not publish a production `v*` tag while any readiness gate is blocked or while independent operational sign-off is absent.

## Mandatory real enforcement test (do not skip)

1. Create a disposable branch and PR against `main` with a deliberately failing required check; verify the **GitHub merge control is disabled** even for an administrator.
2. Re-run that PR with `full-i386` still queued/in progress; verify the merge control remains disabled.
3. Test independent reviewer and updated-branch requirements.
4. Test a disposable nonrelease tag in an isolated test repository with an equivalent tag ruleset to verify only designated release approvers can create a matching tag. **Do not test by attempting a real production release tag.**
5. Record ruleset IDs/JSON, UI evidence, blocked merge result, reviewer, timestamps and exact head SHA in issues #424 and #438. Only then close those issues.

No claim of enforceable protection is valid solely from passing CI. GitHub's actual branch/tag rulesets and a demonstrated blocked merge are the acceptance criteria.
