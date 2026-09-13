'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const pipelineCss=read('gui/pipeline.css');
const pipelineJs=read('gui/pipeline.js');
const indexHtml=read('gui/index.html');
const workspaceCss=read('gui/workspace.css');
const pipelineInteractionsCss=read('gui/pipeline-interactions.css');
const crossoverCss=read('gui/crossover-filter.css');
const crossoverJs=read('gui/crossover-filter.js');
const mpgdCss=read('gui/mag-phase-gd-filter.css');
const mpgdJs=read('gui/mag-phase-gd-filter.js');
const targetCss=read('gui/target-export.css');
const typographyCss=read('gui/typography.css');

assert.match(pipelineCss,/\.measurement-preview\{[^}]*width:min\(1196px,calc\(100vw - 28px\)\)/);
assert.match(pipelineCss,/\.pipeline-strip \.pipeline-card\{[^}]*grid-template-columns:max-content 44px;/);
assert.match(pipelineCss,/\.measurement-node\{[^}]*width:min\(248px,calc\(100vw - 48px\)\);min-width:0;max-width:none/);
assert.match(pipelineCss,/\.measurement-list\{width:100%;min-width:0;/);
assert.match(pipelineCss,/\.measurement-file\{[^}]*width:100%;min-width:0;[^}]*grid-template-columns:13px minmax\(0,1fr\) 20px;/);
assert.match(pipelineCss,/\.measurement-node\.is-selecting \.measurement-file\{grid-template-columns:13px 13px minmax\(0,1fr\) 20px\}/);
assert.match(pipelineCss,/\.measurement-file-info\{width:100%;min-width:0;max-width:none;[^}]*align-items:flex-start;text-align:left;/);
assert.match(pipelineInteractionsCss,/\.measurement-file\{[^}]*width:100%;min-width:0;max-width:100%;grid-template-columns:13px minmax\(0,1fr\) 20px;padding-right:26px/);
assert.match(pipelineInteractionsCss,/\.measurement-node\.is-selecting \.measurement-file\{grid-template-columns:13px 13px minmax\(0,1fr\) 20px\}/);
assert.match(pipelineInteractionsCss,/\.measurement-file-check,\.measurement-color,\.measurement-file-info,\.measurement-preview-button\{grid-column:auto\}/);
assert.doesNotMatch(pipelineInteractionsCss,/\.measurement-file\{[^}]*width:max-content/);
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
assert.match(indexHtml,/pipeline\.css\?v=smart-filter-create-20260913-1/);
assert.match(indexHtml,/workspace\.css\?v=welcome-canvas-no-art-20260913-1/);
assert.match(indexHtml,/pipeline-interactions\.css\?v=compact-measurement-rows-20260912-1/);
assert.match(indexHtml,/pipeline\.js\?v=readable-preview-type-20260913-1/);
assert.match(indexHtml,/typography\.css\?v=readable-ui-20260913-1/);
assert.match(indexHtml,/<section class="page-view" data-view="welcome" hidden><\/section>/);
assert.doesNotMatch(indexHtml,/welcome-raptor|raptor-welcome-v1\.png/);
assert.match(workspaceCss,/\.workspace-canvas\[data-page="welcome"\]\{background:radial-gradient\(ellipse at 14% 12%,rgba\(216,190,67,\.16\)/);
assert.match(workspaceCss,/\.workspace-canvas\[data-page="welcome"\]::before\{opacity:\.82;[^}]*background-size:24px 24px,96px 96px,6px 6px,6px 6px/);
assert.doesNotMatch(workspaceCss,/\.welcome-raptor\{|\.welcome-hero\{/);

for(const source of [crossoverCss,mpgdCss]){
  assert.match(source,/--lineage-tint:rgba\(143,166,184,\.24\)/);
  assert.match(source,/--lineage-tint-soft:rgba\(143,166,184,\.12\)/);
}
for(const source of [crossoverJs,mpgdJs]){
  assert.match(source,/hexTint\(color,\.24\)/);
  assert.match(source,/hexTint\(color,\.12\)/);
}
assert.match(targetCss,/var\(--source-color\) 22%,#fff/);
assert.match(typographyCss,/--raptor-font-ui:system-ui,[^;]*"Noto Sans Thai",[^;]*"Leelawadee UI",Thonburi,Tahoma/);
assert.match(typographyCss,/\.workspace-shell \.measurement-file-name\{font-size:10\.5px/);
assert.match(typographyCss,/\.workspace-shell \.mpgd-phase-turn-panel\{font-size:9px/);
assert.match(pipelineJs,/getComputedStyle\(preview\)\.fontFamily/);
assert.doesNotMatch(typographyCss,/@import|@font-face|fonts\.googleapis/);

console.log('RESULT RAPTOR pipeline visual contract PASS');
