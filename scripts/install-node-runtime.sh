#!/usr/bin/env bash
# Select a maintained native runtime. Never downgrade to an EOL Node release.
set -Eeuo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Run runtime installation as root.' >&2; exit 1; }
ulimit -c 0 || true
architecture="${LIGHTNAS_ARCH:-$(dpkg --print-architecture)}"
expected_node_arch="${architecture}"
case "${architecture}" in amd64) expected_node_arch=x64 ;; armhf|armel) expected_node_arch=arm ;; i386) expected_node_arch=ia32 ;; esac
export LIGHTNAS_EXPECTED_NODE_ARCH="${expected_node_arch}"
probe_runtime() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 &&
    node --input-type=module -e 'import {randomBytes} from "node:crypto"; import {statfs} from "node:fs/promises"; if(process.arch!==process.env.LIGHTNAS_EXPECTED_NODE_ARCH||Number(process.versions.node.split(".")[0])<22)process.exit(1); await statfs("/"); if(typeof fetch!=="function"||randomBytes(16).length!==16)process.exit(1); console.log(JSON.stringify({version:process.version,arch:process.arch,native:true}));' && npm --version >/dev/null 2>&1
}
if probe_runtime 2>/dev/null; then exit 0; fi
case "${architecture}" in
  amd64|arm64|armhf|armel|i386|riscv64) ;;
  *) echo "Unsupported runtime architecture: ${architecture}" >&2; exit 1 ;;
esac
# Distribution packages carry architecture-specific builds, including RISC-V.
apt-get update
candidate="$(apt-cache policy nodejs | awk '/Candidate:/{print $2; exit}')"
version="${candidate#*:}"
if [[ "${version}" =~ ^([0-9]+)\. ]] && (( BASH_REMATCH[1] >= 22 )); then
  apt-get -o DPkg::Lock::Timeout=300 install -y --no-install-recommends nodejs npm
elif [[ "${architecture}" == amd64 || "${architecture}" == arm64 ]]; then
  install -d -m 0755 /etc/apt/keyrings
  curl --proto '=https' --tlsv1.2 -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n' "${architecture}" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get -o DPkg::Lock::Timeout=300 install -y --no-install-recommends nodejs
elif [[ "${architecture}" == armhf ]]; then
  # Node 22 still publishes an official ARMv7 build. APT/NodeSource do not
  # provide it for every supported ARM distribution, so verify upstream bytes.
  runtime_stage="$(mktemp -d)"
  trap 'rm -rf "${runtime_stage}"' EXIT
  curl --proto '=https' --tlsv1.2 -fsSL https://nodejs.org/dist/index.tab -o "${runtime_stage}/index.tab"
  version="$(awk '$1 ~ /^v22[.][0-9]+[.][0-9]+$/ && $3 ~ /(^|,)linux-armv7l(,|$)/ {print $1; exit}' "${runtime_stage}/index.tab")"
  [[ "${version}" =~ ^v22\.[0-9]+\.[0-9]+$ ]] || { echo 'No current upstream Node 22 ARMv7 build was found.' >&2; exit 1; }
  archive="node-${version}-linux-armv7l.tar.xz"
  curl --proto '=https' --tlsv1.2 -fsSL "https://nodejs.org/dist/${version}/SHASUMS256.txt" -o "${runtime_stage}/SHASUMS256.txt"
  curl --proto '=https' --tlsv1.2 -fsSL "https://nodejs.org/dist/${version}/${archive}" -o "${runtime_stage}/${archive}"
  expected="$(awk -v name="${archive}" '$2==name {print $1}' "${runtime_stage}/SHASUMS256.txt")"
  [[ "${expected}" =~ ^[0-9a-f]{64}$ ]] || { echo 'Missing upstream Node ARMv7 checksum.' >&2; exit 1; }
  printf '%s  %s\n' "${expected}" "${runtime_stage}/${archive}" | sha256sum -c -
  runtime_target="/usr/local/lib/lightnas-node/${version}-armv7l"
  install -d -m 0755 "${runtime_target}" /usr/local/bin
  tar -xJf "${runtime_stage}/${archive}" --no-same-owner --strip-components=1 -C "${runtime_target}"
  ln -sfn "${runtime_target}/bin/node" /usr/local/bin/node
  ln -sfn "${runtime_target}/lib/node_modules/npm/bin/npm-cli.js" /usr/local/bin/npm
  hash -r
else
  LIGHTNAS_ARCH="${architecture}" bash "$(dirname "${BASH_SOURCE[0]}")/build-node-runtime.sh"
  hash -r
fi
if ! probe_runtime; then
  echo 'The native runtime failed its CPU/OS startup check. The full application requires a compatible CPU, OS and maintained runtime; no reduced application was installed.' >&2
  exit 1
fi
