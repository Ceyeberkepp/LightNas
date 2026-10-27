import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=js.indexOf('async function uploadFilesWithProgress');
const end=js.indexOf('function seriesStats(',start);
const upload=js.slice(start,end);
test('bulk upload progress does not sum thousands of items on every chunk',()=>{
 assert.match(upload,/let transferredBytes = 0/);
 assert.match(upload,/transferredBytes\+=value-loadedByFile\[index\]/);
 assert.doesNotMatch(upload,/loadedByFile\.reduce/);
});
test('render updates throttled and batch yields event loop',()=>{
 assert.match(upload,/now-lastProgressUpdate<250/);
 assert.match(upload,/setTimeout\(resolve,0\)/);
});
test('phone remains single-worker to limit Safari memory pressure',()=>{
 assert.match(upload,/mobile \? 1 : 3/);
});
