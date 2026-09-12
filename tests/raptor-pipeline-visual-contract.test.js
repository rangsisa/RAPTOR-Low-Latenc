'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const pipelineCss=read('gui/pipeline.css');
const pipelineJs=read('gui/pipeline.js');
const indexHtml=read('gui/index.html');
const crossoverCss=read('gui/crossover-filter.css');
const crossoverJs=read('gui/crossover-filter.js');
const mpgdCss=read('gui/mag-phase-gd-filter.css');
const mpgdJs=read('gui/mag-phase-gd-filter.js');
const targetCss=read('gui/target-export.css');

assert.match(pipelineCss,/\.measurement-preview\{[^}]*width:min\(1196px,calc\(100vw - 28px\)\)/);
assert.match(pipelineCss,/\.pipeline-strip \.pipeline-card\{[^}]*grid-template-columns:max-content 44px;/);
assert.match(pipelineCss,/\.measurement-node\{[^}]*width:max-content;[^}]*max-width:min\(320px,calc\(100vw - 48px\)\)/);
assert.match(pipelineCss,/\.measurement-preview-graph\{[^}]*height:min\(300px,calc\(100vh - 152px\)\)/);
assert.match(pipelineCss,/\.measurement-preview-meta\{[^}]*grid-template-columns:repeat\(5,max-content\);justify-content:center;/);
assert.match(pipelineCss,/\.measurement-preview-meta div\{[^}]*justify-content:flex-start;/);
assert.match(pipelineCss,/\.measurement-preview-head\{[^}]*cursor:grab;user-select:none;touch-action:none/);
assert.match(pipelineCss,/\.measurement-preview\.is-dragging \.measurement-preview-head\{cursor:grabbing\}/);
assert.match(pipelineCss,/@media\(max-width:700px\)\{\s*\.measurement-preview\{[^}]*width:calc\(100vw - 10px\)/);
assert.match(pipelineCss,/@media\(max-width:700px\)[\s\S]*?\.measurement-preview-graph\{height:min\(240px,calc\(100vh - 142px\)\)\}/);
assert.match(pipelineCss,/@media\(max-width:700px\)[\s\S]*?\.measurement-preview-meta\{grid-template-columns:repeat\(2,max-content\);justify-content:start;/);
assert.match(pipelineJs,/hexTint\(entry\.color,\.22\)/);
assert.match(pipelineJs,/const graphScale=Math\.max\(1,Math\.min\(1\.55,/);
assert.match(pipelineJs,/const previewMinFrequencyHz=20;/);
assert.match(pipelineJs,/const previewMaxFrequencyHz=20000;/);
assert.match(pipelineJs,/const magnitudeFill=ctx\.createLinearGradient\(0,T,0,B\);/);
assert.match(pipelineJs,/magnitudeFill\.addColorStop\(0,hexTint\(previewColor,\.28\)\)/);
assert.match(pipelineJs,/function clampPreviewPosition\(left,top\)/);
assert.match(pipelineJs,/function startPreviewDrag\(event\)/);
assert.match(pipelineJs,/previewHead\.addEventListener\('pointerdown',startPreviewDrag\)/);
assert.doesNotMatch(pipelineJs,/20000,50000/);
assert.match(indexHtml,/pipeline\.css\?v=preview-drag-color-fill-20260912-4/);
assert.match(indexHtml,/pipeline\.js\?v=preview-drag-color-fill-20260912-4/);

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
