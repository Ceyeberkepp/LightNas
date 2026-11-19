import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('favicon upload and reset include CSRF request marker while keeping session cookies',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const upload=app.match(/fetch\('\/api\/branding\/favicon', \{ method: 'PUT',[^\n]+/);
 const reset=app.match(/fetch\('\/api\/branding\/favicon', \{ method: 'DELETE',[^\n]+/);
 assert.ok(upload,'favicon upload handler present');
 assert.ok(reset,'favicon reset handler present');
 for(const request of [upload[0],reset[0]]){
  assert.match(request,/'X-LightNAS-Request': '1'/);
  assert.match(request,/credentials: 'same-origin'/);
 }
 assert.match(upload[0],/Content-Type/);
});
