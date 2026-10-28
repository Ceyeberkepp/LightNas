import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rankNavigationItems, normalizeNavigationText } from '../public/workspace-navigation.js';

const pages = [
  { label:'Storage', group:'Storage' },
  { label:'Pools & datasets', group:'Storage' },
  { label:'Files & media', group:'Storage' },
  { label:'Settings & security', group:'Admin Center' },
  { label:'AI', group:'Apps & compute' },
  { label:'Networking', group:'Connectivity' }
];

test('navigation search prefers exact labels and supports partial matches', () => {
  assert.equal(rankNavigationItems(pages, 'storage')[0].label, 'Storage');
  assert.equal(rankNavigationItems(pages, 'settings')[0].label, 'Settings & security');
  assert.equal(rankNavigationItems(pages, 'data')[0].label, 'Pools & datasets');
  assert.equal(rankNavigationItems(pages, 'network')[0].label, 'Networking');
});

test('navigation search includes group matches, handles no results, and limits output', () => {
  const matches = rankNavigationItems(pages, 'Connectivity');
  assert.deepEqual(matches.map(item => item.label), ['Networking']);
  assert.deepEqual(rankNavigationItems(pages, 'no-such-page'), []);
  assert.equal(rankNavigationItems(pages, '', 3).length, 3);
  assert.equal(rankNavigationItems(pages, '', 0).length, 0);
});

test('navigation search normalization is case and accent insensitive', () => {
  assert.equal(normalizeNavigationText('  SÉCURITÉ '), 'securite');
  assert.equal(rankNavigationItems([{ label:'Sécurité', group:'Admin' }], 'securite').length, 1);
});

test('shared workspace header contains accessible search controls and module', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="workspace-search"[^>]*role="combobox"/);
  assert.match(html, /id="workspace-search-results"[^>]*role="listbox"/);
  assert.match(html, /src="\/workspace-navigation\.js"/);
  assert.match(html, /href="\/workspace-navigation\.css"/);
});

test('workspace search module does not introduce a new backend API', () => {
  const source = readFileSync(new URL('../public/workspace-navigation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.match(source, /data-admin-section/);
  assert.match(source, /nav-files-subtabs/);
});
