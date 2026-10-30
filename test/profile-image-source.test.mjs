import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/profile-image-source.js', import.meta.url), 'utf8');
class ImageElement { src = ''; }
const context = vm.createContext({URL, HTMLImageElement: ImageElement, window: {location: new URL('https://nas.example')}});
vm.runInContext(source.replace('export function', 'function'), context);
const assign = context.setProfileImageSource;
test('profile previews accept the avatar endpoint and same-origin object URLs', () => {
  for (const url of ['/api/profile/avatar?v=123', 'blob:https://nas.example/example']) {
    const image = new ImageElement();
    assign(image, url);
    assert.equal(image.src, new URL(url, 'https://nas.example').href);
  }
});
test('profile previews reject non-image targets and untrusted URL forms', () => {
  assert.throws(() => assign({src: ''}, '/api/profile/avatar'), /must be an image/);
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://other.example/api/profile/avatar',
    'blob:https://other.example/example', '/other-page', '//other.example/a',
    'https://user:pass@nas.example/api/profile/avatar', 'http://nas.example/api/profile/avatar']) {
    const image = new ImageElement();
    assert.throws(() => assign(image, url), /Unsupported/);
    assert.equal(image.src, '');
  }
});
