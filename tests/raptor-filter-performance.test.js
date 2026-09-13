'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {performance}=require('perf_hooks');
const response=require('../gui/crossover-response.js');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const crossoverJs=read('gui/crossover-filter.js');
const magJs=read('gui/mag-phase-gd-filter.js');
const targetJs=read('gui/target-export.js');
const html=read('gui/index.html');

function principalRad(value){
  return Math.atan2(Math.sin(value),Math.cos(value));
}

function legacyDelta(type,frequencyHz,cutoffHz,slopeDbOct,sampleRateHz){
  const f=Math.min(frequencyHz,sampleRateHz/2*(1-1e-12));
  const butterworthOrder=slopeDbOct/12;
  const warped=2*sampleRateHz*Math.tan(Math.PI*f/sampleRateHz);
  const omegaC=2*sampleRateHz*Math.tan(Math.PI*cutoffHz/sampleRateHz);
  let logMagnitude=0;
  let phase=0;

  for(let k=0;k<butterworthOrder;k++){
    const theta=Math.PI*(2*k+butterworthOrder+1)/(2*butterworthOrder);
    const poleRe=omegaC*Math.cos(theta);
    const poleIm=omegaC*Math.sin(theta);
    const denRe=-poleRe;
    const denIm=warped-poleIm;
    const numRe=type==='lowpass'?-poleRe:0;
    const numIm=type==='lowpass'?-poleIm:warped;
    logMagnitude+=Math.log(Math.hypot(numRe,numIm))-Math.log(Math.hypot(denRe,denIm));
    phase+=Math.atan2(numIm,numRe)-Math.atan2(denIm,denRe);
  }

  return {
    magnitudeDb:(40/Math.LN10)*logMagnitude,
    phaseRad:principalRad(2*phase)
  };
}

for(const type of ['lowpass','highpass']){
  for(const slope of [12,24,48,96,192]){
    const edge=response.compileEdge(type,1234,slope,96000);
    for(const frequency of [20,80,1234,5000,20000,47999]){
      const expected=legacyDelta(type,frequency,1234,slope,96000);
      const actual=response.responseAt(edge,frequency);
      assert.ok(Math.abs(actual.magnitudeDb-expected.magnitudeDb)<1e-10);
      assert.ok(Math.abs(principalRad(actual.phaseRad-expected.phaseRad))<1e-10);
    }
  }
}

const points=16384;
const frequency=new Float64Array(points);
for(let i=0;i<points;i++) frequency[i]=20*Math.pow(1000,i/(points-1));
const magnitude=new Float64Array(points);
const phase=new Float64Array(points);
const filters=[
  {type:'highpass',frequencyHz:80,slopeDbOct:24},
  {type:'bandpass',lowFrequencyHz:80,highFrequencyHz:1800,highpassSlopeDbOct:24,lowpassSlopeDbOct:24},
  {type:'lowpass',frequencyHz:1800,slopeDbOct:24}
];
const compiled=filters.map(filter=>response.compileFilter(filter,96000));
const start=performance.now();
for(const filter of compiled) response.applyToViews(filter,frequency,magnitude,phase);
const elapsed=performance.now()-start;
assert.ok(elapsed<500,'Compiled 3-filter response unexpectedly slow: '+elapsed.toFixed(2)+' ms');

assert.match(crossoverJs,/const outputCache=new Map\(\);/);
assert.match(crossoverJs,/const cached=outputCache\.get\(filter\.id\);\s*if\(cached\) return cached;/);
assert.match(crossoverJs,/for\(const affectedId of affectedFilterIds\) outputCache\.delete\(affectedId\);/);
assert.match(crossoverJs,/crossoverResponse\.compileFilter\(filter,fs\)/);
assert.match(crossoverJs,/crossoverResponse\.applyToViews\(compiled,frequency,magnitude,phase\)/);

assert.match(magJs,/const outputCache=new Map\(\);/);
assert.match(magJs,/function sourceEntry\(filter,includeCanonical=true\)/);
assert.match(magJs,/function sourceColor\(filter\)\{\s*return sourceEntry\(filter,false\)/);
assert.match(magJs,/function renderConnections\(\)[\s\S]*?const entry=sourceEntry\(filter,false\);/);
assert.match(magJs,/function applyNodeLineage\(node,filter\)[\s\S]*?const entry=sourceEntry\(filter,false\);/);

const applyLineage=targetJs.slice(
  targetJs.indexOf('function applyLineage'),
  targetJs.indexOf('function connectInput')
);
assert.doesNotMatch(applyLineage,/combinedTarget|getOutput/);
assert.match(targetJs,/function filterSource\(id,includeCanonical=false\)/);
assert.match(targetJs,/canonical:includeCanonical\?\(xo\.getOutput/);
assert.match(targetJs,/canonical:includeCanonical\?\(mpgd\.getOutput/);
assert.match(targetJs,/const phaseSource=sourceForRole\(item,'phase',true\);/);
assert.match(targetJs,/const magnitudeSource=sourceForRole\(item,'magnitude',true\);/);
assert.match(html,/crossover-response\.js\?v=compiled-lr-cache-20260913-1/);

console.log('RAPTOR filter performance contract PASS · 3 x 16384 first-run '+elapsed.toFixed(2)+' ms');
