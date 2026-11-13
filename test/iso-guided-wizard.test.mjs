import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const installer = await readFile(new URL('../scripts/lightnas-native-install.sh', import.meta.url), 'utf8');
const wizard = await readFile(new URL('../scripts/lightnas-guided-installer.py', import.meta.url), 'utf8');
const live = await readFile(new URL('../scripts/lightnas-native-wizard.sh', import.meta.url), 'utf8');
const build = await readFile(new URL('../iso/build.sh', import.meta.url), 'utf8');

test('branded installer follows the approved seven-step flow', () => {
  for (const step of ['Welcome', 'Storage', 'Locale', 'Administrator', 'Network', 'Summary', 'Install']) {
    assert.ok(wizard.includes(step));
  }
  assert.match(live, /lightnas-guided-installer\.py/);
  assert.match(wizard, /ERASE:/);
  assert.match(wizard, /self\.disk = tk\.StringVar\(value=""\)/);
});

test('native installer leaves CLI login and enables HTTPS after installation', () => {
  assert.match(installer, /set-default multi-user\.target/);
  assert.match(installer, /lightnas-console-banner/);
  assert.match(installer, /https:\/\/%s:3080/);
  assert.match(installer, /LIGHTNAS_TLS_CERT_FILE=/);
  assert.match(installer, /LIGHTNAS_TLS_KEY_FILE=/);
  assert.match(installer, /LIGHTNAS_INSTALL_PASSWORD_FILE/);
  assert.match(installer, /chpasswd/);
  assert.match(installer, /lightnas-installed/);
  assert.match(build, /openssl/);
  assert.match(build, /sudo/);
  execFileSync('bash', ['-n', new URL('../scripts/lightnas-native-install.sh', import.meta.url).pathname]);
});

test('wizard Python compiles and is included in image build', () => {
  execFileSync('python3', ['-c',
    'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf8").read())',
    new URL('../scripts/lightnas-guided-installer.py', import.meta.url).pathname]);
  assert.match(build, /cp -a[\s\S]*\$\{REPO_ROOT\}\/scripts/);
});
