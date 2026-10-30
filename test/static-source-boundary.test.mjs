import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveStaticAsset } from '../src/static-asset-boundary.mjs';

test('browser assets are limited to ordinary files inside approved static root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lightnas-static-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const publicRoot = join(root, 'public');
  await mkdir(join(publicRoot, 'assets'), { recursive: true });
  await writeFile(join(publicRoot, 'app.js'), 'browser code');
  await writeFile(join(publicRoot, 'assets', 'style.css'), 'css');
  await writeFile(join(publicRoot, 'app.js.map'), 'source map');
  await writeFile(join(publicRoot, '.env'), 'sensitive config');
  await mkdir(join(publicRoot, '.git'));
  await writeFile(join(publicRoot, '.git', 'config'), 'git metadata');
  await writeFile(join(root, 'server.mjs'), 'backend source');
  await symlink(join(root, 'server.mjs'), join(publicRoot, 'leak.js'));
  await symlink(join(publicRoot, 'app.js'), join(publicRoot, 'valid.js'));

  assert.equal(await readFile(await resolveStaticAsset(publicRoot, 'app.js'), 'utf8'), 'browser code');
  assert.ok(await resolveStaticAsset(publicRoot, 'assets/style.css'));
  assert.ok(await resolveStaticAsset(publicRoot, 'valid.js'));
  for (const requested of [
    '.git/config', '.env', 'app.js.map', 'leak.js', '../server.mjs',
    'assets/../../server.mjs', 'assets//style.css', 'assets/./style.css',
    '/etc/passwd', 'assets\\\\style.css', 'missing.js', '', '.', 'assets'
  ]) {
    assert.equal(await resolveStaticAsset(publicRoot, requested), null, requested);
  }
});

test('LightNAS HTTP static handler enforces the canonical browser asset boundary', () => {
  const source = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{ resolveStaticAsset \} from '\.\/static-asset-boundary\.mjs'/);
  assert.match(source, /const path = await resolveStaticAsset\(base, requested\)/);
  assert.match(source, /if \(!path\) return send\(res, 404, 'Not found'\)/);
  assert.doesNotMatch(source, /const path = resolve\(base, safePath\)/);
});
