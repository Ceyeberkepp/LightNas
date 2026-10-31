import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const installer = read('install.sh');
const migration = read('scripts/enable-local-https.sh');
const docs = read('docs/INSTALLATION.md');

test('operator HTTPS migration script has valid bash syntax and root-only operation', () => {
  const file = fileURLToPath(new URL('../scripts/enable-local-https.sh', import.meta.url));
  const check = spawnSync('bash', ['-n', file], {encoding:'utf8'});
  assert.equal(check.status, 0, check.stderr);
  assert.match(migration, /\[\[ "\$\{EUID\}" -eq 0 \]\]/);
  assert.match(migration, /systemctl is-active --quiet "\$unit"/);
});

test('certificate is unique to the appliance, has IP subject alternatives and is not silently overwritten', () => {
  assert.match(migration, /hostname', '-I'/);
  assert.match(migration, /san="DNS:localhost,IP:127\.0\.0\.1"/);
  assert.match(migration, /for ip in "\$\{current_ips\[@\]\}"; do san\+=",IP:\$ip"; done/);
  assert.match(migration, /openssl req -x509 -newkey rsa:3072/);
  assert.match(migration, /-addext "subjectAltName=\$san"/);
  assert.match(migration, /openssl x509 -in "\$cert" -noout -checkip "\$ip"/);
  assert.match(migration, /Incomplete existing TLS certificate\/key pair/);
  assert.match(migration, /install -o root -g lightnas -m 0640 "\$tmp\/nas\.key" "\$key"/);
  assert.match(migration, /runuser -u lightnas -- test -r "\$key"/);
});

test('transition fails closed and restores the previous management listener if HTTPS is unhealthy', () => {
  assert.match(migration, /http:\/\/127\.0\.0\.1:3080\/api\/status/);
  assert.match(migration, /https:\/\/127\.0\.0\.1:3080\/api\/status/);
  assert.match(migration, /--cacert "\$cert"/);
  assert.match(migration, /rollback\(\)/);
  assert.match(migration, /systemctl daemon-reload \|\| true/);
  assert.match(migration, /systemctl restart "\$unit" \|\| true/);
  assert.match(migration, /if \[\[ "\$healthy" -ne 1 \]\]/);
  assert.doesNotMatch(migration, /systemctl restart (?:docker|libvirtd|lightnas-host-agent)/);
  assert.doesNotMatch(migration, /\b(?:mkfs|wipefs|zpool create|pvcreate|parted -s)\b/);
});

test('upgrades preserve deliberately enabled HTTPS and installation guide includes migration and trust', () => {
  const marker = '# Managed by LightNAS local HTTPS migration; do not edit manually.';
  assert.ok(installer.includes(marker));
  assert.ok(migration.includes(marker));
  assert.match(installer, /LIGHTNAS_LOCAL_TLS=1/);
  assert.match(docs, /https:\/\/<LIGHTNAS-IP>:3080/);
  assert.match(docs, /sudo bash scripts\/enable-local-https\.sh/);
  assert.match(docs, /self-signed/i);
  assert.match(docs, /Existing customer tunnels and proxies/);
});

test('failed certificate issuance deletes temporary private key material', t => {
  // Execute the actual issuance subshell with fake OpenSSL, not the privileged migration.
  const start = migration.indexOf('  (\n    tmp="$(mktemp -d "$cert_dir/.issue.XXXXXX")"');
  const end = migration.indexOf('\n  )\nfi', start);
  assert.ok(start >= 0 && end > start, 'locate actual issuance subshell');
  const issuance = migration.slice(start, end + '\n  )'.length);
  const fixture = mkdtempSync(join(tmpdir(), 'lightnas-tls-failure-'));
  t.after(() => rmSync(fixture, {recursive: true, force: true}));
  const certDir = join(fixture, 'tls');
  const binDir = join(fixture, 'bin');
  mkdirSync(certDir);
  mkdirSync(binDir);
  const fakeOpenssl = join(binDir, 'openssl');
  writeFileSync(fakeOpenssl, [
    '#!/usr/bin/env bash',
    'while [[ "$#" -gt 0 ]]; do',
    '  if [[ "$1" == "-keyout" ]]; then',
    '    shift',
    '    printf "incomplete private key" > "$1"',
    '    exit 29',
    '  fi',
    '  shift',
    'done',
    'exit 30',
  ].join('\n') + '\n', {mode: 0o755});
  const shell = [
    'set -Eeuo pipefail',
    'cert_dir="$1"',
    'key="$cert_dir/nas.key"',
    'cert="$cert_dir/nas.crt"',
    'current_ips=(192.0.2.15)',
    issuance,
  ].join('\n');
  const run = spawnSync('bash', ['-c', shell, 'bash', certDir], {
    encoding: 'utf8',
    env: {...process.env, PATH: binDir + ':' + process.env.PATH},
  });
  assert.equal(run.status, 29, run.stderr);
  assert.deepEqual(readdirSync(certDir), [], 'no temporary directory or private key remains');
  assert.equal(existsSync(join(certDir, 'nas.key')), false);
  assert.equal(existsSync(join(certDir, 'nas.crt')), false);
  assert.doesNotMatch(migration, /trap ['"]rm -rf[^]*?RETURN/);
});
