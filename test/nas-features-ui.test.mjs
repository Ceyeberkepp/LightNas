import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const data={zfs:{available:true,datasets:[{name:'tank/docs',type:'filesystem',mountpoint:'/mnt/docs',used:100,available:200,encryption:'off',keystatus:'-'}]},protection:{tasks:[],cloudRemotes:[],replicationProfiles:[]},certificates:{certificates:[],requests:[],dnsProfiles:[]}};
async function script(){return (await read('public/nas-features.js')).replace(/^import[^\n]+\n/,'').split('const observer=new MutationObserver')[0];}
test('feature screens use the existing LightNAS panels/cards/dialogs and escape host data',async()=>{
 const context={document:{addEventListener:()=>{}},window:{},fetch:async()=>{},setTimeout};vm.createContext(context);vm.runInContext(await script(),context);
 context.data=data;const markup=vm.runInContext('datasetMarkup(data.zfs)+protectionMarkup(data.protection)+certificatesMarkup(data.certificates)',context);
 for(const label of ['Create dataset','Add volume','Take snapshot','Add','Create CSR','DNS authenticator','ACME certificate'])assert.ok(markup.includes(label));assert.match(markup,/class="panel dataset-card"/);assert.match(markup,/class="storage-row"|class="storage-list"/);assert.doesNotMatch(markup,/TrueNAS|<style|style=/);
 context.evil={available:true,datasets:[{...data.zfs.datasets[0],name:'<script>bad</script>'}]};assert.doesNotMatch(vm.runInContext('datasetMarkup(evil)',context),/<script>/);
 const html=await read('public/index.html');assert.match(html,/type="module" src="\/nas-features.js"/);
});
test('enhancement runs again after existing app replaces its content without adding global navigation',async()=>{
 let host={dataset:{},innerHTML:''};const content={isConnected:true,contains:value=>value===host,querySelector:selector=>selector==='.dataset-workspace'?host:null};
 const context={document:{addEventListener:()=>{},querySelector:selector=>selector==='#content'?content:null},window:{LightNASOverview:{appliance:{role:'administrator'}}},location:{hash:'#pools'},fetch:async()=>({ok:true,json:async()=>data}),setTimeout};vm.createContext(context);vm.runInContext(await script(),context);
 await vm.runInContext('enhance()',context);assert.match(host.innerHTML,/tank\/docs/);const old=host;host={dataset:{},innerHTML:''};await vm.runInContext('enhance()',context);assert.match(host.innerHTML,/tank\/docs/);assert.notEqual(host,old);
});
