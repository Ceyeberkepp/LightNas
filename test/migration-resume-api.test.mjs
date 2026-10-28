import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const temporary=await mkdtemp(join(tmpdir(),'lightnas-resume-test-'));
process.env.LIGHTNAS_MIGRATION_RESUME_DIR=temporary;
test.after(()=>rm(temporary,{recursive:true,force:true}));
const {createResumableImport,recoverResumableImports,appendResumableChunk,finalizeResumableImport,cancelResumableImport}=await import('../src/migration-resumable.mjs');
test('new transfer persists before first data chunk',async()=>{
 const content=Buffer.from('migration payload');
 const j=await createResumableImport({name:'archive.tar',size:content.length,sha256:createHash('sha256').update(content).digest('hex')});
 const recovered=await recoverResumableImports();
 assert.equal(recovered.find(x=>x.id===j.id)?.offset,0);
 await appendResumableChunk(j.id,0,content);
 assert.equal((await finalizeResumableImport(j.id)).verified,true);
});
test('persisted zero-byte session can be canceled',async()=>{
 const content=Buffer.from('abc');
 const j=await createResumableImport({name:'cancel.tar',size:3,sha256:createHash('sha256').update(content).digest('hex')});
 await cancelResumableImport(j.id);
 assert.equal((await recoverResumableImports()).some(x=>x.id===j.id),false);
});
