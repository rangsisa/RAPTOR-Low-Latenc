'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const pipelineCss=read('gui/pipeline.css');
const pipelineJs=read('gui/pipeline.js');
const crossoverCss=read('gui/crossover-filter.css');
const crossoverJs=read('gui/crossover-filter.js');
const mpgdCss=read('gui/mag-phase-gd-filter.css');
const mpgdJs=read('gui/mag-phase-gd-filter.js');
const targetCss=read('gui/target-export.css');

assert.match(pipelineCss,/\.measurement-preview\{[^}]*width:min\(1196px,calc\(100vw - 28px\)\)/);
assert.match(pipelineCss,/\.pipeline-strip \.pipeline-card\{[^}]*grid-template-columns:max-content 44px;/);
assert.match(pipelineCss,/\.measurement-preview-graph\{[^}]*height:min\(300px,calc\(100vh - 152px\)\)/);
assert.match(pipelineCss,/@media\(max-width:700px\)\{\s*\.measurement-preview\{[^}]*width:calc\(100vw - 10px\)/);
assert.match(pipelineCss,/@media\(max-width:700px\)[\s\S]*?\.measurement-preview-graph\{height:min\(240px,calc\(100vh - 142px\)\)\}/);
assert.match(pipelineJs,/hexTint\(entry\.color,\.22\)/);
assert.match(pipelineJs,/const graphScale=Math\.max\(1,Math\.min\(1\.55,/);
assert.match(pipelineJs,/const previewMinFrequencyHz=20;/);
assert.match(pipelineJs,/const previewMaxFrequencyHz=20000;/);
assert.doesNotMatch(pipelineJs,/20000,50000/);

for(const source of [crossoverCss,mpgdCss]){
  assert.match(source,/--lineage-tint:rgba\(143,166,184,\.24\)/);
  assert.match(source,/--lineage-tint-soft:rgba\(143,166,184,\.12\)/);
}
for(const source of [crossoverJs,mpgdJs]){
  assert.match(source,/hexTint\(color,\.24\)/);
  assert.match(source,/hexTint\(color,\.12\)/);
}
assert.match(targetCss,/var\(--source-color\) 22%,#fff/);

console.log('RESULT RAPTOR pipeline visual contract PASS');
