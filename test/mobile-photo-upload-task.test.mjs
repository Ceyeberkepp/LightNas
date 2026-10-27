import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('mobile photo picker supports multi-select without camera-only capture',()=>{
 assert.match(js,/id="mobile-native-upload"[^>]*accept="image\/\*,video\/\*" multiple/);
 assert.doesNotMatch(js,/id="mobile-native-upload"[^>]*capture/);
});
test('upload progress can display after file picker returns',()=>{
 assert.match(js,/mobile-file-upload-task/);
 assert.match(js,/updateMobileUploadTask\(\{active:true,percent/);
 assert.match(js,/uploadFilesWithProgress\(files, false\)\.catch/);
});
