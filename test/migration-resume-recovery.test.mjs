import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const temporary=await mkdtemp(join(tmpdir(),'lightnas-resume-test-'));
process.env.LIGHTNAS_MIGRATION_RESUME_DIR=temporary;
test.after(()=>rm(temporary,{recursive:true,force:true}));
const {createResumableImport,appendResumableChunk,recoverResumableImports,finalizeResumableImport,cancelResumableImport}=await import('../src/migration-resumable.mjs');
test('recover durable partial import and complete it',async()=>{
 const data=Buffer.from('persisted chunks across restarts');
 const sha256=createHash('sha256').update(data).digest('hex');
 const j=await createResumableImport({name:'backup.tar',size:data.length,sha256});
 await appendResumableChunk(j.id,0,data.subarray(0,8));
 const recovered=await recoverResumableImports();
 assert.equal(recovered.find(x=>x.id===j.id).offset,8);
 await appendResumableChunk(j.id,8,data.subarray(8));
 assert.equal((await finalizeResumableImport(j.id)).verified,true);
});
test('cancel removes durable receipt and partial transfer',async()=>{
 const data=Buffer.from('cancel me');
 const sha256=createHash('sha256').update(data).digest('hex');
 const j=await createResumableImport({name:'remove.tar',size:data.length,sha256});
 await appendResumableChunk(j.id,0,data.subarray(0,3));
 await cancelResumableImport(j.id);
 const recovered=await recoverResumableImports();
 assert.equal(recovered.some(x=>x.id===j.id),false);
});
