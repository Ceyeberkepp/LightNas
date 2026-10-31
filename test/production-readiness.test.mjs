import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateProductionReadiness, REQUIRED_PRODUCTION_GATES} from '../scripts/check-production-readiness.mjs';

const read = path => readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const manifest = JSON.parse(read('config/production-readiness.json'));
const workflow = read('.github/workflows/production-release-gate.yml');
const now = new Date('2026-10-30T18:00:00Z');
const tag = 'v1.0.0';
function verifiedFixture() {
  return {
    schemaVersion:1, candidateTag:tag,
    gates:REQUIRED_PRODUCTION_GATES.map(id=>({
      id, status:'verified', reviewer:'Named Release Reviewer',
      verifiedAt:'2026-10-29T12:00:00Z',
      evidence:[{url:'https://github.com/Ceyeberkepp/LightNas/actions/runs/1',
        summary:'Reviewed lab evidence showing the required test and result.'}]
    }))
  };
}
const check = value => evaluateProductionReadiness(value,{releaseTag:tag,now});

test('production release remains blocked by default with all mandatory gates listed',()=>{
  assert.equal(manifest.schemaVersion,1);
  assert.equal(manifest.candidateTag,null);
  assert.deepEqual(manifest.gates.map(g=>g.id),[...REQUIRED_PRODUCTION_GATES]);
  assert.ok(manifest.gates.every(g=>g.status==='blocked' && g.evidence.length===0));
  assert.equal(check(manifest).ready,false);
});

test('evidence metadata checks fail closed for missing, stale and inconsistent evidence',()=>{
  const fixture=verifiedFixture();
  assert.equal(check(fixture).ready,true,'metadata-only fixture is structurally complete, NOT an actual release approval');
  const changed=[
    f=>{f.candidateTag='v2.0.0';},
    f=>{f.gates.pop();},
    f=>{f.gates.push(f.gates[0]);},
    f=>{f.gates[0].status='blocked';},
    f=>{f.gates[0].reviewer='';},
    f=>{f.gates[0].verifiedAt='2020-01-01T00:00:00Z';},
    f=>{f.gates[0].verifiedAt='2027-01-01T00:00:00Z';},
    f=>{f.gates[0].evidence=[];},
    f=>{f.gates[0].evidence[0].url='http://example.org/invalid';},
    f=>{f.gates[0].evidence[0].summary='';}
  ];
  for(const change of changed){
    const item=structuredClone(fixture);
    change(item);
    assert.equal(check(item).ready,false,'invalid release metadata must not be accepted');
  }
  assert.equal(evaluateProductionReadiness(fixture,{releaseTag:'main',now}).ready,false);
});

test('production workflow never publishes artifacts and requires full tests, audit and human evidence',()=>{
  assert.match(workflow,/tags:\s*\n\s*- 'v\*'/);
  assert.match(workflow,/npm test/);
  assert.match(workflow,/npm run check:platform/);
  assert.match(workflow,/npm audit --omit=dev --audit-level=high/);
  assert.match(workflow,/node scripts\/check-production-readiness\.mjs --tag "\$RELEASE_TAG"/);
  assert.doesNotMatch(workflow,/continue-on-error:\s*true/);
  assert.doesNotMatch(workflow,/gh release create|actions\/upload-release-asset|docker push/);
});
