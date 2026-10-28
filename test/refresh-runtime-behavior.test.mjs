import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf(`  document.querySelectorAll('#content [data-action="refresh-runtime"]')`);
const end=source.indexOf("  $$('[data-community-install]'",start);
test('Containers refresh reloads both native inventory and application runtimes',async()=>{
 let handler,containers=0,runtimes=0;
 const button={disabled:false,textContent:'↻',addEventListener(type,callback){handler=callback;},setAttribute(){}};
 const sandbox=vm.createContext({document:{querySelectorAll:()=>[button]},$:()=>button,state:{view:'containers'},loadContainers:async()=>{containers++;},loadRuntimes:async refresh=>{assert.equal(refresh,true);runtimes++;},render(){},toast(){}});
 assert.ok(start>=0&&end>start);
 vm.runInContext(source.slice(start,end),sandbox);
 await handler();
 assert.equal(containers,1);assert.equal(runtimes,1);assert.equal(button.disabled,false);
});
