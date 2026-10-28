import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,appendFile,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const moduleUrl=new URL('../src/migration-resumable.mjs',import.meta.url).href;
const payload='persisted chunks across a real restart';
const prelude=`import * as transfers from ${JSON.stringify(moduleUrl)}; import {createHash} from 'node:crypto'; const data=Buffer.from(${JSON.stringify(payload)}); const sha256=createHash('sha256').update(data).digest('hex');`;
function run(root,script){
 const child=spawnSync(process.execPath,['--input-type=module','-e',prelude+script],{
  env:{...process.env,LIGHTNAS_MIGRATION_RESUME_DIR:root},encoding:'utf8',timeout:10000
 });
 assert.equal(child.status,0,child.stderr);
 return JSON.parse(child.stdout.trim());
}
async function directory(t){const root=await mkdtemp(join(tmpdir(),'lightnas-restart-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

test('fresh process recovers a session before its first chunk',async t=>{
 const root=await directory(t);
 const created=run(root,`console.log(JSON.stringify(await transfers.createResumableImport({name:'archive.tar',size:data.length,sha256})));`);
 const recovered=run(root,`console.log(JSON.stringify(await transfers.recoverResumableImports()));`);
 assert.deepEqual(recovered,[created]);
});

test('fresh process resumes partial data and verifies the completed checksum',async t=>{
 const root=await directory(t);
 const created=run(root,`const j=await transfers.createResumableImport({name:'archive.tar',size:data.length,sha256});await transfers.appendResumableChunk(j.id,0,data.subarray(0,8));console.log(JSON.stringify(j));`);
 // A crash can leave bytes beyond the last committed receipt offset.
 await appendFile(join(root,created.id+'.part'),'uncommitted bytes');
 const recovered=run(root,`console.log(JSON.stringify(await transfers.recoverResumableImports()));`);
 assert.equal(recovered[0].offset,8);
 assert.equal((await stat(join(root,created.id+'.part'))).size,8);
 const completed=run(root,`await transfers.recoverResumableImports();await transfers.appendResumableChunk(${JSON.stringify(created.id)},8,data.subarray(8));console.log(JSON.stringify(await transfers.finalizeResumableImport(${JSON.stringify(created.id)})));`);
 assert.equal(completed.verified,true);
 const restarted=run(root,`console.log(JSON.stringify(await transfers.recoverResumableImports()));`);
 assert.equal(restarted[0].state,'verified');
});

test('recovery rejects a verified artifact whose bytes changed',async t=>{
 const root=await directory(t);
 const completed=run(root,`const j=await transfers.createResumableImport({name:'archive.tar',size:data.length,sha256});await transfers.appendResumableChunk(j.id,0,data);console.log(JSON.stringify(await transfers.finalizeResumableImport(j.id)));`);
 await writeFile(join(root,completed.id+'.verified'),'x'.repeat(Buffer.byteLength(payload)));
 assert.deepEqual(run(root,`console.log(JSON.stringify(await transfers.recoverResumableImports()));`),[]);
});

test('failed receipt creation does not exhaust the active-transfer limit',async t=>{
 const root=await directory(t),blocked=join(root,'blocked');await writeFile(blocked,'not a directory');
 const result=run(blocked,`import {rm,mkdir} from 'node:fs/promises';let failures=0;for(let i=0;i<129;i++){try{await transfers.createResumableImport({name:'archive.tar',size:data.length,sha256});}catch(e){if(e.status===503)throw e;failures++;}}await rm(process.env.LIGHTNAS_MIGRATION_RESUME_DIR);await mkdir(process.env.LIGHTNAS_MIGRATION_RESUME_DIR);const j=await transfers.createResumableImport({name:'archive.tar',size:data.length,sha256});console.log(JSON.stringify({failures,state:j.state}));`);
 assert.deepEqual(result,{failures:129,state:'receiving'});
});
