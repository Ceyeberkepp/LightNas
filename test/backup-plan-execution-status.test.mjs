import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app = readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server = readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');

test('legacy backup definitions cannot be mistaken for completed backup protection',()=>{
  assert.match(app,/pageHead\('Backup plans', 'Draft definitions only\. A saved plan does not protect or back up data\.'/);
  assert.match(app,/Backup execution is not yet available for these legacy plans\./);
  assert.match(app,/do not run on a schedule, create recovery copies, or prove that any data is protected/);
  assert.match(app,/data-backup-run disabled title="Legacy backup plans do not execute data backups">Run unavailable/);
  assert.match(app,/Show: Data Without Saved Plan/);
  assert.match(app,/<span>Plan enabled<\/span>.*<span>Proposed schedule<\/span><span>Execution status<\/span>/);
  assert.match(app,/<span>Not scheduled<\/span>/);
  assert.match(app,/Draft backup plan saved\. No data was backed up\./);
  assert.doesNotMatch(app,/data-backup-run \${selected \? '' : 'disabled'}>Run now/);
});

test('legacy backup run API fails closed instead of reporting job execution success',()=>{
  const start=server.indexOf("if (req.method === 'POST' && /^\\/api\\/backups\\/jobs\\/[^/]+\\/run$/.test(url.pathname))");
  assert.ok(start>=0);
  const route=server.slice(start,start+930);
  assert.match(route,/requirePermission\(res, permissions, 'backup.manage'\)/);
  assert.match(route,/return send\(res, 409, \{ id, queued:false/);
  assert.match(route,/This legacy definition cannot execute backups/);
  assert.doesNotMatch(route,/return send\(res, 20[012]/);
});
