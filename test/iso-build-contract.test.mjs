import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('ISO builder uses supported compression and validates installer payload', async () => {
  const build = await readFile(new URL('../iso/build.sh', import.meta.url), 'utf8');
  assert.match(build, /--compression xz/);
  assert.doesNotMatch(build, /--compression zstd/);
  assert.match(build, /--debian-installer false/);
  assert.match(build, /test -s config\/includes.chroot\/opt\/lightnas\/scripts\/lightnas-native-install\.sh/);
  assert.match(build, /ERROR: native LightNAS installer missing/);
  assert.match(build, /BIOS and UEFI boot entries confirmed/);
  assert.match(build, /installer="gui"/);
  assert.match(build, /installer="text"/);
  assert.match(build, /menu label \^Install LightNAS \(Graphical\)/);
  assert.match(build, /menu label Install LightNAS \(Terminal UI\)/);
  assert.match(build, /Install LightNAS \(VGA Safe Mode\)/);
  assert.match(build, /Install LightNAS \(Serial Console\)/);
  assert.match(build, /lightnas.installer=1/);
  assert.match(build, /ZFS module confirmed inside final LightNAS filesystem/);
  assert.match(build, /LIGHTNAS_ISO_CLEAN/);
});

test('ISO partition recipe fits the documented 35 GB minimum and does not force a timezone', async () => {
  const preseed = await readFile(new URL('../iso/preseed.cfg', import.meta.url), 'utf8');
  assert.match(preseed, /16384 18432 20480 ext4/);
  assert.match(preseed, /1024 1536 2048 linux-swap/);
  assert.match(preseed, /8192 12000 1000000000 ext4/);
  assert.match(preseed, /mountpoint\{ \/var\/lib\/lightnas\/storage\/local \}/);
  assert.doesNotMatch(preseed, /time\/zone string America\/New_York/);
  assert.match(preseed, /Time zone is intentionally not preseeded/);
});

test('ISO workflow avoids doc-only rebuild noise and performs a QEMU smoke boot', async () => {
  const workflow = await readFile(new URL('../.github/workflows/build-iso.yml', import.meta.url), 'utf8');
  assert.match(workflow, /concurrency:/);
  // Superseded PR validation may be cancelled, but production ISO builds
  // must remain serialized and cannot be cancelled by a newer PR.
  assert.ok(workflow.includes("cancel-in-progress: ${{ github.event_name == 'pull_request' }}"));
  // Separate push branch groups prevent a release build on main from displacing
  // an isolated repair-branch build. A literal shared group breaks that guarantee.
  assert.ok(workflow.includes("format('lightnas-iso-{0}-{1}', github.event_name, github.ref_name)"));
  assert.doesNotMatch(workflow, /group:\s*['"]?lightnas-iso-build['"]?\s*$/m);
  assert.match(workflow, /branches:\s*\[main(?:,\s*fix\/installer-light-default-progress-20261116)?\]/);
  // Allow only the currently isolated repair-branch ISO qualification trigger.
  assert.doesNotMatch(workflow, /branches:\s*\[\s*fix\//);
  assert.ok(workflow.includes("format('lightnas-iso-pr-{0}', github.event.pull_request.number)"));
  // GitHub rulesets must receive a predictable validate result for *every*
  // PR, even a documentation-only change; full ISO builds remain non-PR only.
  assert.match(workflow, /pull_request:\s*\n\s*workflow_dispatch:/);
  assert.match(workflow, /validate:\s*\n\s*if:\s*github\.event_name == 'pull_request'/);
  assert.match(workflow, /iso:\s*\n\s*if:\s*github\.event_name != 'pull_request'/);
  assert.match(workflow, /BIOS boot smoke test/);
  assert.match(workflow, /UEFI boot smoke test/);
  assert.match(workflow, /qemu-system-x86_64/);
  assert.match(workflow, /find \/usr\/share\/OVMF \/usr\/share\/qemu/);
  assert.match(workflow, /Using UEFI firmware/);
  assert.match(workflow, /-drive if=pflash,format=raw,readonly=on,file="\$OVMF_CODE"/);
  assert.doesNotMatch(workflow, /-bios \/usr\/share\/OVMF\/OVMF_CODE_4M\.fd/);
  assert.match(workflow, /sha256sum -c/);
  assert.doesNotMatch(workflow, /README\.md/);
  assert.doesNotMatch(workflow, /docs\/\*\*/);
  // The appliance ISO embeds src/public, so source changes must rebuild it.
  assert.match(workflow, /src\/\*\*/);
  assert.match(workflow, /public\/\*\*/);
  assert.match(workflow, /config\/\*\*/);
});

test('kernel module probe treats Debian + release names literally', async () => {
  const { spawnSync } = await import('node:child_process');
  const build = await readFile(new URL('../iso/build.sh', import.meta.url), 'utf8');
  const probe = build.match(/if ! awk -v path="\/\$\{candidate\}\/kernel\/fs\/" -v mod="\$\{fs\}" '([\s\S]*?)' "\$MODULE_LIST"/);
  assert.ok(probe, 'Installer ISO must use literal release paths in its module probe');
  const listing = [
    'squashfs-root/usr/lib/modules/6.12.117+deb13-amd64/kernel/fs/ext4/ext4.ko.xz',
    'squashfs-root/usr/lib/modules/6.12.117+deb13-amd64/kernel/fs/fat/fat.ko.xz',
    'squashfs-root/usr/lib/modules/6.12.117+deb13-amd64/kernel/fs/fat/vfat.ko.xz'
  ].join('\n') + '\n';
  for (const mod of ['ext4','fat','vfat']) {
    const result = spawnSync('awk', ['-v', 'path=/6.12.117+deb13-amd64/kernel/fs/', '-v', 'mod='+mod, probe[1]], {input:listing, encoding:'utf8'});
    assert.equal(result.status, 0, mod + ': ' + result.stderr);
  }
  const wrongKernel = spawnSync('awk', ['-v', 'path=/6.12.118+deb13-amd64/kernel/fs/', '-v', 'mod=ext4', probe[1]], {input:listing, encoding:'utf8'});
  assert.notEqual(wrongKernel.status, 0);
});
