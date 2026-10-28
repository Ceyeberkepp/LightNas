import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const temporary=await mkdtemp(join(tmpdir(),'lightnas-resume-test-'));
process.env.LIGHTNAS_MIGRATION_RESUME_DIR=temporary;
test.after(()=>rm(temporary,{recursive:true,force:true}));
const {createResumableImport,appendResumableChunk,finalizeResumableImport,cancelResumableImport,resumableImportStatus}=await import('../src/migration-resumable.mjs');
const digest=b=>createHash('sha256').update(b).digest('hex');
test('rejects incorrect byte offsets',async()=>{
 const data=Buffer.from('resume me');const j=await createResumableImport({name:'test.tar',size:data.length,sha256:digest(data)});
 await assert.rejects(appendResumableChunk(j.id,1,data),/offset mismatch/);
 await cancelResumableImport(j.id);
});
test('append chunks in sequence and verify checksum',async()=>{
 const data=Buffer.from('two contiguous chunks');
 const j=await createResumableImport({name:'test.qcow2',size:data.length,sha256:digest(data)});
 await appendResumableChunk(j.id,0,data.subarray(0,5));
 assert.equal(resumableImportStatus(j.id).offset,5);
 await appendResumableChunk(j.id,5,data.subarray(5));
 const final=await finalizeResumableImport(j.id);
 assert.equal(final.verified,true);
 assert.equal(final.sha256,digest(data));
});
test('wrong checksum cannot finalize as verified',async()=>{
 const data=Buffer.from('corrupted');
 const j=await createResumableImport({name:'test.raw',size:data.length,sha256:'0'.repeat(64)});
 await appendResumableChunk(j.id,0,data);
 await assert.rejects(finalizeResumableImport(j.id),/checksum mismatch/);
 assert.equal(resumableImportStatus(j.id).state,'failed');
});
test('incomplete transfers cannot finalize',async()=>{
 const data=Buffer.from('incomplete');
 const j=await createResumableImport({name:'test.tar',size:data.length,sha256:digest(data)});
 await appendResumableChunk(j.id,0,data.subarray(0,3));
 await assert.rejects(finalizeResumableImport(j.id),/incomplete/);
 await cancelResumableImport(j.id);
});
