import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const start = app.indexOf('let mobileUploadTask=');
const end = app.indexOf('function seriesStats(', start);
assert.ok(start >= 0 && end > start);
const source = app.slice(start, end);

function harness({prepareFailure,transferFailure}={}) {
  const visible = {hidden:true};
  const messages = [];
  const node = {
    className:'', setAttribute(){}, innerHTML:'',
    classList:{toggle(name, enabled){ if(name==='hidden') visible.hidden=enabled; }},
    querySelector(){return {textContent:'',value:0};}
  };
  let dock = null;
  const context = vm.createContext({
    document:{
      getElementById:()=>dock,
      createElement:()=>node,
      body:{append(value){dock=value;}}
    },
    state:{folder:'',view:'home'},
    isSystemImageFile:name=>/\\.iso$/i.test(name),
    libraryCategoryForName:()=> 'Documents',
    ensureUploadDirectories:async()=>{ if(prepareFailure) throw Error('Folder preparation denied'); },
    uploadRequest:async(_path,file,progress)=>{
      if(transferFailure) throw Object.assign(Error('Transfer failed'),{status:403});
      progress(file.size);
    },
    chunkUploadRequest:async()=>{},
    updateMobileUploadTask:null,
    bytes:value=>String(value)+' bytes',
    toast:message=>messages.push(message),
    matchMedia:()=>({matches:false}),
    window:{LightNASProgress:{open:()=>({update(){},succeed(){},fail(){}})}},
    setTimeout,
    Date
  });
  vm.runInContext(source,context);
  const active=()=>vm.runInContext('mobileUploadTask.active',context);
  return {context,active,visible,messages};
}
const file={name:'photo.jpg',size:10};

test('invalid selected media clears the mobile task before rejecting', async()=>{
  const h=harness();
  await assert.rejects(h.context.uploadFilesWithProgress([{name:'image.iso',size:10}]),/storage media/);
  assert.equal(h.active(),false);
  assert.equal(h.visible.hidden,true);
});
test('directory preparation errors cannot strand the mobile upload task',async()=>{
  const h=harness({prepareFailure:true});
  await assert.rejects(h.context.uploadFilesWithProgress([file]),/Folder preparation denied/);
  assert.equal(h.active(),false);
  assert.equal(h.visible.hidden,true);
});
test('failed transfers report the error without leaving the upload dock stuck',async()=>{
  const h=harness({transferFailure:true});
  await h.context.uploadFilesWithProgress([file]);
  assert.equal(h.active(),false);
  assert.equal(h.visible.hidden,true);
  assert.ok(h.messages.some(message=>message.includes('Transfer failed')));
});
test('successful transfers finish and clear the dock',async()=>{
  const h=harness();
  await h.context.uploadFilesWithProgress([file]);
  assert.equal(h.active(),false);
  assert.equal(h.visible.hidden,true);
});
test('picker rejection handler hides the dock and reports the failure',()=>{
  const h=harness();
  h.context.showUploadFailure(Error('Storage not available'));
  assert.equal(h.active(),false);
  assert.ok(h.messages.includes('Storage not available'));
});
