import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const installer=readFileSync(new URL('../install.sh',import.meta.url),'utf8');
const migration=readFileSync(new URL('../scripts/enable-local-https.sh',import.meta.url),'utf8');
const policyStart=installer.indexOf('# The full LightNAS management listener is HTTPS-only');
const policyEnd=installer.indexOf('TLS_SERVICE_ENV=""',policyStart);
assert.ok(policyStart>0&&policyEnd>policyStart,'locate actual installer TLS selection');

function evaluatePolicy(existing,variable){
 const body=[
  'set -Eeuo pipefail',
  'systemctl() { return 1; }',
  'SERVICE_NAME=lightnas',
  'INSTALL_DIRECTORY=/does-not-exist',
  'EXISTING_INSTALL='+String(existing),
  variable===undefined?'unset LIGHTNAS_LOCAL_TLS':'LIGHTNAS_LOCAL_TLS='+String(variable),
  installer.slice(policyStart,policyEnd),
  'printf "TLS_MODE=%s\\n" "$LIGHTNAS_LOCAL_TLS"'
 ].join('\n');
 return spawnSync('bash',['-c',body],{encoding:'utf8',timeout:5000});
}

test('all new and existing installations enforce HTTPS regardless of a cloned source directory',()=>{
 for(const existing of [0,1]){
  const run=evaluatePolicy(existing,undefined);
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stdout,/TLS_MODE=1/);
  const explicit=evaluatePolicy(existing,1);
  assert.equal(explicit.status,0,explicit.stderr);
  assert.match(explicit.stdout,/TLS_MODE=1/);
 }
 assert.doesNotMatch(installer,/LIGHTNAS_LOCAL_TLS="\$\{LIGHTNAS_LOCAL_TLS:-\$\(\[\[/);
});

test('opt-out and unknown HTTPS mode fail closed rather than silently selecting plaintext HTTP',()=>{
 for(const setting of ['0','false','invalid','2']){
  const run=evaluatePolicy(1,setting);
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/requires HTTPS/);
  assert.doesNotMatch(run.stdout,/TLS_MODE=0/);
 }
});

test('running existing HTTP instance migrates before rewriting management systemd unit',()=>{
 const migrationCall=installer.indexOf('bash "\${INSTALL_DIRECTORY}/scripts/enable-local-https.sh"');
 const newService=installer.indexOf('cat >/etc/systemd/system/\${SERVICE_NAME}.service');
 assert.ok(migrationCall>0&&newService>migrationCall);
 assert.match(installer,/systemctl is-active --quiet "\$\{SERVICE_NAME\}\.service"/);
 assert.match(installer,/if ! bash "\$\{INSTALL_DIRECTORY\}\/scripts\/enable-local-https\.sh"/);
 assert.match(installer,/installer will not replace its service settings/);
 assert.match(migration,/rollback\(\)/);
 assert.match(migration,/--cacert "\$cert"/);
});

test('fresh and upgraded certificates fail closed on incomplete keypairs and unverified IPs',()=>{
 assert.match(installer,/Incomplete LightNAS HTTPS certificate\/key pair/);
 assert.match(installer,/mktemp -d \/etc\/lightnas\/tls\/\.issue\.XXXXXX/);
 assert.match(installer,/trap 'if \[\[ "\$complete" -ne 1 \]\]/);
 assert.match(installer,/openssl x509 -in "\$\{TLS_CERT\}" -noout -checkip "\$ip"/);
 assert.match(installer,/runuser -u lightnas -- test -r "\$\{TLS_KEY\}"/);
 assert.match(installer,/Environment=LIGHTNAS_TLS_CERT_FILE/);
 assert.match(installer,/Environment=LIGHTNAS_TLS_KEY_FILE/);
});

test('one-click installer cannot report success on an untrusted or plaintext listener',()=>{
 const start=installer.indexOf('echo "[6/6] Verifying LightNAS..."');
 assert.ok(start>0);
 const final=installer.slice(start);
 assert.match(final,/systemctl is-active --quiet "\$\{SERVICE_NAME\}\.service"/);
 assert.match(final,/--cacert \/etc\/lightnas\/tls\/nas\.crt/);
 assert.match(final,/https:\/\/127\.0\.0\.1:3080\/api\/status/);
 assert.match(final,/echo "Open: https:\/\//);
 assert.doesNotMatch(final,/curl\s+-k/);
 assert.doesNotMatch(final,/echo http/);
 assert.doesNotMatch(final,/http:\/\/127\.0\.0\.1:3080/);
});

test('Bash syntax remains valid for install and migration scripts',()=>{
 for(const relative of ['install.sh','scripts/enable-local-https.sh']){
  const f=fileURLToPath(new URL('../'+relative,import.meta.url));
  const run=spawnSync('bash',['-n',f],{encoding:'utf8'});
  assert.equal(run.status,0,relative+': '+run.stderr);
 }
});
