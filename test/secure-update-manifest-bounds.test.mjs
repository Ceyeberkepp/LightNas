import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {arch,platform} from 'node:process';
import {checkSignedUpdates,readBoundedManifest} from '../src/secure-updates.mjs';

function streamed(parts) {
  const queue=[...parts];
  let cancelled=false;
  const body=new ReadableStream({
    pull(controller) {
      if(queue.length) controller.enqueue(queue.shift());
      else controller.close();
    },
    cancel() { cancelled=true; }
  });
  return {response:{body,headers:new Headers()},wasCancelled:()=>cancelled};
}

function openUntilCancelled(parts) {
  const queue=[...parts];
  let cancelled=false;
  const body=new ReadableStream({
    pull(controller) {
      if(queue.length) controller.enqueue(queue.shift());
      // Leave the stream open to verify explicit cancellation on rejection.
    },
    cancel() { cancelled=true; }
  });
  return {response:{body,headers:new Headers()},wasCancelled:()=>cancelled};
}

test('signed update manifest is read from bounded chunks without response.text()',async()=>{
  const {response}=streamed([Buffer.from('{"'),Buffer.from('payload":{}}')]);
  response.text=()=>{throw Error('unbounded response.text must never be called');};
  assert.equal(await readBoundedManifest(response),'{"payload":{}}');
});

test('signed update manifest accepts exactly 65536 decoded bytes',async()=>{
  const bytes=Buffer.from('é'.repeat(32768),'utf8');
  assert.equal(bytes.byteLength,65536);
  const {response}=streamed([bytes.subarray(0,3),bytes.subarray(3)]);
  const result=await readBoundedManifest(response);
  assert.equal(Buffer.byteLength(result,'utf8'),65536);
  assert.equal(result,'é'.repeat(32768));
});

test('oversized signed update stream is rejected and cancelled before further reads',async()=>{
  const {response,wasCancelled}=openUntilCancelled([
    Buffer.alloc(65530,65),Buffer.alloc(16,66),Buffer.alloc(4096,67)
  ]);
  await assert.rejects(readBoundedManifest(response),/Manifest exceeds size limit/);
  assert.equal(wasCancelled(),true,'the remaining HTTP body must be cancelled');
});

test('manifest cap counts UTF-8 bytes rather than characters',async()=>{
  const {response,wasCancelled}=openUntilCancelled([Buffer.from('é'.repeat(32769),'utf8')]);
  await assert.rejects(readBoundedManifest(response),/Manifest exceeds size limit/);
  assert.equal(wasCancelled(),true);
});

test('missing or invalid streaming response fails closed',async()=>{
  await assert.rejects(readBoundedManifest({body:null}),/body is unavailable/);
  const {response,wasCancelled}=openUntilCancelled(['not a byte array']);
  await assert.rejects(readBoundedManifest(response),/Invalid manifest response chunk/);
  assert.equal(wasCancelled(),true);
});

test('signed update check rejects an oversized feed without buffering it',async()=>{
  const originalFetch=globalThis.fetch;
  const originalUrl=process.env.LIGHTNAS_UPDATE_MANIFEST_URL;
  const originalKey=process.env.LIGHTNAS_UPDATE_PUBLIC_KEY_FILE;
  const {response,wasCancelled}=openUntilCancelled([Buffer.alloc(65537,65)]);
  try {
    process.env.LIGHTNAS_UPDATE_MANIFEST_URL='https://updates.example.invalid/manifest';
    process.env.LIGHTNAS_UPDATE_PUBLIC_KEY_FILE='/nonexistent-lightnas-update-test-key';
    globalThis.fetch=async()=>({ok:true,status:200,body:response.body});
    const result=await checkSignedUpdates({currentVersion:'1.0.0'});
    assert.equal(result.checkStatus,'error');
    assert.equal(result.updateEnabled,false);
    assert.match(result.message,/Manifest exceeds size limit/);
    assert.equal(wasCancelled(),true);
  } finally {
    globalThis.fetch=originalFetch;
    if(originalUrl===undefined)delete process.env.LIGHTNAS_UPDATE_MANIFEST_URL;
    else process.env.LIGHTNAS_UPDATE_MANIFEST_URL=originalUrl;
    if(originalKey===undefined)delete process.env.LIGHTNAS_UPDATE_PUBLIC_KEY_FILE;
    else process.env.LIGHTNAS_UPDATE_PUBLIC_KEY_FILE=originalKey;
  }
});

test('bounded signed feed still verifies valid Ed25519 metadata but cannot install',async()=>{
  const originalFetch=globalThis.fetch;
  const originalUrl=process.env.LIGHTNAS_UPDATE_MANIFEST_URL;
  const originalKey=process.env.LIGHTNAS_UPDATE_PUBLIC_KEY_FILE;
  const directory=await mkdtemp(join(tmpdir(),'lightnas-signed-update-test-'));
  try {
    const {publicKey,privateKey}=generateKeyPairSync('ed25519');
    const keyPath=join(directory,'update-public.pem');
    await writeFile(keyPath,publicKey.export({type:'spki',format:'pem'}));
    const payload={
      product:'lightnas-nas',tier:'community',channel:'stable',
      arch,platform,version:'1.0.1',
      expiresAt:new Date(Date.now()+60000).toISOString()
    };
    const signature=sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64');
    const {response}=streamed([Buffer.from(JSON.stringify({payload,signature}))]);
    process.env.LIGHTNAS_UPDATE_MANIFEST_URL='https://updates.example.invalid/manifest';
    process.env.LIGHTNAS_UPDATE_PUBLIC_KEY_FILE=keyPath;
    globalThis.fetch=async()=>({ok:true,status:200,body:response.body});
    const result=await checkSignedUpdates({currentVersion:'1.0.0'});
    assert.equal(result.checkStatus,'verified',result.message);
    assert.equal(result.updateAvailable,true);
    assert.equal(result.updateEnabled,false,'unimplemented staging and rollback must remain disabled');
  } finally {
    globalThis.fetch=originalFetch;
    if(originalUrl===undefined)delete process.env.LIGHTNAS_UPDATE_MANIFEST_URL;
    else process.env.LIGHTNAS_UPDATE_MANIFEST_URL=originalUrl;
    if(originalKey===undefined)delete process.env.LIGHTNAS_UPDATE_PUBLIC_KEY_FILE;
    else process.env.LIGHTNAS_UPDATE_PUBLIC_KEY_FILE=originalKey;
    await rm(directory,{recursive:true,force:true});
  }
});
