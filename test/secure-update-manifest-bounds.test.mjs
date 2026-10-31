import test from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedManifest} from '../src/secure-updates.mjs';

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
