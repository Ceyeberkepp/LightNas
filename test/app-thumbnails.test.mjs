import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import vm from 'node:vm';
import {AppIconCache,safeIconUrl,iconCandidates,iconType} from '../src/app-icons.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
test('catalog thumbnails reject arbitrary destinations and use catalog/app IDs rather than URL query proxies',()=>{
 for(const value of ['http://127.0.0.1/icon','https://localhost/icon','https://raw.githubusercontent.com:9443/a','https://user:password@raw.githubusercontent.com/a','javascript:alert(1)'])assert.equal(safeIconUrl(value),null);
 assert.ok(safeIconUrl('https://raw.githubusercontent.com/selfhst/icons/main/png/jellyfin.png'));assert.deepEqual(iconCandidates({id:'jellyfin',icon:'https://localhost/secret'}),['https://raw.githubusercontent.com/selfhst/icons/main/png/jellyfin.png']);
});
test('image cache coalesces concurrent downloads, survives new instances and rejects unsafe redirects/content',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nas-icons-'));let fetched=0;const cache=new AppIconCache({dir,fetcher:async()=>{fetched++;return new Response(png,{headers:{'content-type':'image/png'}});}});
 const result=await Promise.all([cache.get({id:'jellyfin'}),cache.get({id:'jellyfin'})]);assert.equal(fetched,1);assert.equal(result[0].contentType,'image/png');assert.deepEqual(result[0].buffer,png);
 const offline=new AppIconCache({dir,fetcher:async()=>{throw Error('offline');}});assert.deepEqual((await offline.get({id:'jellyfin'})).buffer,png);
 const redirected=new AppIconCache({dir:join(dir,'redirected'),fetcher:async()=>new Response(null,{status:302,headers:{location:'https://localhost/secret'}})});assert.equal(await redirected.get({id:'jellyfin'}),null);
 const html=new AppIconCache({dir:join(dir,'html'),fetcher:async()=>new Response('<html>bad</html>')});assert.equal(await html.get({id:'jellyfin'}),null);
 assert.equal(iconType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>bad</script></svg>')),null);
});
test('App Store cards use same-origin lazy thumbnails with fixed size and local fallbacks',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');const code=source.slice(source.indexOf('function appThumbnail('),source.indexOf('function moduleView('));const context={escapeHtml:v=>String(v).replace(/[<>"']/g,'_'),document:{addEventListener:()=>{}}};vm.createContext(context);vm.runInContext(code,context);context.app={id:'jellyfin',name:'Jellyfin'};const markup=vm.runInContext('appThumbnail(app)',context);assert.match(markup,/src="\/api\/catalog\/icon\?id=jellyfin"/);assert.match(markup,/loading="lazy"/);assert.match(markup,/width="48" height="48"/);assert.match(markup,/app-thumbnail-fallback/);assert.ok(source.includes('${appThumbnail(app)}'));
});
