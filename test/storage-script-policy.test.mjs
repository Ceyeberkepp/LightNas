import test from 'node:test';
import assert from 'node:assert/strict';
import {assertStorageScripts} from '../test-support/storage-script-policy.mjs';

const external = '<script type="module" src="/storage-operations.js"></script>';
test('storage script policy accepts the external module and HTML tag case variants', () => {
  assertStorageScripts(external);
  assertStorageScripts(external.replaceAll('script', 'SCRIPT'));
});
test('storage script policy rejects inline scripts, attributes, missing closers and extra scripts', () => {
  for (const html of [
    '<SCRIPT>run()</SCRIPT>', '<ScRiPt type="module">run()</ScRiPt>',
    '<script\n>run()</script>', external + '<SCRIPT>run()</SCRIPT>',
    external.replace('></script>', '>run()</script>'),
    external.replace(' src=', ' onload="run()" src='),
    external.replace('</script>', ''), external + '<script>',
    external.replace('/storage-operations.js', 'https://example.invalid/script.js'),
    '<script data-description=\'src="/storage-operations.js"\'>run()</script>',
  ]) assert.throws(() => assertStorageScripts(html));
});
