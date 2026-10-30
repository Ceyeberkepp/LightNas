import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

function section(name, next) {
  const begin = license.indexOf(name);
  const end = license.indexOf(next, begin + name.length);
  assert.ok(begin >= 0 && end > begin, 'License section boundaries must exist');
  return license.slice(begin, end);
}

test('LightNAS license clearly requires prior written reverse-engineering consent', () => {
  assert.match(license, /Version 0\.2/);
  const terms = section('8. Reverse Engineering and Written Permission', '9. Contributions');
  assert.match(terms, /prior express written permission/);
  assert.match(terms, /reverse engineer, decompile, disassemble, deobfuscate/);
  assert.match(terms, /unauthorized\s+functional clone through reverse engineering/);
  assert.match(terms, /bypass technical protection measures or access controls/);
  assert.match(terms, /Permission must be specifically granted by Licensor in writing before the\s+activity begins/);
  assert.match(terms, /separate commercial\s+license does not itself constitute permission/);
});

test('restriction preserves expressly permitted source inspection and mandatory rights', () => {
  const grant = section('2. Community Development and Testing Grant', '3. Current Development Status');
  const terms = section('8. Reverse Engineering and Written Permission', '9. Contributions');
  assert.match(grant, /inspect and modify source code made available by Licensor/);
  assert.match(grant, /subject to Section 8/);
  assert.match(terms, /Section 2\(b\)/);
  assert.match(terms, /non-waivable law/);
  assert.match(terms, /Third-Party Components/);
  assert.match(terms, /applicable law does not permit Licensor to restrict by contract/);
});

test('public license summary states the reverse-engineering restriction', () => {
  assert.match(readme, /no reverse engineering, decompilation, disassembly/);
  assert.match(readme, /prior express written permission/);
  assert.match(readme, /Section 8 of the license/);
});
