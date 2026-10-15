#!/usr/bin/env bash
# Build the same maintained runtime when a native binary package is absent.
# Experimental architectures are qualified only after execution and application tests.
set -Eeuo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Run runtime build as root.' >&2; exit 1; }
architecture="${LIGHTNAS_ARCH:-$(dpkg --print-architecture)}"
case "${architecture}" in
  i386) node_cpu=ia32 ;;
  armel|armhf) node_cpu=arm ;;
  riscv64) node_cpu=riscv64 ;;
  *) echo "No source-build recipe for ${architecture}." >&2; exit 1 ;;
esac
apt-get -o DPkg::Lock::Timeout=300 install -y --no-install-recommends build-essential python3 ca-certificates curl xz-utils pkg-config
stage="$(mktemp -d)"
trap 'rm -rf "${stage}"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL https://nodejs.org/dist/index.tab -o "${stage}/index.tab"
version="$(awk '$1 ~ /^v22[.][0-9]+[.][0-9]+$/ {print $1; exit}' "${stage}/index.tab")"
[[ "${version}" =~ ^v22\.[0-9]+\.[0-9]+$ ]] || { echo 'Cannot resolve maintained Node 22 source release.' >&2; exit 1; }
archive="node-${version}.tar.xz"
curl --proto '=https' --tlsv1.2 -fsSL "https://nodejs.org/dist/${version}/SHASUMS256.txt" -o "${stage}/SHASUMS256.txt"
curl --proto '=https' --tlsv1.2 -fsSL "https://nodejs.org/dist/${version}/${archive}" -o "${stage}/${archive}"
expected="$(awk -v name="${archive}" '$2==name {print $1}' "${stage}/SHASUMS256.txt")"
[[ "${expected}" =~ ^[0-9a-f]{64}$ ]] || { echo 'Missing Node source checksum.' >&2; exit 1; }
printf '%s  %s\n' "${expected}" "${stage}/${archive}" | sha256sum -c -
tar -xJf "${stage}/${archive}" --no-same-owner -C "${stage}"
cd "${stage}/node-${version}"
prefix="/usr/local/lib/lightnas-node/${version}-${architecture}"
options=(--dest-cpu="${node_cpu}" --prefix="${prefix}")
if [[ "${architecture}" == armel ]]; then options+=(--with-arm-float-abi=soft --with-arm-fpu=vfp); fi
# Use portable OpenSSL C paths on 32-bit x86 and ARMv6: upstream generated
# assembly can reject the toolchain or require instructions absent on old CPUs.
# This retains cryptography/features; it only trades acceleration for portability.
if [[ "${architecture}" == i386 || "${architecture}" == armel ]]; then options+=(--openssl-no-asm); fi
# No -march=native: never silently raise the CPU baseline to the build machine.
python3 configure "${options[@]}"
jobs="${LIGHTNAS_RUNTIME_BUILD_JOBS:-1}"
[[ "${jobs}" =~ ^[1-9][0-9]?$ ]] || { echo 'Build jobs must be 1-99.' >&2; exit 1; }
make -j"${jobs}"
# Execute before installing or replacing a working runtime. No lite backend fallback.
LIGHTNAS_EXPECTED_NODE_ARCH="${node_cpu}" out/Release/node --input-type=module -e 'import {randomBytes} from "node:crypto";import {statfs} from "node:fs/promises";if(process.arch!==process.env.LIGHTNAS_EXPECTED_NODE_ARCH||Number(process.versions.node.split(".")[0])<22||typeof fetch!=="function")process.exit(1);await statfs("/");randomBytes(16);'
make install
install -d -m 0755 /usr/local/bin
ln -sfn "${prefix}/bin/node" /usr/local/bin/node
ln -sfn "${prefix}/lib/node_modules/npm/bin/npm-cli.js" /usr/local/bin/npm
