import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('public/app.js');
const design = read('public/design-v2.css');
const html = read('public/index.html');

test('AI composer stays multiline, accessible and connected to existing submit handler', () => {
  assert.match(app, /<textarea name="message" rows="3"[^>]*aria-label="Message LightNAS Assistant"[^>]*required><\/textarea>/);
  assert.match(app, /const aiForm = \$\('\[data-ai-form\]', \$\('#content'\)\)/);
  assert.match(app, /const aiComposer = aiForm\?\.elements\.message/);
  assert.match(app, /aiComposer\.addEventListener\('input', resizeAiComposer\)/);
  assert.match(app, /aiComposer\.style\.height = 'auto'/);
  assert.match(app, /Math\.min\(aiComposer\.scrollHeight, 180\)/);
  assert.match(app, /event\.key === 'Enter' && \(event\.ctrlKey \|\| event\.metaKey\) && !event\.isComposing/);
  assert.match(app, /aiForm\.requestSubmit\(\)/);
  assert.match(app, /aiForm\?\.addEventListener\('submit', event =>/);
  assert.match(app, /state\.aiMessages\.push\(\{ role:'user', text:question \}\)/);
  assert.match(app, /state\.aiMessages\.push\(\{ role:'agent', \.\.\.lightnasAgentReply\(question\) \}\)/);
});

test('AI workspace uses full available desktop height without shrinking conversation', () => {
  assert.match(html, /<link rel="stylesheet" href="\/design-v2\.css">/);
  assert.match(design, /#content\[data-current-view="ai"\] \.ai-workspace-v2 \{[\s\S]*?height:clamp\(540px,calc\(100dvh - 230px\),900px\)/);
  assert.match(design, /#content\[data-current-view="ai"\] \.ai-workspace-v2 \.ai-agent-messages \{[\s\S]*?flex:1 1 auto;[\s\S]*?min-height:0;[\s\S]*?max-height:none;/);
  assert.match(design, /#content\[data-current-view="ai"\] \.ai-workspace-v2 \.ai-agent-form \{[\s\S]*?grid-template-columns:minmax\(0,1fr\) auto;/);
  assert.match(design, /#content\[data-current-view="ai"\] \.ai-workspace-v2 \.ai-agent-form textarea \{[\s\S]*?min-height:86px;[\s\S]*?max-height:180px;/);
});

test('AI chat stacks at narrow workspace widths and keeps Send beside composer', () => {
  assert.match(design, /@container \(max-width:820px\)/);
  assert.match(design, /@media \(max-width:800px\)/);
  assert.match(design, /#content\[data-current-view="ai"\] \.ai-workspace-v2 \.ai-agent-messages \{[\s\S]*?min-height:clamp\(320px,42dvh,560px\)/);
  assert.match(design, /padding-bottom:max\(12px,env\(safe-area-inset-bottom\)\)/);
  const mobile = design.slice(design.lastIndexOf('@media (max-width:800px)'));
  assert.match(mobile, /grid-template-columns:minmax\(0,1fr\) auto;/);
  assert.match(mobile, /\.ai-agent-form button \{[\s\S]*?width:auto;/);
});
