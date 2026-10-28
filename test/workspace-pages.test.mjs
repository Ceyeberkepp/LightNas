import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/workspace-pages.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('workspace page rules target actual view classes rather than invented grids', () => {
  for (const className of [
    'file-browser-grid', 'file-card', 'file-toolbar', 'app-catalog-grid',
    'app-catalog-toolbar', 'user-card-grid', 'admin-center-workspace',
    'admin-center-nav', 'settings-dashboard', 'network-table', 'backup-table-wrap'
  ]) {
    assert.ok(app.includes(className), 'Missing rendered class: ' + className);
    assert.ok(css.includes('.' + className), 'Missing page-specific CSS: ' + className);
  }
});

test('all page-specific layout rules are loaded after legacy design layers', () => {
  assert.ok(html.indexOf('/workspace-pages.css') > html.indexOf('/design-v2.css'));
  assert.match(css, /@container\(max-width:740px\)/);
  assert.match(css, /@media\(max-width:760px\)/);
});

test('responsive page rules do not change routes, task dock, or API calls', () => {
  assert.doesNotMatch(css, /#task-dock|\.task-dock|\/api\//);
  assert.match(app, /content\.dataset\.currentView\s*=\s*state\.view/);
});
