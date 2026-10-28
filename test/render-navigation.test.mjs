import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const renderSource = source.slice(source.indexOf('function render(view) {'), source.indexOf('function openMigrationWizardWindow()'));

test('render updates every navigation item and reaches action binding', () => {
  const classes = () => ({values:new Map(), toggle(name, value) {this.values.set(name,value);}});
  const links = ['home','storage','files'].map(view=>({dataset:{view},classList:classes()}));
  const marker = {classList:classes(),closest:()=>({setAttribute(){}})};
  const content = {dataset:{},classList:classes(),focus(){},querySelectorAll(){return [];},innerHTML:''};
  let bound = 0;
  const sandbox = vm.createContext({
    state:{view:'home',uiMode:'nas',runtimes:{docker:{},virtualization:{},catalog:[]}},
    window:{LIGHTNAS_PRODUCT_MODE:'nas'},
    $:selector=>selector==='#content'?content:marker,
    $$:()=>links,
    canView:()=>true,
    homeView:()=>'<h1>Overview</h1>',
    applyWorkspaceMode(){},
    bindViewActions(){bound++;}
  });
  vm.runInContext(renderSource+';render("home");',sandbox);
  assert.equal(content.dataset.currentView,'home');
  assert.equal(content.innerHTML,'<h1>Overview</h1>');
  assert.equal(bound,1,'page controls must be bound after navigation updates');
  assert.equal(links[0].classList.values.get('active'),true);
  assert.equal(links[1].classList.values.get('active'),false);
  assert.equal(links[2].classList.values.get('active'),false);
});
