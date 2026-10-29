# LightNAS interactive demo

A **separate**, safe, browser-only preview of the LightNAS NAS edition. This is for visitors to explore navigation and sample workflows, **not** for managing NAS hardware. It has its own server and URL; it does not route through `src/server.mjs`.

## Included

- Responsive LightNAS green/charcoal styling, light/dark appearance, mobile navigation and a bottom task dock.
- Example system health, CPU, memory, networking, sample storage and sample device statuses.
- Interactive file browsing and creation of session-only sample folders.
- Interactive sample app installs, backup jobs and user enable/disable in the browser only.
- Example catalog entries (not a verified support/compatibility list).
- Clearly visible demo labeling, session reset and sample-data disclosures on every page.

There are **no LightNAS API calls, system agents, actual file uploads, credentials, real installations, disk changes or hardware operations**. Browser changes are stored in `sessionStorage` and may disappear when the tab/session closes. The stand-alone HTTP server only responds to the five allowlisted static assets and `/healthz`. Mutation methods return HTTP 405.

## Local development

Requirements: Node.js 22 or newer.

```bash
git clone https://github.com/Ceyeberkepp/LightNas.git
cd LightNas
node demo/server.mjs
# Open http://127.0.0.1:3081
node --test demo/demo.test.mjs
```

This demo does not require root access, NAS installation, a ZFS pool, Docker, or a physical disk.

## Isolated Docker deployment

From the repository root:

```bash
docker compose -f demo/compose.yaml up -d --build
curl -fsS http://127.0.0.1:3081/healthz
```

The published port is **loopback-only** on the Docker host. The image runs as an unprivileged Node user with a read-only filesystem and **no mounts for the NAS's data, disks, Docker socket, or host network**. Run the demo on a separate VM or isolated host for an additional layer of protection.

To stop it:

```bash
docker compose -f demo/compose.yaml down
```

## Publish behind HTTPS

Choose a domain you control, such as `demo.your-domain.example`, and put a reverse proxy / Cloudflare Tunnel in front of `http://127.0.0.1:3081`. For example, with Caddy on the **same demo host**:

```caddyfile
demo.your-domain.example {
    reverse_proxy 127.0.0.1:3081
}
```

Replace the example domain with your own and configure DNS/TLS before announcing it publicly. Do not point the public demo URL to your actual NAS management service or to port 3080. Never mount the real LightNAS data directory into this container.

For Cloudflare Tunnel, configure a **Public Hostname** with service URL `http://127.0.0.1:3081` (when cloudflared is on the same host) or use the demo container's private service address if the tunnel runs inside the same isolated Docker network. Do not use the production LightNAS origin.

## QA checklist

1. `GET /` displays the "LIGHTNAS DEMO" banner.
2. Navigate every section on desktop and mobile; task dock stays within the workspace and does not overlap the sidebar.
3. Add a demo folder; create a demo user; disable and re-enable that user.
4. Install a sample app; run a backup; confirm the sample tasks complete; reset the session.
5. Confirm requests to `/api/*`, `/src/server.mjs`, and `/data/state.json` return HTTP 404.
6. Confirm POST/PUT/PATCH/DELETE requests return HTTP 405.
7. Run `node --test demo/demo.test.mjs` to test route isolation and security headers.
8. Confirm the deployed demo has no host storage mounts, device mapping, privileged mode, host network, or Docker socket access.

## Scope and important boundary

The sample dashboard is a preview, not a genuine connected LightNAS instance. Actual performance, app deployment compatibility, disk provisioning, network changes, authentication and file transfers require a separate **private test VM** with expendable virtual disks and should not be enabled on a publicly accessible demonstration website.
