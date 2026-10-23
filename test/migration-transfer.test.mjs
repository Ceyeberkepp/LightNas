import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('staged migration export is copied with checksum and rejects traversal', async () => {
  const root=await mkdtemp(join(tmpdir(),'lightnas-migration-'));
  const incoming=join(root,'incoming'), verified=join(root,'verified');
  await mkdir(incoming);
  await writeFile(join(incoming,'sample.qcow2'),'safe-fixture-content');
  const childScript=`
    import { startMigrationImport, migrationJob } from ${JSON.stringify(new URL('../src/migration-transfer.mjs',import.meta.url).href)};
    const j=await startMigrationImport({filename:'sample.qcow2'});
    let r; for(let i=0;i<200;i++){r=migrationJob(j.id);if(r.state==='verified'||r.state==='failed') break; await new Promise(ok=>setTimeout(ok,10));}
    if(r.state!=='verified')throw Error(r.error||'verification failed');
    console.log(JSON.stringify(r));
    try{await startMigrationImport({filename:'../bad.qcow2'}); throw Error('traversal accepted')}catch(e){if(e.message==='traversal accepted')throw e;}
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',childScript],{env:{...process.env,LIGHTNAS_MIGRATION_IMPORT_DIR:incoming,LIGHTNAS_MIGRATION_STAGING_DIR:verified},encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  const job=JSON.parse(result.stdout.trim());
  assert.equal(job.verified,true);
  assert.equal(await readFile(join(verified,job.target),'utf8'),'safe-fixture-content');
  assert.match(job.digest,/^[a-f0-9]{64}$/);
});
