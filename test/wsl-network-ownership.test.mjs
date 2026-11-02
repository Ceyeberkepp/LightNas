import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

test('WSL2 Windows-owned NIC remains untouched before any appliance network detection',()=>{
 const network=readFileSync(new URL('../scripts/configure-appliance-network.sh',import.meta.url),'utf8');
 const wsl=network.indexOf('if grep -qi microsoft /proc/sys/kernel/osrelease');
 assert.ok(wsl>=0);
 const before=network.slice(0,wsl);
 assert.doesNotMatch(before,/ip link add|ip addr replace|nmcli connection up|virsh -c/);
 const logic=network.slice(wsl,network.indexOf('preferred_uplink=',wsl));
 assert.match(logic,/LIGHTNAS_NETWORK_ERROR=wsl-host-managed/);
 assert.match(logic,/\bexit 0\b/);
});

test('actual Python host agent rejects unsafe WSL2 mutation requests',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const p=spawnSync('python3',['-m','unittest','discover','-s','test',
   '-p','test_wsl_network_ownership.py','-v'],{
   cwd:root,encoding:'utf8',timeout:15000,
   env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}
 });
 assert.equal(p.status,0,'WSL2 regression tests failed: '+p.stdout+'\n'+p.stderr);
});
