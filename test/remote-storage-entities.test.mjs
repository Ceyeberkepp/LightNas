import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteStorage} from '../src/storage-agent/remote-storage.js';

test('ESXi href decoding preserves nested entities and decodes only one layer', async () => {
  const links = [
    ['a&amp;lt;b.iso', 'a&lt;b.iso'],
    ['a&amp;gt;b.iso', 'a&gt;b.iso'],
    ['a&amp;quot;b.iso', 'a&quot;b.iso'],
    ['a&amp;amp;b.iso', 'a&amp;b.iso'],
    ['a&amp;b.iso', 'a&b.iso'],
    ['a&lt;b.iso', 'a<b.iso'],
    ['a&apos;b.iso', "a'b.iso"],
  ];
  const remote = new RemoteStorage(async url => url.pathname === '/sdk'
    ? '<RetrieveServiceContentResponse><apiType>HostAgent</apiType></RetrieveServiceContentResponse>'
    : 'Index of datastore ' + links.map(([encoded]) => `<a href="/folder/${encoded}?dsName=data&amp;dcPath=ha-datacenter">file</a>`).join(''));
  const listing = await remote.list('esxi', {server:'esxi.example', datastore:'data', username:'test'}, {password:'test'}, 'iso');
  assert.deepEqual(listing.entries.map(entry => entry.name), links.map(([, decoded]) => decoded));
});
