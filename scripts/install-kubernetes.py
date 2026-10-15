#!/usr/bin/env python3
"""Install a pinned K3s binary; called only by an approved root operation."""
import hashlib
import ipaddress
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BINARY=Path('/usr/local/bin/k3s')
CONFIG=Path('/etc/rancher/k3s/config.yaml')
UNIT=Path('/etc/systemd/system/k3s.service')

def validate(config, architecture, memory_mib, cores, routes=()):
    if set(config)-{'mode','bindAddress','clusterCidr','serviceCidr','server','token'}: raise ValueError('Unknown Kubernetes install option')
    mode=config.get('mode','server')
    if mode not in ('server','agent'): raise ValueError('Choose server or agent')
    release=json.loads((ROOT/'config/kubernetes-release.json').read_text())
    if architecture not in release['architectures']: raise ValueError('The bundled K3s release has no qualified binary for '+architecture)
    minimum=4096 if mode=='server' else 3072
    if memory_mib<minimum or cores<(2 if mode=='server' else 1): raise ValueError('Kubernetes '+mode+' requires '+str(minimum)+' MiB total RAM in addition to sufficient CPU capacity for the NAS workload')
    if mode=='server':
        ipaddress.IPv4Address(config.get('bindAddress','0.0.0.0'))
        pod=ipaddress.IPv4Network(config.get('clusterCidr','10.242.0.0/16'),strict=True)
        services=ipaddress.IPv4Network(config.get('serviceCidr','10.243.0.0/16'),strict=True)
        if not (8<=pod.prefixlen<=24 and 8<=services.prefixlen<=24) or pod.overlaps(services): raise ValueError('Choose separate /8–/24 pod and service networks')
        for raw in routes:
            if raw in ('default','0.0.0.0/0'): continue
            try: route=ipaddress.IPv4Network(raw,strict=False)
            except ValueError: continue
            if pod.overlaps(route) or services.overlaps(route): raise ValueError('Kubernetes network overlaps host route '+raw)
    else:
        from urllib.parse import urlparse
        import re
        url=urlparse(config.get('server',''))
        if url.scheme!='https' or not url.hostname or url.username or url.password or url.path not in ('','/') or url.query or url.fragment: raise ValueError('Use an HTTPS Kubernetes server URL')
        try: ipaddress.ip_address(url.hostname)
        except ValueError:
            if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{0,252}',url.hostname): raise ValueError('Invalid Kubernetes server hostname')
        if url.port is not None and not 1<=url.port<=65535: raise ValueError('Invalid Kubernetes API port')
        if not re.fullmatch(r'K10[0-9a-f]{64}::[^\s\x00]{1,4096}',config.get('token','')): raise ValueError('Use the secure K10 join token including the server CA hash')
    return release['architectures'][architecture]

def main(config_file):
    if os.geteuid()!=0: raise RuntimeError('Kubernetes installation requires root')
    config=json.loads(Path(config_file).read_text())
    arch=subprocess.check_output(['dpkg','--print-architecture'],text=True).strip()
    routes=json.loads(subprocess.check_output(['ip','-j','route','show','table','all'],text=True))
    entry=validate(config,arch,os.sysconf('SC_PAGE_SIZE')*os.sysconf('SC_PHYS_PAGES')//1024**2,os.cpu_count() or 1,[r.get('dst','') for r in routes])
    if not Path('/run/systemd/system').is_dir() or not Path('/sys/fs/cgroup').is_dir(): raise RuntimeError('A running systemd host and usable cgroups are required')
    if any(path.exists() or path.is_symlink() for path in (BINARY,CONFIG,UNIT,Path('/var/lib/rancher/k3s'))): raise RuntimeError('Existing Kubernetes installation/configuration found; refusing to overwrite it')
    for target in (BINARY,CONFIG,UNIT,Path('/var/lib/rancher/k3s')):
        for parent in target.parents:
            if parent.exists() and (parent.is_symlink() or parent.resolve()!=parent): raise RuntimeError('Kubernetes install paths must not traverse symlinks')
    # No shell installer, mutable latest URL, or cross-architecture binary.
    with tempfile.TemporaryDirectory(prefix='lightnas-k3s-') as temp:
        target=Path(temp)/'k3s'
        request=urllib.request.Request(entry['url'],headers={'User-Agent':'LightNAS-Kubernetes-installer'})
        digest=hashlib.sha256()
        with urllib.request.urlopen(request,timeout=120) as response,target.open('wb') as output:
            while True:
                block=response.read(1024*1024)
                if not block: break
                digest.update(block);output.write(block)
        if digest.hexdigest()!=entry['sha256']: raise RuntimeError('K3s binary checksum mismatch')
        target.chmod(0o755)
        subprocess.run([str(target),'--version'],check=True,capture_output=True,timeout=30)
        settings={}
        if config.get('mode','server')=='server':
            settings.update({'write-kubeconfig-mode':'0600','bind-address':config.get('bindAddress','0.0.0.0'),'cluster-cidr':config.get('clusterCidr','10.242.0.0/16'),'service-cidr':config.get('serviceCidr','10.243.0.0/16'),'disable':['traefik','servicelb'],'secrets-encryption':True})
        else: settings.update({'server':config['server'],'token':config['token']})
        CONFIG.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        # JSON is a YAML subset; credentials never enter argv or systemd unit text.
        config_fd=os.open(CONFIG,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(config_fd,'w') as output: output.write(json.dumps(settings)+'\n')
        CONFIG.chmod(0o600)
        BINARY.parent.mkdir(parents=True,exist_ok=True)
        with BINARY.open('xb') as output,target.open('rb') as source: shutil.copyfileobj(source,output)
        BINARY.chmod(0o755)
        mode=config.get('mode','server')
        unit='[Unit]\nDescription=LightNAS Kubernetes (K3s '+mode+')\nAfter=network-online.target\nWants=network-online.target\n[Service]\nType=notify\nExecStart=/usr/local/bin/k3s '+mode+' --config /etc/rancher/k3s/config.yaml\nKillMode=process\nDelegate=yes\nLimitNOFILE=1048576\nTasksMax=infinity\nTimeoutStartSec=600\nRestart=on-failure\nRestartSec=5\n[Install]\nWantedBy=multi-user.target\n'
        with UNIT.open('x') as output: output.write(unit)
        UNIT.chmod(0o644)
        subprocess.run(['systemctl','daemon-reload'],check=True,capture_output=True)
        subprocess.run(['systemctl','enable','--now','k3s.service'],check=True,capture_output=True,timeout=600)
        print('Kubernetes '+mode+' installed and active. Firewall rules were preserved.')

if __name__=='__main__':
    try: main(sys.argv[1])
    except Exception as error:
        # Never include config contents, join tokens or child process output.
        print('Kubernetes setup failed: '+str(error),file=sys.stderr)
        sys.exit(1)
