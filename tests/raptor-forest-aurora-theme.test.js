'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const html=read('gui/index.html');
const css=read('gui/forest-aurora.css');
const js=read('gui/pipeline-workspace-theme.js');

const typographyIndex=html.indexOf('typography.css?v=independent-bank-reverse-wire-20260914-1');
const forestIndex=html.indexOf('forest-aurora.css?v=forest-aurora-20260915-1');
assert.ok(typographyIndex>=0&&forestIndex>typographyIndex,'Forest Aurora must be the final stylesheet layer');
assert.match(html,/pipeline-workspace-theme\.js\?v=forest-aurora-20260915-1/);

assert.match(css,/--fa-canvas:#edf3ef/);
assert.match(css,/body\.is-pipeline-dark-theme\{[\s\S]*?--fa-canvas:#0b1110/);
assert.match(css,/radial-gradient\(ellipse at 7% 1%,rgba\(231,111,36,\.20\)/);
for(const selector of ['bank-file-node','measurement-node','xo-filter-node','mpgd-filter-node','target-export-node']){
  assert.ok(css.includes('.'+selector),selector+' is missing from Forest Aurora');
}
assert.match(css,/\.mpgd-autoeq-window/);
assert.match(css,/\.pipeline-context-menu/);
assert.doesNotMatch(css,/\banimation\s*:/);
assert.doesNotMatch(css,/backdrop-filter/);

assert.match(js,/const workspace=canvas\?\.closest\('\.workspace-canvas'\)\|\|null/);
assert.match(js,/workspace\?\.classList\.toggle\('is-pipeline-dark-theme',dark\)/);
assert.match(js,/document\.body\.classList\.toggle\('is-pipeline-dark-theme',dark\)/);
assert.match(js,/document\.documentElement\.style\.colorScheme=dark\?'dark':'light'/);
assert.match(js,/raptor\.pipeline\.canvas\.theme\.v1/);
assert.match(js,/canvas\.classList\.toggle\('is-dark-canvas',dark\)/);
assert.match(js,/controls\.classList\.toggle\('is-dark-mode',dark\)/);

console.log('RESULT RAPTOR Forest Aurora theme PASS');
