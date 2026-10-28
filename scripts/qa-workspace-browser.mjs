// Prerequisite: Playwright plus an installed Chromium, or supply the two
// LIGHTNAS_* environment paths below. Uses disposable state, never a live NAS.
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporary = await mkdtemp(join(tmpdir(), 'lightnas-browser-'));
process.env.NAS_DATA_FILE = join(temporary, 'state.json');
const { createServer } = await import('../src/server.mjs');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  const { chromium } = await import(process.env.LIGHTNAS_PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({
    headless: true,
    ...(process.env.LIGHTNAS_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LIGHTNAS_CHROMIUM_EXECUTABLE } : {}),
    args: ['--no-sandbox', '--single-process', '--disable-dev-shm-usage', '--no-zygote', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--disable-software-rasterizer']
  });
  const context = await browser.newContext();
  const setup = await context.request.post(`${base}/api/setup`, {
    headers: { 'X-LightNAS-Request': '1' },
    data: { deviceName: 'browser-staging', username: 'owner', password: 'ExampleCredential123', timezone: 'UTC' }
  });
  assert.equal(setup.status(), 201);
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('#console:not(.hidden)').waitFor();
  const views = ['home','storage','pools','files','shares','backups','apps','ai','containers','vms','kubernetes','network','firewall','integrations','admin'];
  const sizes = process.env.LIGHTNAS_QA_COMPACT === '1' ? [[390,844],[1280,720]] : [[320,568],[390,844],[430,932],[768,1024],[1024,768],[1280,720],[1366,768],[1696,864],[1920,1080],[844,390]];
  let checks = 0;
  const go = async view => {
    await page.evaluate(value => { location.hash = value; }, view);
    await page.waitForFunction(value => document.querySelector('#content')?.dataset.currentView === value, view);
    await page.waitForTimeout(100);
  };
  for (const theme of ['light','dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [width,height] of sizes) {
      console.log(`Checking ${theme} ${width}x${height}`);
      await page.setViewportSize({width,height});
      for (const view of views) {
        await go(view);
        const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(size.scroll <= size.width + 1, `${theme} ${width} ${view}: page overflow`);
        const active = page.locator('.ln-workspace-nav [aria-current="page"]');
        if (await active.count()) {
          assert.ok(await active.evaluate(element => {
            const r = element.getBoundingClientRect(), n = element.parentElement.getBoundingClientRect();
            return r.left >= n.left - 1 && r.right <= n.right + 1;
          }), `${view}: current section is outside its scroll area`);
        }
        if (process.env.LIGHTNAS_QA_SCREENSHOTS && [390,1280].includes(width)) {
          await mkdir(process.env.LIGHTNAS_QA_SCREENSHOTS, {recursive:true});
          await page.screenshot({path:join(process.env.LIGHTNAS_QA_SCREENSHOTS, `${theme}-${view}-${width}.png`)});
        }
        checks++;
      }
      // This catches render failures that leave markup visible but actions unbound.
      await go('home');
      await page.locator('[data-overview-metric="memory"]').click().catch(async error => {
        console.log(await page.locator('[data-overview-metric="memory"]').evaluate(e=>({rect:e.getBoundingClientRect().toJSON(),parents:[...function*(n){while(n){yield n;n=n.parentElement}}(e)].map(n=>({tag:n.tagName,cls:n.className,overflow:getComputedStyle(n).overflow,height:n.clientHeight,scroll:n.scrollHeight}))})));
        if(process.env.LIGHTNAS_QA_SCREENSHOTS) await page.screenshot({path:join(process.env.LIGHTNAS_QA_SCREENSHOTS,'failure.png')});
        throw error;
      });
      assert.equal(await page.locator('[data-overview-metric="memory"]').getAttribute('aria-pressed'), 'true');
      await go('firewall');
      await page.locator('[data-firewall-add]').click();
      const dialog = page.locator('dialog.ln-management-editor[open]');
      await dialog.waitFor();
      assert.ok(await dialog.getAttribute('aria-labelledby'));
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height + 1, 'dialog exceeds viewport');
      await dialog.locator('[name="decision"]').selectOption('deny');
      await dialog.locator('[name="port"]').fill('12345');
      await dialog.locator('[data-editor-revert]').click();
      assert.equal(await dialog.locator('[name="decision"]').inputValue(), 'allow');
      assert.equal(await dialog.locator('[name="port"]').inputValue(), '');
      await dialog.locator('[data-dialog-close]').first().click();
      if ([390,1280].includes(width)) {
        await go('admin');
        for (const section of ['general','users','permissions','smtp','settings','analytics','capabilities','integrations','migration']) {
          await page.locator(`.admin-center-nav [data-admin-section="${section}"]`).click();
          await page.waitForTimeout(100);
          assert.ok(await page.locator(`.admin-center-nav [data-admin-section="${section}"]`).evaluate(e=>{
            const r=e.getBoundingClientRect(), n=e.parentElement.getBoundingClientRect();
            return e.classList.contains('active') && r.left>=n.left-1 && r.right<=n.right+1;
          }), `Admin ${section} current tab must remain visible`);
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1), `Admin ${section} overflow`);
        }
        await go('files');
        if (width < 761) {
          await page.locator('[data-mobile-files-settings]:visible').click();
          await page.locator('#mobile-files-settings-dialog[open]').waitFor();
          await page.locator('[data-mobile-files-settings-close]').click();
        } else {
          await page.locator('[data-files-settings-tab]').click();
          await page.locator('[data-files-settings-close]').waitFor();
          await page.locator('[data-files-settings-close]').click();
        }
      }
    }
  }
  assert.deepEqual(errors, [], 'browser JavaScript errors');
  console.log(`PASS: ${checks} route/theme/viewport checks; graph actions and editor open/close at each size. Host agents and real storage workloads are not exercised.`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, {recursive:true,force:true});
}
