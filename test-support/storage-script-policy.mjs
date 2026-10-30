import assert from 'node:assert/strict';

// A deliberately strict check for this static page, not a general HTML sanitizer.
export function assertStorageScripts(html) {
  const openings = [...html.matchAll(/<script\b[^>]*>/gi)];
  assert.equal(openings.length, 1, 'Storage page must contain exactly one script');
  const script = html.slice(openings[0].index);
  assert.match(script, /^<script\s+type="module"\s+src="\/storage-operations\.js"\s*>\s*<\/script\s*>/i,
    'Storage page must use only its external module, without inline script content');
}
