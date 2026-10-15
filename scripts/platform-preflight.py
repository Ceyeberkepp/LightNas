#!/usr/bin/env python3
"""Native CPU/OS preflight; deliberately runs before installing Node.js."""
import argparse
import json
import os
import platform
import struct
import subprocess
from pathlib import Path

ALIASES = {'x86_64':'amd64','x64':'amd64','aarch64':'arm64','armv7l':'armhf','armv6l':'armel','ia32':'i386','i386':'i386','i486':'i386','i586':'i386','i686':'i386','riscv64':'riscv64'}

def inspect(machine=None, cpuinfo=None, architecture=None, ram_bytes=None):
    machine = machine or platform.machine().lower()
    if architecture is None:
        try:
            architecture = subprocess.check_output(['dpkg','--print-architecture'], text=True, timeout=5).strip()
        except (OSError, subprocess.SubprocessError):
            architecture = ALIASES.get(machine,machine)
    architecture = ALIASES.get(architecture,architecture)
    if cpuinfo is None:
        try: cpuinfo = Path('/proc/cpuinfo').read_text()
        except OSError: cpuinfo = ''
    flags = None
    for line in cpuinfo.splitlines():
        if line.split(':',1)[0].strip().lower() in ('flags','features') and ':' in line:
            current = set(line.split(':',1)[1].lower().split())
            flags = current if flags is None else flags.intersection(current)
    if ram_bytes is None:
        ram_bytes = os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES')
    return {'architecture':architecture,'machine':machine,'bits':32 if architecture in ('i386','armhf','armel') else 64,
            'ramMiB':ram_bytes//(1024**2),'cpuCount':os.cpu_count() or 1,'cpuFlags':sorted(flags or set()),
            'applicationProfile':'full',
            'qualified':architecture=='amd64',
            'fullRuntimeRequired':'Node.js >=22; must pass a native execution probe',
            'kubernetesLocal':architecture in ('amd64','arm64','armhf'),
            'kubernetesReason':None if architecture in ('amd64','arm64','armhf') else 'No release-qualified bundled K3s runtime for this architecture.'}

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--architecture');args=parser.parse_args()
    report=inspect(architecture=args.architecture)
    print(json.dumps(report,sort_keys=True))
