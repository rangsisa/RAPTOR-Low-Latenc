'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const pipeline=read('gui/pipeline.js');
const bank=read('gui/bank-file.js');
const crossover=read('gui/crossover-filter.js');
const mpgd=read('gui/mag-phase-gd-filter.js');
const target=read('gui/target-export.js');
const pipelineCss=read('gui/pipeline.css');
const crossoverCss=read('gui/crossover-filter.css');
const mpgdCss=read('gui/mag-phase-gd-filter.css');
const targetCss=read('gui/target-export.css');
const context=read('gui/pipeline-context.js');

assert.match(pipeline,/const outputRegistry=new Map\(\)/);
assert.match(pipeline,/function registerOutput\(id,element,options=\{\}\)/);
assert.match(pipeline,/function eligibleRegisteredOutputs\(input\)/);
assert.match(pipeline,/function nearestRegisteredOutput\(clientX,clientY,input\)/);
assert.match(pipeline,/function startReverseWire\(event,inputId,handle\)/);
assert.match(pipeline,/wouldCreateFilterCycle\(source,input\.ownerFilterId\)/);
assert.match(pipeline,/reverseConnect:true/);
assert.match(pipeline,/startReverseWire,\s*routeWire,/);
assert.match(pipeline,/wouldCreateFilterCycle,\s*connectSourceToFilter/);

assert.match(bank,/api\.registerOutput\?\.\('bank:'\+entry\.id/);
assert.match(crossover,/api\.registerOutput\?\.\('xo:'\+filter\.id\+':output'/);
assert.match(mpgd,/api\.registerOutput\?\.\('mpgd:'\+filter\.id\+':output'/);
assert.match(crossover,/api\.startReverseWire\?\.\(event,'xo:'\+filter\.id\+':input',input\)/);
assert.match(mpgd,/api\.startReverseWire\?\.\(event,'mpgd:'\+filter\.id\+':input',input\)/);
assert.match(target,/api\.startReverseWire\?\.\(event,inputRegistryId\(item\.id,'phase'\),phaseInput\)/);
assert.match(target,/api\.startReverseWire\?\.\(event,inputRegistryId\(item\.id,'magnitude'\),magnitudeInput\)/);
assert.match(crossover,/!source\?\.reverseConnect&&filter\.input\?\.id/);
assert.match(mpgd,/!source\.reverseConnect&&filter\.input\?\.id/);

for(const css of [pipelineCss,crossoverCss,mpgdCss]){
  assert.match(css,/\.is-wire-available::after/);
  assert.match(css,/\.is-wire-magnet::after/);
}
assert.match(targetCss,/\.target-export-input\.is-wiring::after/);
assert.match(context,/target-export\.css\?v=independent-bank-reverse-wire-20260914-1/);
assert.match(context,/target-export\.js\?v=independent-bank-reverse-wire-20260914-1/);

console.log('RAPTOR reverse wire contract PASS');
