import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let caseNumber = 0;
async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'lightnas-license-receipt-'));
  const receiptFile = join(dir, 'receipt.json');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ format: 'pem', type: 'spki' });
  const saved = Object.fromEntries(['LIGHTNAS_LICENSE_RECEIPT','LIGHTNAS_LICENSE_SERVER_URL','LIGHTNAS_LICENSE_PUBLIC_KEY_PEM','LIGHTNAS_LICENSE_PUBLIC_KEY_FILE'].map(k=>[k,process.env[k]]));
  const originalFetch = globalThis.fetch;
  process.env.LIGHTNAS_LICENSE_RECEIPT = receiptFile;
  process.env.LIGHTNAS_LICENSE_SERVER_URL = 'https://license.example.invalid/verify';
  process.env.LIGHTNAS_LICENSE_PUBLIC_KEY_PEM = pem;
  process.env.LIGHTNAS_LICENSE_PUBLIC_KEY_FILE = join(dir,'nonexistent.pem');
  const module = await import(`../src/license.mjs?case=${++caseNumber}`);
  const makeReceipt = (overrides = {}) => {
    const payload = { instanceId: 'appliance-a', edition: 'pro', expiresAt: new Date(Date.now()+60000).toISOString(), ...overrides };
    const bytes = Buffer.from(JSON.stringify(payload));
    return { payload: bytes.toString('base64url'), signature: sign(null,bytes,privateKey).toString('base64url') };
  };
  try { await run({ ...module, receiptFile, makeReceipt }); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [k,v] of Object.entries(saved)) if(v===undefined) delete process.env[k]; else process.env[k]=v;
    await rm(dir,{recursive:true,force:true});
  }
}

const status = module => module.licenseStatus({instanceId:'appliance-a',version:'0.12.0'});

test('signed paid receipt survives restart/status lookup and grants only verified entitlement', async () => fixture(async ctx => {
  await writeFile(ctx.receiptFile,JSON.stringify(ctx.makeReceipt()));
  const result = await status(ctx);
  assert.equal(result.verified,true);
  assert.equal(result.edition,'pro');
  assert.equal(result.productionAllowed,true);
}));

test('tampering paid edition or features invalidates stored receipt instead of granting access', async () => fixture(async ctx => {
  const receipt = ctx.makeReceipt({edition:'community'});
  const forged = {...receipt,payload:Buffer.from(JSON.stringify({instanceId:'appliance-a',edition:'enterprise',features:{premium:true}})).toString('base64url')};
  await writeFile(ctx.receiptFile,JSON.stringify(forged));
  const result = await status(ctx);
  assert.equal(result.verified,false);
  assert.equal(result.productionAllowed,false);
  assert.equal(result.enterpriseUseAllowed,false);
  assert.deepEqual(result.features,{});
}));

test('unsigned legacy JSON receipts and changed verification keys fail closed', async () => fixture(async ctx => {
  await writeFile(ctx.receiptFile,JSON.stringify({payload:{instanceId:'appliance-a',edition:'enterprise'}}));
  assert.equal((await status(ctx)).productionAllowed,false);
  await writeFile(ctx.receiptFile,JSON.stringify(ctx.makeReceipt()));
  const otherKey = generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
  const old = process.env.LIGHTNAS_LICENSE_PUBLIC_KEY_PEM;
  process.env.LIGHTNAS_LICENSE_PUBLIC_KEY_PEM=otherKey;
  try {
    const changedModule = await import(`../src/license.mjs?case=${++caseNumber}`);
    assert.equal((await status(changedModule)).productionAllowed,false);
  } finally { process.env.LIGHTNAS_LICENSE_PUBLIC_KEY_PEM=old; }
}));

test('valid signature bound to another instance or expired entitlement fails closed', async () => fixture(async ctx => {
  await writeFile(ctx.receiptFile,JSON.stringify(ctx.makeReceipt({instanceId:'other'})));
  assert.equal((await status(ctx)).productionAllowed,false);
  await writeFile(ctx.receiptFile,JSON.stringify(ctx.makeReceipt({expiresAt:new Date(Date.now()-60000).toISOString()})));
  assert.equal((await status(ctx)).productionAllowed,false);
}));

test('verifyLicense persists signature and rejects tampered server response without replacing receipt', async () => fixture(async ctx => {
  const receipt=ctx.makeReceipt();
  globalThis.fetch=async()=>({ok:true,json:async()=>receipt});
  const result=await ctx.verifyLicense({licenseKey:'example-license-key',instanceId:'appliance-a',version:'0.12.0'});
  assert.equal(result.productionAllowed,true);
  assert.equal(JSON.parse(await readFile(ctx.receiptFile,'utf8')).signature,receipt.signature);
  const forged={...receipt,payload:Buffer.from(JSON.stringify({instanceId:'appliance-a',edition:'enterprise'})).toString('base64url')};
  globalThis.fetch=async()=>({ok:true,json:async()=>forged});
  await assert.rejects(ctx.verifyLicense({licenseKey:'example-license-key',instanceId:'appliance-a',version:'0.12.0'}),/signature/);
  assert.equal((await status(ctx)).edition,'pro');
}));
