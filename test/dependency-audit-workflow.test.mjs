import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/dependency-audit.yml', import.meta.url), 'utf8');

test('production dependency audit runs for pull requests and relevant main changes', () => {
  assert.match(workflow, /^\s*pull_request:\s*$/m);
  assert.match(workflow, /^\s*push:\s*$/m);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /package\.json/);
});

test('dependency audit is blocking and does not run untrusted install scripts', () => {
  assert.match(workflow, /npm install --package-lock-only --ignore-scripts --no-audit --no-fund/);
  assert.match(workflow, /npm audit --omit=dev --audit-level=high/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  assert.doesNotMatch(workflow, /npm audit[^\n]*(?:\|\|\s*true|--audit-level=none)/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
});
