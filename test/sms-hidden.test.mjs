import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {smsVerificationEnabled} from '../src/sms-service.mjs';

test('SMS verification is off by default and requires explicit host opt-in',()=>{
 const previous=process.env.LIGHTNAS_SMS_ENABLED;
 try {delete process.env.LIGHTNAS_SMS_ENABLED;assert.equal(smsVerificationEnabled(),false);process.env.LIGHTNAS_SMS_ENABLED='0';assert.equal(smsVerificationEnabled(),false);process.env.LIGHTNAS_SMS_ENABLED='1';assert.equal(smsVerificationEnabled(),true);}
 finally {if(previous===undefined)delete process.env.LIGHTNAS_SMS_ENABLED;else process.env.LIGHTNAS_SMS_ENABLED=previous;}
});

test('actual security renderer omits SMS panels, setup form and errors while retaining other methods',async()=>{
 const source=await readFile(new URL('../public/admin-security.js',import.meta.url),'utf8');
 const render=source.slice(source.indexOf('async function renderTotp()'),source.indexOf('async function renderAutomation()'));
 for(const featureEnabled of [false,true]){
  let rendered;const content={};const dashboard={append:section=>{rendered=section.innerHTML;}};
  const context={location:{hash:'#settings'},adminSectionActive:()=>true,window:{LightNASOverview:{appliance:{role:'administrator'}},isSecureContext:true,PublicKeyCredential:{}},navigator:{credentials:{}},document:{createElement:()=>({})},q:selector=>selector==='#content'?content:selector==='.settings-dashboard'?dashboard:null,escapeText:String,api:async path=>path.endsWith('/sms')?{featureEnabled,enabled:false,gateway:{available:false,reason:'LightNAS SMS service is not configured on this appliance.'}}:path.endsWith('/totp')?{enabled:false}:{passkeys:[]}};
  vm.createContext(context);await vm.runInContext(render+';renderTotp()',context);
  assert.match(rendered,/Authenticator app/);assert.match(rendered,/Passkeys & security keys/);
  if(featureEnabled)assert.match(rendered,/data-sms-setup/);
  else assert.doesNotMatch(rendered,/SMS|data-sms|verification phone|Send setup code|LightNAS SMS service/);
 }
});

test('existing SMS enrollments are omitted from sign-in methods without changing TOTP/passkeys',async()=>{
 const source=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
 const helper=source.slice(source.indexOf('function enabledMfaMethods('),source.indexOf('async function accountForPassword('));
 const context={smsVerificationEnabled:()=>false};vm.createContext(context);
 const methods=vm.runInContext(helper+';enabledMfaMethods({smsMfa:{enabled:true},totpEnabled:true,passkeys:[{id:"key"}]})',context);
 assert.deepEqual(Array.from(methods),['totp','passkey']);
 context.smsVerificationEnabled=()=>true;
 assert.deepEqual(Array.from(vm.runInContext('enabledMfaMethods({smsMfa:{enabled:true}})',context)),['sms']);
});

test('running application hides SMS status and rejects enrollment/login delivery while disabled',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'nas-hidden-sms-'));const previousFile=process.env.NAS_DATA_FILE,previousFlag=process.env.LIGHTNAS_SMS_ENABLED;
 process.env.NAS_DATA_FILE=join(dir,'state.json');delete process.env.LIGHTNAS_SMS_ENABLED;
 const {createServer}=await import('../src/server.mjs?sms-hidden='+Date.now());const server=createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});if(previousFile===undefined)delete process.env.NAS_DATA_FILE;else process.env.NAS_DATA_FILE=previousFile;if(previousFlag===undefined)delete process.env.LIGHTNAS_SMS_ENABLED;else process.env.LIGHTNAS_SMS_ENABLED=previousFlag;});
 const base='http://127.0.0.1:'+server.address().port;
 const setup=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json','X-LightNAS-Request':'1'},body:JSON.stringify({deviceName:'test',username:'admin',password:'ExamplePass123',timezone:'UTC'})});
 assert.equal(setup.status,201);const cookie=setup.headers.get('set-cookie').split(';')[0];
 const status=await fetch(base+'/api/security/sms',{headers:{Cookie:cookie}});assert.deepEqual(await status.json(),{featureEnabled:false,enabled:false});
 for(const path of ['/api/security/sms/setup','/api/security/sms/verify','/api/login/sms/send']){
  const result=await fetch(base+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-LightNAS-Request':'1'},body:'{}'});assert.equal(result.status,404);
 }
 const options=await fetch(base+'/api/login/options?username=admin');const payload=await options.json();assert.ok(!payload.methods.includes('sms'));assert.equal(payload.smsDestination,null);
});
