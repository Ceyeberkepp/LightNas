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

test('EFI filesystem label is within the FAT volume label limit', () => {
  const match = installer.match(/mkfs\.vfat\s+-F32\s+-n\s+([A-Z0-9_]+)/);
  assert.ok(match, 'Expected explicit EFI FAT label');
  assert.ok(match[1].length <= 11, `FAT label too long: ${match[1]}`);
  assert.equal(match[1], 'LNAS_EFI');
});

test('hostname appears directly below Administrator username, with light/dark selector', () => {
  const adminPage = wizard.split('    def page_3(self):')[1].split('    def page_4(self):')[0];
  const networkPage = wizard.split('    def page_4(self):')[1].split('    def page_5(self):')[0];
  assert.match(adminPage, /self\.compact_entry\(frame, "Administrator username", self\.username\)[\s\S]*?self\.compact_entry\(frame, "Hostname", self\.hostname\)/);
  assert.doesNotMatch(networkPage, /self\.compact_entry\(frame, "Hostname"/);
  assert.match(wizard, /def toggle_theme\(self\):/);
  assert.match(wizard, /"light"/);
});

test('chroot filesystem mounts precede account and systemd operations', () => {
  const bind = installer.indexOf('mount --rbind "/$p" "$target/$p"');
  const account = installer.indexOf('chroot "$target" useradd');
  const service = installer.indexOf('chroot "$target" systemctl set-default');
  const boot = installer.indexOf('chroot "$target" grub-install');
  assert.ok(bind >= 0 && account > bind && service > bind && boot > bind,
            'Installer must mount /dev /proc /sys /run before chroot commands');
});

test('native installation verifies ext4/vfat kernel support before erasing the disk', () => {
  const preflight = installer.indexOf('modprobe ext4');
  const vfat = installer.indexOf('modprobe vfat');
  const destructive = installer.indexOf('sgdisk --zap-all');
  assert.ok(preflight > 0 && vfat > preflight && destructive > vfat,
    'Filesystem kernel support must be verified before partition table mutation');
});
