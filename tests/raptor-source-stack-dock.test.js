'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const html=read('gui/index.html');
const css=read('gui/pipeline.css');
const interactions=read('gui/pipeline-interactions.css');
const js=read('gui/pipeline.js');
const bankJs=read('gui/bank-file.js');

assert.match(html,/class="pipeline-source-stack" id="pipelineSourceStack"[\s\S]*?id="bankFileNode"[\s\S]*?id="measurementNode"[\s\S]*?<\/div>\s*<\/div>\s*<div class="pipeline-canvas-controls"/);
assert.match(html,/class="source-stack-toggle" id="sourceStackToggle"/);
assert.match(css,/\.pipeline-source-stack\{[^}]*display:flex;flex-direction:column;[^}]*transition:left 210ms/);
assert.match(css,/\.bank-file-node\{[^}]*position:relative;[^}]*border-radius:8px 8px 0 0/);
assert.match(css,/\.measurement-node\{[^}]*position:relative;[^}]*margin-top:-1px;[^}]*border-radius:0 0 8px 8px/);
assert.match(interactions,/\.measurement-node\{[^}]*border-radius:0 0 8px 8px/);

assert.match(js,/const SOURCE_STACK_VISIBLE_WIDTH=84/);
assert.match(js,/nodeCanvas\.scrollLeft\/zoom-width\+SOURCE_STACK_VISIBLE_WIDTH/);
assert.match(js,/bankFile:\{position:null,collapsed:false\}/);
assert.match(js,/bankSource\.collapsed===true/);
assert.match(js,/state\.nodes\.measurement\.position=\{x:position\.x,y:position\.y\+bankHeight\}/);
assert.match(js,/sourceStack\.classList\.toggle\('is-collapsed',next\)/);
assert.match(js,/applySourceStackCollapsed\(collapsed,\{animate:true\}\)/);
assert.match(js,/raptor:pipelineobstacleschange/);
assert.match(js,/openMeasurementPreview:openPreview/);
assert.match(bankJs,/className='measurement-preview-button bank-file-preview'/);

console.log('RAPTOR source stack dock contract PASS');
