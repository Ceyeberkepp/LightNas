import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeDockerPlatform} from '../src/native-docker-platform.mjs';

test('all full LightNAS host architecture targets select only native Docker manifest platforms',()=>{
 for(const [arch,expected] of Object.entries({
  amd64:'linux/amd64',i386:'linux/386',arm64:'linux/arm64',
  armhf:'linux/arm/v7',armel:'linux/arm/v5',riscv64:'linux/riscv64'
 })) assert.equal(nativeDockerPlatform(arch),expected,arch);
});

test('invalid cross-architecture platform preferences fail closed',()=>{
 for(const arch of ['',null,'x86_64','qemu-amd64','armv8','unknown','linux/amd64'])
  assert.throws(()=>nativeDockerPlatform(arch),/No native OCI platform mapping/);
});

test('Docker App Store pull and run both require the detected native host platform',()=>{
 const runtime=readFileSync(new URL('../src/runtimes-next.mjs',import.meta.url),'utf8');
 assert.match(runtime,/command\('dpkg', \['--print-architecture'\], 5000\)/);
 assert.match(runtime,/nativeDockerPlatform\(result\.output\.trim\(\)\)/);
 assert.match(runtime,/runDocker\(\['pull', '--platform', platform, image\], 600000\)/);
 assert.match(runtime,/const nativePlatform = await hostNativeDockerPlatform\(\)/);
 assert.match(runtime,/await pullDockerImage\(app\.image, nativePlatform\)/);
 assert.match(runtime,/const args = \['run', '--platform', nativePlatform, '-d'/);
 assert.doesNotMatch(runtime,/runDocker\(\['pull', image\]/);
});
