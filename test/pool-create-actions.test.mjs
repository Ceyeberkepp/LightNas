import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {planVolume} from '../src/storage-agent/volumes.js';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const disk=(id,path)=>({id,serial:id,path,size:10*1024**3,readOnly:false,children:[],mounts:[],holders:[],signatures:[]});
const hardware=()=>({disks:[disk('A','/dev/sda'),disk('B','/dev/sdb')],filesystems:[],pools:[],initializationEnabled:true});
async function context(){
 const context=vm.createContext({document:{addEventListener(){},querySelector:()=>null,createElement:()=>({append(){},addEventListener(){}})},window:{},fetch:async()=>{},setTimeout});
 const code=(await read('public/nas-features.js')).replace(/^import[^\n]+\n/gm,'').split('const observer=new MutationObserver')[0];vm.runInContext(code,context);return context;
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('Pools and datasets header opens creation actions while Storage retains provider registration',async()=>{
 const source=await read('public/app.js');const context=vm.createContext({state:{overview:{storage:{}}},escapeHtml:String,bytes:String,pageHead:(title,description,actions)=>actions});
 vm.runInContext(source.slice(source.indexOf('function poolsView()'),source.indexOf('async function loadSpaces()')),context);const markup=vm.runInContext('poolsView()',context);
 assert.match(markup,/data-nf-action="pool-create">\+ Create pool/);assert.match(markup,/data-nf-action="dataset-create">\+ Create dataset/);assert.doesNotMatch(markup,/data-create-storage|\+ Add storage/);
 assert.match(source.slice(source.indexOf('function storageView()'),source.indexOf('function poolsView()')),/storageAddMenuHeader\(\)/);
});
test('pool action submits an approved pool mutation rather than a storage definition',async()=>{
 const ctx=await context();ctx.hardware=hardware();ctx.input={label:'data',diskIds:['B','A']};
 vm.runInContext("api=async path=>{if(path!=='/inventory')throw Error('Unexpected route');return hardware;};fieldsForm=async(title,fields,initial,options)=>{globalThis.form={title,fields,options};return input;};operation=async value=>{globalThis.submitted=value;};openDialog=()=>{};",ctx);
 await vm.runInContext("action('pool-create')",ctx);assert.equal(ctx.form.title,'Create pool');assert.equal(ctx.form.options.disabled,false);assert.equal(ctx.form.fields[1].choices.length,2);
 const input=plain(ctx.submitted);assert.deepEqual(input,{type:'pool.create',filesystem:'btrfs',profile:'raid1',label:'data',diskIds:['B','A']});const impact=planVolume(input,hardware());assert.equal(impact.confirmation,'INITIALIZE A,B');assert.equal(impact.dataErased,true);
});
test('used disks, incomplete inventories and mounted Windows folders cannot be selected as blank pool disks',async()=>{
 const ctx=await context();ctx.hardware=hardware();ctx.disk=disk('C','/dev/sdc');assert.equal(vm.runInContext('poolDiskReason(disk,hardware)',ctx),'');
 for(const patch of [{serial:null,wwn:null},{path:'/mnt/c'},{readOnly:true},{signatures:null},{children:[{path:'/dev/sdc1'}]},{mounts:['/']},{holders:['dm-0']},{signatures:[{type:'ntfs'}]}]){ctx.disk={...disk('C','/dev/sdc'),...patch};assert.ok(vm.runInContext('poolDiskReason(disk,hardware)',ctx));}
 ctx.disk=disk('C','/dev/sdc');ctx.hardware.filesystems=[{device:'/dev/sdc',type:'ext4'}];assert.ok(vm.runInContext('poolDiskReason(disk,hardware)',ctx));
 for(const diskIds of [[],['A'],['A','A']]){ctx.input={label:'data',diskIds};assert.throws(()=>vm.runInContext('poolCreationInput(input)',ctx),/different blank disks/);}
});
test('pool creation explains disabled host policy and missing hardware without requesting a preview',async()=>{
 for(const [initializationEnabled,disks] of [[false,hardware().disks],[true,[]]]){
  const ctx=await context();ctx.hardware={...hardware(),initializationEnabled,disks};vm.runInContext("api=async()=>hardware;fieldsForm=async(title,fields,initial,options)=>{globalThis.form={title,fields,options};return null;};operation=async()=>{throw Error('No preview should be submitted');};",ctx);await vm.runInContext("action('pool-create')",ctx);assert.equal(ctx.form.options.disabled,true);assert.match(ctx.form.options.description,initializationEnabled?/two blank block disks/:/host’s storage policy/);
 }
});
test('dataset header action creates a child dataset and rejects unavailable ZFS or absent parents before opening an empty form',async()=>{
 const ctx=await context();ctx.data={zfs:{available:true,datasets:[{type:'filesystem',name:'tank'}]}};vm.runInContext("load=async()=>data;fieldsForm=async(title,fields)=>{globalThis.form={title,fields};return {parent:'tank',name:'media',preset:'generic',compression:'lz4',quotaGiB:'0'};};operation=async value=>{globalThis.submitted=value;};",ctx);
 await vm.runInContext("action('dataset-create')",ctx);assert.equal(ctx.submitted.type,'dataset.create');assert.equal(ctx.submitted.parent,'tank');assert.equal(ctx.form.title,'Create dataset');
 ctx.data={zfs:{available:false,reason:'ZFS is unavailable on this host',datasets:[]}};await assert.rejects(vm.runInContext("action('dataset-create')",ctx),/ZFS is unavailable/);
 ctx.data={zfs:{available:true,datasets:[]}};await assert.rejects(vm.runInContext("action('dataset-create')",ctx),/Create or import a ZFS pool/);
});
test('disk labels and disabled reasons are escaped in the existing dialog controls',async()=>{const ctx=await context();ctx.field={name:'diskIds',label:'Disks',choices:[{value:'<id>',label:'<script>host</script>',disabled:true,reason:'<img onerror=bad>'}]};const markup=vm.runInContext('formField(field,{})',ctx);assert.doesNotMatch(markup,/<script>|<img /);assert.match(markup,/type="checkbox"[^>]*disabled/);});

test('a post-operation inventory refresh failure cannot hide the approved operation result',async()=>{
 const ctx=await context();ctx.document.querySelectorAll=()=>[];ctx.approveStoragePreview=async()=>({filesystemIds:['created']});vm.runInContext("api=async()=>({id:'preview'});load=async()=>{throw Error('Inventory refresh unavailable');};enhance=async()=>{};",ctx);
 assert.deepEqual(plain(await vm.runInContext("operation({type:'pool.create'})",ctx)),{filesystemIds:['created']});ctx.approveStoragePreview=async()=>{throw Error('Approval cancelled');};await assert.rejects(vm.runInContext("operation({type:'pool.create'})",ctx),/Approval cancelled/);
});
