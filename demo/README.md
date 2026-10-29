# LightNAS public demo — actual NAS frontend, simulated data

**Public demo:** [https://demoln.cyverax.com/](https://demoln.cyverax.com/)

Visitors can open this address to explore the LightNAS NAS interface without installing LightNAS. The demo requires an explicit sign-in using one of the two **public demo accounts** below. The interface uses sample data and disables all host-changing operations.

## Demo accounts

| Experience | Username | Public demo password | Access |
| --- | --- | --- | --- |
| Administrator | `demo-admin` | `LightNASAdmin2026!` | View sample administration, storage, apps, backups and all demo sections |
| Regular User | `demo-user` | `LightNASUser2026!` | View overview and sample personal files; no administration access |

Select a demo role on the usual LightNAS login screen to populate the fields; then click **Sign in**. The site **never automatically signs in anonymous visitors**. Both credentials are intentionally public and grant no actual host permissions. **Do not use a real LightNAS password or any personal credentials on the demo website.**

The visitor demo now serves **the same HTML, CSS, and browser modules that run the LightNAS NAS edition** directly from `public/`. It is not a separate redesign. Only its API is replaced with clearly marked sample data, and **every host-changing POST, PUT, PATCH and DELETE request is rejected**. Only the isolated demo sign-in and sign-out endpoints accept POST. This runs on Node.js 22+ with no root privileges, disks, privileged agents, containers, Docker or existing NAS data.

## Run it natively (Debian 13 / Ubuntu)

```bash
cd /root/lightnas-demo
git pull --ff-only origin main
node --test demo/demo.test.mjs
node demo/server.mjs
```

Default address: `http://127.0.0.1:3081`. Health check:

```bash
curl http://127.0.0.1:3081/healthz
# {"status":"ok","mode":"native-frontend-demo","realFrontend":true,"simulated":true}
```

Demo sessions use one-hour, random, HttpOnly, SameSite=Strict cookies. Cookies are marked `Secure` by default and therefore require HTTPS for browser sign-in; only for temporary **local HTTP testing**, set `LIGHTNAS_DEMO_SECURE_COOKIE=0` in the service environment (do not disable Secure cookies on the public HTTPS demo). A service restart clears all demo sessions.

To make the site reachable on your LAN, set `LIGHTNAS_DEMO_HOST=0.0.0.0` only for internal testing. For public access, bind back to `127.0.0.1` and use an authenticated HTTPS reverse proxy or Cloudflare Tunnel on the same host.

## Upgrade an existing LightNASDEMO Proxmox LXC service

The previous imitation only copied `demo/` and the logo to `/opt/lightnas-demo`. **This version also requires all of `public/`**, since that directory is the actual frontend. On the **LightNASDEMO guest**, not the Proxmox host:

```bash
cd /root/lightnas-demo
git pull --ff-only origin main
node --test demo/demo.test.mjs
mkdir -p /opt/lightnas-demo/demo /opt/lightnas-demo/public
cp -a /root/lightnas-demo/demo/. /opt/lightnas-demo/demo/
cp -a /root/lightnas-demo/public/. /opt/lightnas-demo/public/
chmod -R a+rX /opt/lightnas-demo
systemctl restart lightnas-demo
systemctl status lightnas-demo --no-pager
curl -fsS http://127.0.0.1:3081/healthz
```

The existing systemd `ExecStart=/usr/bin/node /opt/lightnas-demo/demo/server.mjs` remains valid. Existing LXC-compatible systemd drop-ins remain in effect; this update does not alter Proxmox permissions.

To verify the exact frontend instead of a mock, run:

```bash
curl -fsS http://127.0.0.1:3081/ | grep -E 'workspace-pages.css|design-v2.css|app.js|_demo/native.css'
```

## What visitors see

- The **actual LightNAS sidebar, header, dashboard, Storage Manager, Files & media, App Store, Backups, networking and Admin Center presentation** from the current release.
- Sample inventory: CPU, memory, disks, storage pools, files, virtual machines, containers, applications, backup jobs and users.
- A persistent badge: **LIGHTNAS DEMO · Simulated data · Read only**.
- Direct navigation, search, appearance controls, and other client-side features from the genuine app.

This is a **read-only navigation preview**. Changes like installing apps, creating users, formatting drives, uploading files, running backups, changing passwords or modifying the network are **intentionally unavailable**. Buttons that attempt those operations will receive an HTTP 403 error; never present them as working or verified. The demonstration backend holds only hard-coded, non-sensitive fixtures and cannot connect to the NAS host.

## Security boundaries

- `src/server.mjs` is **never imported** or started by the demo; no privileged LightNAS host agent, ZFS, LXC, libvirt, Docker socket or storage is used.
- Static files are served only from the repository's `public/` tree, with symlink/path traversal checks and permitted browser asset extensions.
- The embedded sample API answers only specified `GET` endpoints with a valid demo session, except public status/branding and sign-in options. It accepts POST only at `/api/login` and `/api/logout`; every other mutating method returns 403. Anonymous access to sample inventory returns 401; regular-user sessions cannot read admin-only example APIs.
- Demo login sessions are held **only in memory** with random tokens and expire after one hour. No real LightNAS login, account database, credential storage, or password changes occur. Public sample credentials never grant access to actual NAS services.
- A restrictive CSP prevents connections to external hosts from the demo frontend.
- A different demo hostname and isolated VM/LXC are preferable to exposing an actual NAS.

## Testing

```bash
node --check demo/server.mjs
node --check demo/native-fixtures.mjs
node --test demo/demo.test.mjs
```

Tests verify actual original asset equivalence, mandatory explicit demo sign-in, admin/regular permissions, sign-out, sample API behavior, no access to real management endpoints, the demo banner, and mutation rejection.

## Optional packaging

`demo/compose.yaml` is offered only for separate environments that already use Docker. **Docker is not required or used by the native LightNAS deployment.** The primary supported demo installation above is Node.js + systemd.
