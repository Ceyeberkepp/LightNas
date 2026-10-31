# LightNAS stress qualification: safe local probe and isolated workload test

LightNAS remains **pre-production** until the eight independently verified
release gates have evidence. Passing a soak test is one input to the workload
gate; it does not qualify hardware, disk recovery, backups or updates.

## 1. Stress your currently running appliance (read-only, safe default)

Run this **on the LightNAS host** after checking out a version that contains
`scripts/stress-local.mjs`. Do not run a clone of an untrusted repository as
root. The only network methods the script sends are unauthenticated **GET**
requests. It does not log in, upload, download user files, change disks,
restart services, install apps or modify the network.

```bash
cd /opt/lightnas
NODE_EXTRA_CA_CERTS=/etc/lightnas/tls/nas.crt \
  node scripts/stress-local.mjs \
    --url https://127.0.0.1:3080 \
    --seconds 45 --rps 2 --concurrency 4 \
  | tee "/tmp/lightnas-readonly-stress-$(date +%Y%m%d-%H%M%S).json"
```

`127.0.0.1` is your appliance's **own loopback IP** and is included in the
local per-appliance certificate's SAN. Alternatively, for the LAN address
owned by the same machine, use:

```bash
NODE_EXTRA_CA_CERTS=/etc/lightnas/tls/nas.crt \
  node scripts/stress-local.mjs --url https://YOUR-APPLIANCE-IP:3080 \
  --seconds 45 --rps 2 --concurrency 4
```

The script accepts only HTTPS, port **3080**, and a local/private IP or
localhost. It validates TLS with the trusted per-appliance certificate.
**Never** set `NODE_TLS_REJECT_UNAUTHORIZED=0` or use a shared wildcard
certificate merely to make this test pass. If you run it from a different
machine, explicitly obtain and trust this appliance's public certificate.

It measures p50, p95 and p99 response time, HTTP status counts, transport
errors, read-only public endpoints and unauthenticated access denial to
network/storage/files APIs. It identifies normal HTTP 429 rate limiting and
requires `Retry-After`. More than five connection errors or ten unexpected
responses terminates testing early. It never performs password guessing.

For a deliberate, higher-rate soak **only on a spare test appliance during a
maintenance window**, use:

```bash
NODE_EXTRA_CA_CERTS=/etc/lightnas/tls/nas.crt \
  node scripts/stress-local.mjs \
  --url https://127.0.0.1:3080 --seconds 300 \
  --rps 12 --concurrency 8 --ack-impact
```

Normal API rate limits will return HTTP 429 at elevated rates; those are not
application 5xx failures. Frequent HTTP 5xx, failed authorization checks,
unusually high latency, or TLS failures require root-cause investigation.
The runner refuses arbitrary public targets, redirects, and high-rate
settings without `--ack-impact`. No root privileges are needed.

## 2. Put isolated temporary instances through the full API workload

On a **separate testing machine** with Node.js 22+, an installed checkout
and normal npm dependencies:

```bash
cd /opt/lightnas
node --test --test-concurrency=1 \
  test/concurrent-live-api.test.mjs \
  test/upload-rate-budget-live.test.mjs \
  test/stress-isolated-multinstance.test.mjs
```

These tests spawn disposable Node LightNAS processes with `NAS_DATA_FILE`
pointing into fresh OS temporary directories; all test accounts and files
exist only in those directories. The new suite exercises four concurrent
instances, three users each, 336 concurrent test-file writes, 336 downloads
verified by SHA-256, per-user isolation, duplicate-upload protection, malformed
requests, and persistence after restarting the temporary process. Files are
deleted with the temporary directory after tests finish. No real
`lightnas.service`, storage pool, Docker engine, QEMU guest, or NetworkManager
is manipulated by these tests.

The test is CPU/memory-intensive and can disrupt interactive performance if
run on an active production host; use isolated/disposable test hardware. The
repository CI also runs these regressions automatically.

## 3. What this does not establish

These tests do not guarantee that iPhone Safari can select thousands of real
photos, that the application store can install 800 apps, that a physical disk
or ZFS pool survives a power cut, or that upgrades and full off-device restores
work. Those require independent real hardware and full failure-injection
testing before any production release gate may change from blocked.
