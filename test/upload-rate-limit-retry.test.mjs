import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function uploadRetryDelay('), source.indexOf('async function ensureUploadDirectories('));
function client(statuses) {
  const delays = []; const urls = [];
  class XMLHttpRequest {
    constructor() { this.listeners = {}; this.upload = { addEventListener() {} }; }
    open(method, url) { urls.push(url); }
    setRequestHeader() {}
    addEventListener(type, callback) { this.listeners[type] = callback; }
    getResponseHeader() { return '60'; }
    send() { this.status = statuses.shift(); this.responseText = '{}'; queueMicrotask(() => this.listeners.load()); }
  }
  const context = vm.createContext({ XMLHttpRequest, setTimeout: (fn, ms) => { delays.push(ms); queueMicrotask(fn); }, crypto: { randomUUID: () => 'test-session-id' } });
  vm.runInContext(functions, context);
  return { context, delays, urls };
}
test('mobile chunk retries respect the server rate-limit window and keep the same chunk identity', async () => {
  const { context, delays, urls } = client([429, 201]);
  await context.chunkUploadRequest('Photos/test.jpg', { size: 10, type: 'image/jpeg', slice: () => ({ size: 10 }) });
  assert.deepEqual(delays, [60000]); assert.equal(urls[0], urls[1]);
});
test('desktop uploads expose retry delay to the batch worker', async () => {
  const { context } = client([429]);
  await assert.rejects(context.uploadRequest('test.txt', {}), e => e.status === 429 && e.retryAfterMs === 60000);
});
test('retry delays handle dates, missing headers and non-rate-limit failures', () => {
  const { context } = client([]);
  const delay = (status, value) => context.uploadRetryDelay({ status, getResponseHeader: () => value }, 500);
  assert.equal(delay(429, null), 60000);
  assert.equal(delay(429, 'invalid'), 60000);
  assert.equal(delay(500, '60'), 500);
  const dateDelay = delay(429, new Date(Date.now() + 60000).toUTCString());
  assert.ok(dateDelay > 58000 && dateDelay <= 60000);
});
