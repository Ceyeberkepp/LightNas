import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {STORAGE_PROVIDERS,acceptsSource} from '../public/storage-providers.js';
import {mountedSources,ResourceAdapter} from '../src/storage-agent/resources.js';

const dataSource={id:'agent-source',path:'/mnt/data',device:'/dev/sdb1',type:'ext4',readOnly:false,size:1024};
test('mount discovery excludes WSL system mounts, files and inaccessible mounts',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'nas-mounts-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const mountsFile=join(dir,'mounts');await writeFile(mountsFile,'/dev/sdb1 /mnt/data ext4 rw 0 0\nnone /usr/lib/wsl/drivers 9p ro 0 0\nnone /mnt/wslg tmpfs rw 0 0\nnone /mnt/wsl tmpfs rw 0 0\nnone /init rootfs ro 0 0\nnone /mnt/file ext4 rw 0 0\nnone /mnt/offline ext4 rw 0 0\n');
 const sources=await mountedSources({mountsFile,directoryInfo:async p=>({isDirectory:()=>p!=='/mnt/file'}),inspect:async p=>{if(p==='/mnt/offline')throw Error('offline');return {blocks:1n,bsize:1024n};}});
 assert.deepEqual(sources.map(s=>s.path),['/mnt/data']);assert.equal(sources[0].id,Buffer.from('/dev/sdb1:/mnt/data').toString('base64url'));
});
test('creation options use the same identities as resource plans and mark configured sources',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'nas-options-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const adapter=new ResourceAdapter({dataDir:dir,sources:async()=>[dataSource],canTraverse:async()=>true});
 const options=await adapter.creationOptions();assert.deepEqual(options.providers,STORAGE_PROVIDERS.map(p=>p.id));assert.equal(options.sources[0].id,dataSource.id);assert.equal(options.sources[0].configured,false);
 await writeFile(join(dir,'storage-pools.json'),JSON.stringify({pools:[{sourceId:dataSource.id}]}));assert.equal((await adapter.creationOptions()).sources[0].configured,true);
});
async function ui(options,fields={}){
 const code=(await readFile(new URL('../public/storage-manager.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').split("document.addEventListener('click'")[0];
 const body={},error={},footer={},submit={disabled:false},select={options:[],value:''};let handler,listenerOptions,posted,attempts=0;
 const form={elements:{name:{value:'fastssd'},sourceId:select,provider:{value:'directory'},...fields},querySelectorAll:()=>[{value:'files'}],querySelector:()=>submit,addEventListener:(name,fn,opts)=>{handler=fn;listenerOptions=opts;}};
 const dialog={open:false,querySelector:q=>({'[data-storage-dialog-title]':{},'[data-storage-dialog-error]':error,'[data-storage-dialog-footer]':footer,'[data-storage-dialog-body]':body,'select[name="sourceId"]':select,'[data-storage-create-form]':form,'[data-provider-volume]':{}}[q]),querySelectorAll:()=>[],showModal(){this.open=true;},close(){this.open=false;}};
 const context=vm.createContext({STORAGE_PROVIDERS,acceptsSource,document:{querySelector:()=>dialog},fetch:async(path,request)=>{
  if(path.endsWith('creation-options'))return {ok:!options.error,status:options.error?503:200,json:async()=>options.error?{error:options.error}:options};
  posted=JSON.parse(request.body);attempts++;return {ok:false,status:400,json:async()=>({error:'Choose a different name'})};
 }});
 vm.runInContext(code,context);vm.runInContext("storageUi.data={availableSources:[{id:'legacy-id',mountPoint:'/mnt/data',device:'/dev/sdb1'}],contentTypes:[{id:'files',label:'Files'}]}",context);
 return {context,body,error,footer,select,submit,form,submitForm:()=>handler({preventDefault(){},currentTarget:form}),get posted(){return posted;},get attempts(){return attempts;},get listenerOptions(){return listenerOptions;}};
}
test('creation uses agent identities and allows retry after a rejected preview',async()=>{
 const u=await ui({sources:[dataSource]});await vm.runInContext('openCreateStorage()',u.context);assert.equal(u.select.value,'agent-source');assert.equal(u.footer.hidden,true);
 await u.submitForm();assert.equal(u.posted.sourceId,'agent-source');assert.equal(u.submit.disabled,false);assert.match(u.error.textContent,/different name/);
 assert.equal(u.listenerOptions?.once,undefined);await u.submitForm();assert.equal(u.attempts,2);
});
test('Btrfs excludes other filesystem types and missing agent disables creation with explanation',async()=>{
 const u=await ui({sources:[dataSource]});await vm.runInContext("openCreateStorage('','btrfs')",u.context);assert.doesNotMatch(u.body.innerHTML,/value="agent-source"/);assert.match(u.body.innerHTML,/type="submit" disabled/);
 const missing=await ui({error:'Storage agent unavailable'});await vm.runInContext('openCreateStorage()',missing.context);assert.match(missing.body.innerHTML,/Storage agent unavailable/);assert.match(missing.body.innerHTML,/type="submit" disabled/);
});

test('SMB setup submits connection fields and private credentials while keeping all providers available',async()=>{
 const u=await ui({sources:[]},{connectionMode:{value:'connect',addEventListener(){}},server:{value:'nas'},share:{value:'data'},username:{value:'lightnas'},domain:{value:''},credential:{value:'private-value'}});
 await vm.runInContext("openCreateStorage('','smb-cifs')",u.context);u.form.elements.provider.value='smb-cifs';await u.submitForm();assert.equal(u.posted.connect,true);assert.equal(u.posted.providerConfig.server,'nas');assert.equal(u.posted.private.credentials.password,'private-value');assert.equal(u.posted.providerConfig.password,undefined);assert.equal(vm.runInContext('STORAGE_ADD_TYPES.length',u.context),14);
});
