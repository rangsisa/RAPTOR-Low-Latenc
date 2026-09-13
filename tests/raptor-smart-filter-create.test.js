'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const html=read('gui/index.html');
const css=read('gui/pipeline.css');
const pipeline=read('gui/pipeline.js');
const context=read('gui/pipeline-context.js');

assert.match(html,/id="pipelineCanvasFilterButton"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
assert.match(html,/class="pipeline-canvas-view-controls"/);
assert.match(css,/\.pipeline-canvas-filter-button\{[^}]*left:50%;[^}]*transform:translateX\(-50%\)/);
assert.match(css,/\.pipeline-canvas-controls\{[^}]*left:14px;right:14px;[^}]*pointer-events:none/);
assert.match(pipeline,/function connectSourceToFilter\(filterId,source\)/);
assert.match(pipeline,/function blankCanvasDrop\(clientX,clientY\)/);
assert.match(pipeline,/\.measurement-node,\[data-filter-id\]/);
assert.match(pipeline,/endEvent\.type==='pointerup'/);
assert.match(pipeline,/new CustomEvent\('raptor:pipelinewireblankdrop'/);
assert.match(pipeline,/connectSourceToFilter\s*\n\s*};/);
assert.match(context,/filterButton\?\.addEventListener\('click',openToolbarMenu\)/);
assert.match(context,/document\.addEventListener\('raptor:pipelinewireblankdrop'/);
assert.match(context,/workspaceView\.clientToLogical\(clientX,clientY\)/);
assert.match(context,/connectCreatedFilter\(createdId,current\.source\)/);
assert.match(context,/command\.type!=='target-export'\|\|source\.kind==='filter'/);
assert.match(context,/FILTER_COMMANDS[\s\S]*?lowpass[\s\S]*?highpass[\s\S]*?bandpass[\s\S]*?mag-phase-gd/);

console.log('RAPTOR smart filter create contract PASS');
