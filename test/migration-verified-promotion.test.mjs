import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
test('complete verified uploads enter the existing migration import pipeline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lightnas-promotion-'));
 process.env.LIGHTNAS_MIGRATION_RESUME_DIR=join(root,'resumable');
 process.env.LIGHTNAS_MIGRATION_STAGING_DIR=join(root,'staged');
 try{
  const {createResumableImport,appendResumableChunk,finalizeResumableImport}=await import('../src/migration-resumable.mjs');
  const {promoteVerifiedResumableImport,verifiedMigrationFile}=await import('../src/migration-transfer.mjs');
  const payload=Buffer.from('verified NAS migration fixture');
  const sha256=createHash('sha256').update(payload).digest('hex');
  const item=await createResumableImport({name:'sample.tar',size:payload.length,sha256});
  await assert.rejects(promoteVerifiedResumableImport(item.id),/verified transfer is required/i);
  await appendResumableChunk(item.id,0,payload);
  await finalizeResumableImport(item.id);
  const job=await promoteVerifiedResumableImport(item.id);
  assert.equal(job.state,'verified');
  const source=verifiedMigrationFile(job.id);
  assert.equal(source.sha256,sha256);
  assert.deepEqual(await readFile(source.path),payload);
 } finally {await rm(root,{recursive:true,force:true});}
});
