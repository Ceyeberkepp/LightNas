import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/enhancements.css',import.meta.url),'utf8');
test('upload dock is anchored to document body, never inside re-rendered file list',()=>{
 assert.match(js,/document\.body\.append\(node\)/);
 assert.match(css,/body > \.mobile-file-upload-task:not\(\.hidden\)/);
});
test('upload begins after bulk picker selection without awaiting a dialog',()=>{
 assert.match(js,/const files = \[\.\.\.event\.target\.files\]/);
 assert.match(js,/uploadFilesWithProgress\(files, false\)\.catch/);
});
test('failure to prepare directories becomes visible to phone user',()=>{
 assert.match(js,/Upload could not start/);
});
