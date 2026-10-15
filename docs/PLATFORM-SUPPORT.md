# LightNAS Platform Support Matrix

LightNAS distinguishes **validated support** from engineering targets. A target
is not advertised as supported until an install/boot qualification exists and
passes in CI or documented physical-hardware validation.

| Architecture | Status | Base control plane | Installer claim |
| --- | --- | --- | --- |
| amd64 / x86_64 | Validated | Node.js 22 | Supported |
| arm64 / aarch64 | Target | Node.js 22 | Not yet release-qualified |
| riscv64 | Target | Pending runtime/build validation | Not yet release-qualified |
| i386 / i686 | Target | Full application; native Node source-build target | Not yet release-qualified |
| armhf / 32-bit ARM | Target | Full application; Node 22 ARMv7 binary | Not yet release-qualified |

## Rules

- Installers record the detected architecture.
- Every architecture uses the complete application. No reduced-feature compatibility profile is installed.
- Native installers probe the runtime before continuing; an installer path does not constitute hardware qualification.
- Application and system-container catalogs normalize architecture names.
- Incompatible system-container images are hidden unless emulation is
  explicitly enabled.
- Image compatibility is rechecked on pull/install, not only in the browser.
- Checksums remain tied to the selected image/version.
- amd64 release qualification includes a 2 GiB RAM / 35 GiB system-disk boot
  smoke test.
- ARM64, RISC-V, and 32-bit x86 support remain targets until equivalent
  qualification jobs are added and passing.

## Resource qualification

The base appliance is engineered around a 2 GiB RAM / 35 GiB system-disk
minimum. The service units set memory budgets for the always-on control plane,
logs are bounded, uploads stream to disk, and CI boots the installer with the
minimum RAM/disk envelope. Optional workloads still have their own hardware
requirements.

## Full-feature compatibility work

The installer uses distribution Node >=22 packages where available, NodeSource
on amd64/arm64, the upstream Node 22 ARMv7 archive on armhf, and a native Node
22 source-build recipe when i386/ARMv6/RISC-V packages are missing. Downloads
are checked against upstream SHA-256 manifests. Every path must execute the
runtime crypto/filesystem/fetch probe; none substitutes a smaller application.
Source compilation can take hours and needs build disk/RAM beyond the base
appliance envelope. Its presence is an engineering path, not a successful
hardware qualification. The runtime remains the full Node application.

The platform workflow executes architecture-specific runtime/application tests
under instruction emulation for ARM and RISC-V, and attempts a full i386 build.
These jobs must pass before upgrading any target's support status. Container
emulation tests do not validate old CPU instruction baselines, boot firmware,
storage drivers or working kernels. Early-2000s machines require CPU-specific
boot testing. A build cannot add instructions or hardware virtualization that
a processor lacks. No universal year-2000 compatibility claim is made.

## Kubernetes

Kubernetes is integrated through K3s, with server/agent setup, service controls,
node/pod/service inventory and deployment scaling/restart. It uses the existing
administrator preview/approval flow and interface styles. The installer can
include setup using `LIGHTNAS_KUBERNETES_MODE=server` or `agent`; agent setup also
requires `LIGHTNAS_KUBERNETES_SERVER` and `LIGHTNAS_KUBERNETES_TOKEN` (secure K10
format). Tokens are stored in root-private files, never command arguments.
Alternatively, setup is available in the Kubernetes page after installation.

The checked-in release manifest pins version, architecture, URL and SHA-256.
Only amd64, arm64 and armhf have bundled release binaries. RISC-V, i386 and
ARMv6 remain full-feature targets requiring compatible K3s/runtime/image builds;
that work is unresolved. They are not advertised as completed Kubernetes
platforms. Existing installations are not overwritten. Cluster setup preserves
firewall policy and rejects overlapping host/pod/service networks.

A combined NAS/Kubernetes server requires at least 4 GiB total RAM and two
cores; an agent requires 3 GiB. Actual workloads may require more. All targets
keep the same feature set; these are workload prerequisites.

Upstream references: [Node platform/toolchain requirements](https://github.com/nodejs/node/blob/v22.x/BUILDING.md),
[unofficial build limitations](https://github.com/nodejs/unofficial-builds),
[K3s requirements](https://docs.k3s.io/installation/requirements).

## Oldest x86 CPUs: unresolved runtime blocker

The full application must also run on early-2000s CPUs; preserving its source
alone does not satisfy that requirement. Node 22 V8 explicitly checks
`cpu.has_sse2()` in its IA32 startup code. Native source compilation cannot
remove that engine requirement. CPUs without SSE2 therefore need a different
full-application runtime strategy (an engine/backend port or tested instruction
emulation). Neither is implemented in this draft. Do not treat the i386 build
job as proof of compatibility with those processors. Year-of-manufacture alone
is not a CPU instruction baseline.

Reference: [Node 22 IA32 CPU feature checks](https://github.com/nodejs/node/blob/v22.x/deps/v8/src/codegen/ia32/assembler-ia32.cc).
