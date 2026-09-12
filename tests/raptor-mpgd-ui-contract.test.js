'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const layout=require('../gui/mag-phase-gd-band-layout.js');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const js=read('gui/mag-phase-gd-filter.js');
const css=read('gui/mag-phase-gd-filter.css');
const html=read('gui/index.html');

const close=(actual,expected,tolerance=1e-9)=>{
  assert.ok(Math.abs(actual-expected)<=tolerance,actual+' != '+expected);
};

close(layout.nextFrequency([],{minFrequencyHz:20,maxFrequencyHz:20000,preferredFrequencyHz:1000}),1000);
const second=layout.nextFrequency([1000],{minFrequencyHz:20,maxFrequencyHz:20000,preferredFrequencyHz:1000});
close(second,Math.sqrt(20*1000));
const third=layout.nextFrequency([1000,second],{minFrequencyHz:20,maxFrequencyHz:20000,preferredFrequencyHz:1000});
close(third,Math.sqrt(1000*20000));

const progressive=[];
for(let i=0;i<16;i++){
  const frequency=layout.nextFrequency(progressive,{minFrequencyHz:20,maxFrequencyHz:20000,preferredFrequencyHz:1000});
  assert.ok(frequency>=20&&frequency<=20000);
  assert.ok(progressive.every(existing=>Math.abs(existing-frequency)>1e-9));
  progressive.push(frequency);
}

assert.match(js,/const readoutKinds=ui\.sync===false\?\[kind\]:\['phase','magnitude'\];/);
assert.match(js,/setTraceReadout\(win,targetKind,f,phase,mag\);/);
assert.match(js,/if\(readout\) readout\.textContent='—';/);
assert.match(js,/title\.textContent=kind==='phase'\?'PHASE BANDS':'MAG BANDS';/);
assert.doesNotMatch(js,/PHASE LIFT BANDS/);
assert.match(js,/add\.className='mpgd-band-rack-add';/);
assert.match(js,/add\.textContent='Add Band';/);
assert.match(js,/gainDb:0,\s*q:1\.41421356,/);
assert.match(js,/UNCERTAINTY_NEEDLE_MAX_HEIGHT=GRAPH_HEIGHT\*\.46/);
assert.match(js,/UNCERTAINTY_NEEDLE_MIN_SPACING=7/);
assert.match(js,/UNCERTAINTY_CONFIDENCE_FLOOR=\.55/);
assert.match(css,/\.mpgd-filter-svg--mag \.uncertainty-needles\{[\s\S]*?stroke:rgba\(210,48,48,\.52\);[\s\S]*?stroke-width:1\.7;/);
assert.match(css,/\.mpgd-band-rack-add\{/);
assert.match(html,/mag-phase-gd-band-layout\.js\?v=progressive-log-spread-20260912-1/);

console.log('RESULT RAPTOR Mag-Phase-GD UI contract PASS');
