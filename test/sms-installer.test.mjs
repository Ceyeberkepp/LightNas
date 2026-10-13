import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,stat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const exec=promisify(execFile);
const script=new URL('../scripts/configure-sms-client.py',import.meta.url).pathname;
const settings={LIGHTNAS_SMS_GATEWAY_URL:'https://sms.example.test',LIGHTNAS_SMS_GATEWAY_TOKEN:'appliance-test-token-123456'};
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'nas-sms-install-'));const path=join(dir,'sms.env');const env={...process.env,LIGHTNAS_SMS_CONFIG_FILE:path};for(const key of [...Object.keys(settings),'LIGHTNAS_SMS_PROVISION_FILE','LIGHTNAS_REQUIRE_SMS'])delete env[key];return {dir,path,env,run:patch=>exec('python3',[script],{env:{...env,...patch}})};}
test('one-click SMS provisioning writes private configuration without leaking token and preserves it on update',async()=>{
 const f=await fixture();const result=await f.run(settings);assert.ok(!result.stdout.includes(settings.LIGHTNAS_SMS_GATEWAY_TOKEN));
 assert.equal((await stat(f.path)).mode&0o777,0o640);const before=await readFile(f.path,'utf8');
 await f.run({});assert.equal(await readFile(f.path,'utf8'),before);
 assert.match(before,/LIGHTNAS_SMS_GATEWAY_URL="https:\/\/sms.example.test"/);
});
test('operator provisioning file configures the central client, without installing a delivery provider',async()=>{
 const f=await fixture();const provision=join(f.dir,'provision.json');await writeFile(provision,JSON.stringify(settings),{mode:0o600});
 await f.run({LIGHTNAS_SMS_PROVISION_FILE:provision});assert.match(await readFile(f.path,'utf8'),/appliance-test-token/);
 await writeFile(provision,JSON.stringify({...settings,LIGHTNAS_SMS_PROVIDER_TOKEN:'provider-secret'}));
 await assert.rejects(f.run({LIGHTNAS_SMS_PROVISION_FILE:provision}));
 assert.ok(!(await readFile(f.path,'utf8')).includes('provider-secret'));
});
test('missing enrollment is explicit and required SMS fails without writing a fake configuration',async()=>{
 const f=await fixture();await assert.rejects(f.run({LIGHTNAS_REQUIRE_SMS:'1'}));await assert.rejects(stat(f.path));
 const result=await f.run({});assert.match(result.stdout,/SMS verification pending/);
});
test('invalid or partial replacements preserve the working SMS enrollment',async()=>{
 const f=await fixture();await f.run(settings);const before=await readFile(f.path,'utf8');
 for(const patch of [{LIGHTNAS_SMS_GATEWAY_URL:'https://other.test'}, {...settings,LIGHTNAS_SMS_GATEWAY_URL:'http://sms.example.test'}, {...settings,LIGHTNAS_SMS_GATEWAY_TOKEN:'bad\nINJECTED=yes'}, {...settings,LIGHTNAS_SMS_GATEWAY_URL:'https://user:password@example.test'}]){
  await assert.rejects(f.run(patch));assert.equal(await readFile(f.path,'utf8'),before);
 }
});
test('environment configuration is parsed as data and symlinks are rejected',async()=>{
 const f=await fixture();const marker=join(f.dir,'executed');await writeFile(f.path,`LIGHTNAS_SMS_GATEWAY_URL=https://sms.example.test\nLIGHTNAS_SMS_GATEWAY_TOKEN=$(touch ${marker})\n`);
 await assert.rejects(f.run({}));await assert.rejects(stat(marker));
 const target=join(f.dir,'target');await writeFile(target,'preserve');const link=join(f.dir,'linked');await symlink(target,link);
 await assert.rejects(f.run({...settings,LIGHTNAS_SMS_CONFIG_FILE:link}));assert.equal(await readFile(target,'utf8'),'preserve');
});
test('existing one-click installer provisions SMS and storage agent before restart',async()=>{
 const source=await readFile(new URL('../install.sh',import.meta.url),'utf8');
 assert.ok(source.indexOf('scripts/configure-sms-client.py')<source.indexOf('systemctl restart "${SERVICE_NAME}"'));
 assert.match(source,/EnvironmentFile=-\/etc\/lightnas\/sms.env/);
 assert.match(source,/systemctl restart lightnas-storage-agent.service/);
});
