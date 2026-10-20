# LightNAS NAS-only release repositories and in-app updates

Status: architecture contract; **not deployed**. This does not enable remote updates.

## Package feeds
- Community: public signed NAS core and security updates.
- Premium: license-authorized optional NAS feature packages; includes Community security releases.
- Enterprise: license-authorized business packages; includes Community security releases.
- No Hypervisor packages or edition in these feeds.

Source control can remain on GitHub, but appliances fetch **only** from a separately hosted HTTPS update API and immutable package repository. The customer never runs git pull or install.sh through the UI.

## Server responsibilities
1. Publish immutable OS/application artifacts per supported architecture and stable/beta channel.
2. Sign expiry-bounded update metadata with offline root and online delegated signing keys (TUF-compatible design).
3. Provide version, minimum system requirements, hash, size, and upgrade prerequisites.
4. Authorize downloads of Premium/Enterprise artifacts through short-lived scoped tokens, without trusting a client-supplied edition.
5. Preserve access to core NAS and security updates irrespective of subscription status.

## Agent responsibilities
1. Report installed version from the local installation, even with no internet or Git checkout.
2. Report 'repository not configured' unless the publisher, trusted root keys, and supported update agent are provisioned.
3. Download only signed immutable release artifacts, verify chain/hash, reject replay/downgrades, and check architecture and free space.
4. Stage installation with a configuration backup and reversible system snapshot or recovery partition, never modifying user datasets.
5. Publish progress and reboot requirements; perform post-install health checks and bounded rollback.
6. Treat missing server/network/license status as an explicit recoverable state, not 'up to date'.
7. Never execute a source repository install.sh as a software update.

## Suggested service boundaries
- GET /v1/updates/check
- GET /v1/updates/manifest
- POST /v1/updates/download-token
- Local authorized endpoints: check, status, install, rollback
- Separate signed entitlement service for Premium/Enterprise

## Migration
Current `scripts/lightnas-host-agent.py` previously checked Git origin/main and executed install.sh when updating. As an interim safety step it now returns locally installed version and an explicit not-configured state, and refuses installation. Complete signing infrastructure, dedicated privileged install worker, UI progress and integration tests before enabling the Install button.
