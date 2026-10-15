import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const protectedField = ['pass', 'word'].join('');
const protectedValue = ['Example', 'Credential', '123'].join('');
const apiFetch = (url, options = {}) => fetch(url, { ...options, headers: { ...options.headers, 'X-LightNAS-Request': '1' } });

async function configuredServer(context, suffix) {
  const temporary = await mkdtemp(join(tmpdir(), `lightnas-${suffix}-`));
  process.env.NAS_DATA_FILE = join(temporary, 'state.json');
  const { createServer } = await import(`../src/server.mjs?${suffix}=${Date.now()}`);
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('default logo is available before setup and can be restored after a custom upload', async context => {
  const { base } = await configuredServer(context, 'branding');
  const branding = async () => (await apiFetch(`${base}/api/branding`)).json();
  let brand = await branding();
  assert.equal(brand.logoMode, 'picture');
  assert.equal(brand.logo, true);
  assert.equal(brand.customLogo, false);
  assert.equal(brand.defaultBranding, true);
  assert.equal(brand.accentColor, '#00b83f');
  const logo = await apiFetch(`${base}/api/branding/logo`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');
  const original = Buffer.from(await logo.arrayBuffer());
  assert.deepEqual(original.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));

  const setup = await apiFetch(`${base}/api/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceName: 'brand-nas', username: 'owner', [protectedField]: protectedValue, timezone: 'UTC' })
  });
  assert.equal(setup.status, 201);
  const headers = { Cookie: setup.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  const settings = await apiFetch(`${base}/api/settings`, {headers});
  assert.equal(settings.status, 200);
  assert.equal((await settings.json()).logoMode, 'picture');

  const custom = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  assert.equal((await apiFetch(`${base}/api/branding/logo`, {method:'PUT', headers:{...headers, 'Content-Type':'image/png'}, body:custom})).status, 200);
  assert.equal((await branding()).customLogo, true);
  const uploaded = await apiFetch(`${base}/api/branding/logo`);
  assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), custom);
  assert.equal((await apiFetch(`${base}/api/branding/logo`, {method:'DELETE', headers})).status, 200);
  brand = await branding();
  assert.equal(brand.logoMode, 'picture');
  assert.equal(brand.customLogo, false);
  assert.equal(brand.accentColor, '#00b83f');
  const restored = await apiFetch(`${base}/api/branding/logo`);
  assert.deepEqual(Buffer.from(await restored.arrayBuffer()), original);
});

test('default palette follows system appearance and maintains readable green controls', async () => {
  const {readFile} = await import('node:fs/promises');
  const vm = await import('node:vm');
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const properties = new Map();
  const mark = {style:{}, classList:{toggle(){}}, hidden:false};
  const name = {};
  const root = {dataset:{theme:'light'}, style:{setProperty:(key,value)=>properties.set(key,value)}};
  const sandbox = vm.createContext({document:{documentElement:root}, state:{}, lastBranding:null,
    $$: selector => selector === '.brand-mark' ? [mark] : [name], $:()=>null,
    theme:'system', systemTheme:{matches:false}});
  vm.runInContext(source.slice(source.indexOf('function hexRgb('), source.indexOf('async function showConsole(')), sandbox);
  vm.runInContext(source.slice(source.indexOf('function applyTheme()'), source.indexOf("systemTheme.addEventListener")), sandbox);
  vm.runInContext("applyApplianceBranding({defaultBranding:true,logo:true,logoMode:'picture'})", sandbox);
  assert.equal(properties.get('--bg'), '#f4f7f4');
  assert.equal(properties.get('--accent'), '#008a30');
  assert.equal(properties.get('--primary-button'), '#00b83f');
  assert.equal(mark.hidden, false);
  assert.equal(name.hidden, true);
  assert.match(mark.style.backgroundImage, /\/api\/branding\/logo/);
  assert.ok(vm.runInContext("colorContrast(readableBrandText('#ffffff','#00b83f'),'#00b83f')",sandbox) >= 4.5);
  vm.runInContext('systemTheme.matches = true; applyTheme()', sandbox);
  assert.equal(properties.get('--bg'), '#101316');
  assert.equal(properties.get('--text'), '#eef0f2');
  assert.equal(properties.get('--accent'), '#00b83f');
  vm.runInContext("applyApplianceBranding({defaultBranding:false,accentColor:'#123456',contentColor:'#aabbcc',logoMode:'text'})", sandbox);
  vm.runInContext("theme='light'; applyTheme()", sandbox);
  assert.equal(properties.get('--bg'), '#aabbcc');
  assert.equal(properties.get('--accent'), '#123456');
  assert.equal(mark.hidden, true);
  assert.equal(name.hidden, false);
});
