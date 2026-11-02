import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('all six target architecture families retain one full native control-plane profile',()=>{
 const contract=JSON.parse(read('config/platform-support.json'));
 for(const arch of ['amd64','i386','arm64','armhf','armel','riscv64']){
  assert.equal(contract.architectures[arch]?.profile,'full',arch);
  assert.notEqual(contract.architectures[arch]?.controlPlane,'unsupported');
 }
 const installer=read('install.sh');
 const preflight=read('scripts/platform-preflight.py');
 const runtime=read('scripts/install-node-runtime.sh');
 assert.match(installer,/amd64\|arm64\|armhf\|riscv64\|i386\|armel/);
 assert.match(preflight,/'applicationProfile':'full'/);
 assert.match(runtime,/node --input-type=module -e/);
});

test('native VM provisioning selects a matching architecture and never claims TCG ready',()=>{
 const provision=read('scripts/provision-runtimes.sh');
 for(const [arch,packageName] of [
  ['amd64','qemu-system-x86'],['i386','qemu-system-x86'],
  ['arm64','qemu-system-arm'],['armhf','qemu-system-arm'],
  ['armel','qemu-system-arm'],['riscv64','qemu-system-misc']
 ]){
  assert.match(provision,new RegExp(arch+'\\).*vm_package='+packageName));
 }
 assert.match(provision,/acceleration=unavailable/);
 assert.match(provision,/runuser -u lightnas -- test -r \/dev\/kvm/);
 assert.match(provision,/set_flag LIGHTNAS_VM_ENABLED 0/);
 assert.doesNotMatch(provision,/acceleration=tcg/);
 assert.doesNotMatch(provision,/QEMU\/libvirt TCG ready/);
 assert.doesNotMatch(provision,/automatic x86 VM provisioning currently supports x86_64/);
});

test('VM runtime inventory and create API fail closed without usable native KVM',()=>{
 const runtime=read('src/runtimes-next.mjs');
 assert.match(runtime,/runtime\.virtualization\.acceleration = 'unavailable'/);
 assert.match(runtime,/runtime\.virtualization\.enabled = false/);
 assert.match(runtime,/const virtType = 'kvm'/);
 assert.match(runtime,/virtualization\.acceleration !== 'kvm'/);
 assert.match(runtime,/hardware acceleration|KVM virtualization/);
 assert.doesNotMatch(runtime,/runtime\.virtualization\.acceleration = 'tcg'/);
 assert.doesNotMatch(runtime,/const virtType = virtualization\.acceleration === 'kvm' \? 'kvm' : 'qemu'/);
 assert.match(read('scripts/proxmox-lxc-install.sh'),/no CPU emulation fallback is permitted/);
});

test('legacy x86 and all supported native architectures retain full LightNAS API requirement',()=>{
 const requirements=read('docs/PLATFORM-REQUIREMENTS.md');
 assert.match(requirements,/complete LightNAS API/);
 assert.match(requirements,/architecture-native compatibility runtime/);
 assert.match(requirements,/same complete LightNAS control plane/);
 assert.doesNotMatch(requirements,/\*\*legacy\/light control-plane build\*\*/);
 assert.match(requirements,/hardware with\s+no virtualization facility/);
});
