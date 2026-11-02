// A native OCI image must match the appliance ISA and ABI variant.
// Don't permit a binfmt_misc/QEMU handler to make an incompatible image
// appear installable. Missing native manifest variants fail at Docker pull.
export function nativeDockerPlatform(arch) {
  const platforms = Object.freeze({
    amd64: 'linux/amd64',
    i386: 'linux/386',
    arm64: 'linux/arm64',
    armhf: 'linux/arm/v7',
    armel: 'linux/arm/v5',
    riscv64: 'linux/riscv64'
  });
  const platform = platforms[String(arch || '').trim()];
  if (!platform) throw new Error('No native OCI platform mapping for host architecture ' + String(arch));
  return platform;
}
