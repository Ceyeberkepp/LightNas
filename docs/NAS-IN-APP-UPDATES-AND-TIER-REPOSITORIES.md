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

## HTTPS-only deployment

The application currently runs a loopback-capable HTTP service on port 3080.
To avoid exposing plaintext admin sessions, deploy a Caddy HTTPS reverse proxy
using `config/Caddyfile.https.example`, then set `NAS_HOST=127.0.0.1` in
the web service and close external port 3080. Do **not** simply change the URL
to https:// on the existing HTTP socket: TLS must terminate at Caddy (or another
properly configured web server). Existing installations require a controlled
migration so remote administrators are not locked out.

- Use publicly trusted certificates for public DNS hostnames.
- For LAN-only appliances use a locally trusted CA with device enrollment;
  do not tell users to bypass certificate warnings.
- Ensure the proxy overwrites untrusted forwarding headers and the backend
  is reachable only on loopback or a protected Unix socket.
- Only publish the admin interface to trusted networks; use firewall rules.
- Change the installer before claiming HTTPS-by-default for new installs.
- Never permit HTTP fallback for update manifests, packages or license APIs.
- The secure signed-manifest checker requires
  `LIGHTNAS_UPDATE_MANIFEST_URL=https://...` and
  `LIGHTNAS_UPDATE_PUBLIC_KEY_FILE=/etc/lightnas/update-signing-public.pem`.
  These values are provisioning settings, not proof that an update service exists.
- The signed manifest payload uses exact `JSON.stringify(payload)` bytes for
  Ed25519 signing. The publisher must sign that same deterministic encoding.
  It must carry `product: lightnas-nas`, `tier`, `channel`, `arch`,
  `platform`, `version`, and `expiresAt`.

The initial implementation verifies HTTPS metadata and reports availability,
but explicitly **does not enable installation**. Before activating the Install
button, implement verified artifact staging, hash checks, anti-rollback,
transactional installation, watchdog health checks, and recovery testing.
