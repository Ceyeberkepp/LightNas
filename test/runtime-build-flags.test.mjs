import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const recipe = await readFile(new URL('../scripts/build-node-runtime.sh', import.meta.url), 'utf8');
const flagsBlock = recipe.match(/if \[\[ "\$\{architecture\}" == i386 \]\]; then\n  export CFLAGS=[\s\S]*?\nfi/)?.[0];

test('i386 source recipe applies SSE2 to both C and C++ while preserving caller flags', async () => {
  assert.ok(flagsBlock);
  const result = spawnSync('bash', ['-c', `${flagsBlock}\nprintf '%s\\n%s\\n' "$CFLAGS" "$CXXFLAGS"`], {
    env: { ...process.env, architecture: 'i386', CFLAGS: '-O2 -mno-sse2', CXXFLAGS: '-g -mno-sse2' }, encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const [cflags, cxxflags] = result.stdout.trim().split('\n');
  assert.equal(cflags, '-O2 -mno-sse2 -msse2');
  assert.equal(cxxflags, '-g -mno-sse2 -msse2');
  // Exercise the same intrinsic family that failed in bundled zlib, rather
  // than only matching recipe text. Compilation does not execute native code.
  const dir = await mkdtemp(join(tmpdir(), 'lightnas-sse2-'));
  try {
    const source = join(dir, 'probe.c');
    await writeFile(source, '#include <emmintrin.h>\nvoid probe(short *p) { _mm_storeu_si128((__m128i*)p, _mm_set1_epi16(1)); }\n');
    const rejected = spawnSync('cc', ['-mno-sse2', '-c', source, '-o', join(dir, 'bad.o')], { encoding: 'utf8' });
    assert.notEqual(rejected.status, 0);
    const compiled = spawnSync('cc', [...cflags.split(' '), '-c', source, '-o', join(dir, 'good.o')], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('other architectures do not receive x86 compiler flags', () => {
  const result = spawnSync('bash', ['-c', `${flagsBlock}\nprintf '%s\\n%s\\n' "$CFLAGS" "$CXXFLAGS"`], {
    env: { ...process.env, architecture: 'riscv64', CFLAGS: '-O2', CXXFLAGS: '-g' }, encoding: 'utf8'
  });
  assert.equal(result.status, 0); assert.equal(result.stdout, '-O2\n-g\n');
});
