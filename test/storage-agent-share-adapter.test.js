import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,mkdir,readFile,readdir,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ShareAdapter} from '../src/storage-agent/operations.js';import {renderShares} from '../src/storage-agent/storage.js';
async function fixture(shares){const dir=await mkdtemp(join(tmpdir(),'nas-share-adapter-'));const path=join(dir,'data');await mkdir(path);const calls=[];const config={smb:join(dir,'managed.conf'),nfs:join(dir,'managed.exports'),manifest:join(dir,'shares.json'),main:join(dir,'smb.conf'),legacy:join(dir,'legacy.conf'),exports:join(dir,'exports'),bootId:async()=>'test-boot',shareRoots:async()=>[dir]};await writeFile(config.main,'[global]\ninclude = '+config.smb+'\n');let active='',denyAccess=false,missingUser=false;const run=async(bin,args)=>{calls.push([bin,...args]);if(bin.endsWith('pdbedit'))return {ok:true,stdout:missingUser?'':'alice:1000:Alice\n'};if(bin.endsWith('runuser')&&denyAccess)return {ok:false,stderr:'access denied'};if(bin.endsWith('exportfs')&&args[0]==='-s')return {ok:true,stdout:active};return {ok:true,stdout:''};};const adapter=new ShareAdapter({...config,run});return {dir,path,calls,adapter,set active(value){active=value;},set denyAccess(value){denyAccess=value;},set missingUser(value){missingUser=value;}};}
const share=path=>({name:'docs',path,protocol:'smb',readOnly:false,users:['alice']});
function config(shares){return {...renderShares(shares),manifest:JSON.stringify(shares)+'\n'};}
test('candidate validation uses full main config, checks accounts/access, and cleans candidates',async()=>{const f=await fixture();const s=share(f.path);await f.adapter.validatePaths([s]);await f.adapter.validate(config([s]));assert.ok(f.calls.some(c=>c[0].endsWith('pdbedit')));assert.ok(f.calls.some(c=>c.includes('-w')));assert.ok(!(await readdir(f.dir)).some(name=>name.startsWith('.lightnas-share-validation-')));});
test('SMB fails validation for unprovisioned credentials or missing Unix access',async()=>{const f=await fixture();f.missingUser=true;await assert.rejects(f.adapter.validate(config([share(f.path)])),/credentials/);f.missingUser=false;f.denyAccess=true;await assert.rejects(f.adapter.validate(config([share(f.path)])),/permissions/);});
test('SMB-only apply never activates NFS and verified state can be a no-op',async()=>{const f=await fixture();const c=config([share(f.path)]);await f.adapter.validate(c);await f.adapter.apply(c);await f.adapter.reload();assert.equal(await f.adapter.verifyCurrent(),true);assert.ok(!f.calls.some(c=>c[0].endsWith('exportfs')));const reloads=f.calls.filter(c=>c.includes('reload')).length;await f.adapter.apply(c);await f.adapter.reload();assert.equal(f.calls.filter(c=>c.includes('reload')).length,reloads);});
test('NFS activation requires a running service and verified active export',async()=>{const f=await fixture();const s={name:'linux',path:f.path,protocol:'nfs',readOnly:true,clients:['192.168.0.0/24']};const c=config([s]);await f.adapter.validate(c);await f.adapter.apply(c);await assert.rejects(f.adapter.reload(),/activation was not verified/);f.active=f.path+'\t192.168.0.0/24(ro,sync,root_squash)\n';await f.adapter.reload();assert.equal(await f.adapter.verifyCurrent(),true);assert.ok(f.calls.some(c=>c[0].endsWith('exportfs')&&c[1]==='-ra'));});
test('unrecorded configuration is not considered activated just because files match',async()=>{const f=await fixture();const c=config([share(f.path)]);await writeFile(f.adapter.smb,c.smb);await writeFile(f.adapter.nfs,c.nfs);await writeFile(f.adapter.manifest,c.manifest);assert.equal(await f.adapter.verifyCurrent(),false);await f.adapter.apply(c);await f.adapter.reload();assert.ok(f.calls.some(c=>c.includes('reload')));});

test('concurrent previews validate their own private candidates and clean up on failure',async()=>{
 const f=await fixture();const entered=[];let release;
 const barrier=new Promise(resolve=>{release=resolve;});
 f.adapter.run=async(bin,args)=>{
  if(bin.endsWith('pdbedit'))return {ok:true,stdout:'alice:1000:Alice\n'};
  if(bin.endsWith('testparm')){
   const path=args.at(-1);
   assert.equal((await stat(join(path,'..'))).mode&0o777,0o700);
   if(path.endsWith('/existing.conf')){
    entered.push(path);if(entered.length===2)release();await barrier;
   }else if(path.endsWith('/main.conf')){
    const main=await readFile(path,'utf8');const fragment=main.match(/^include = (.+)$/m)[1];
    const content=await readFile(fragment,'utf8');
    assert.ok(content.includes('[first]')||content.includes('[second]'));
    if(content.includes('[second]'))return {ok:false,stderr:'second candidate rejected'};
   }
  }
  return {ok:true,stdout:''};
 };
 const results=await Promise.allSettled(['first','second'].map(name=>f.adapter.validate(config([{...share(f.path),name}]))));
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
 assert.match(results[1].reason.message,/second candidate rejected/);
 assert.notEqual(entered[0],entered[1]);
 assert.ok(!(await readdir(f.dir)).some(name=>name.startsWith('.lightnas-share-validation-')));
});
test('a recorded share with stopped services needs activation again instead of blocking repair',async()=>{
 const f=await fixture();const c=config([share(f.path)]);
 await f.adapter.apply(c);await f.adapter.reload();assert.equal(await f.adapter.verifyCurrent(),true);
 const run=f.adapter.run;f.adapter.run=async(bin,args)=>bin.endsWith('systemctl')&&args[0]==='is-active'?{ok:false,stderr:'inactive'}:run(bin,args);
 assert.equal(await f.adapter.verifyCurrent(),false);
 await f.adapter.apply(c);assert.equal(f.adapter.smbReloadNeeded,true);
 await assert.rejects(f.adapter.verify(),/inactive/);
 f.adapter.run=run;assert.equal(await f.adapter.verifyCurrent(),true);
});

test('missing recorded NFS exports force reactivation even when configuration files match',async()=>{
 const f=await fixture();const s={name:'linux',path:f.path,protocol:'nfs',readOnly:true,clients:['192.168.0.0/24']};
 const c=config([s]);f.active=f.path+'\t192.168.0.0/24(ro,sync,root_squash)\n';
 await f.adapter.apply(c);await f.adapter.reload();assert.equal(await f.adapter.verifyCurrent(),true);
 f.active='';assert.equal(await f.adapter.verifyCurrent(),false);
 await f.adapter.validate(c);await f.adapter.apply(c);assert.equal(f.adapter.nfsReloadNeeded,true);
 await assert.rejects(f.adapter.reload(),/activation was not verified/);
 f.active=f.path+'\t192.168.0.0/24(ro,sync,root_squash)\n';
 await f.adapter.reload();assert.equal(await f.adapter.verifyCurrent(),true);
});
