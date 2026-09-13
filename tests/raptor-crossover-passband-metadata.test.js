'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const metadata=require('../gui/crossover-passband-metadata.js');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

const source={format:'raptor.measurement.canonical.v1'};
const hp={id:'hp-1',type:'highpass',frequencyHz:80,slopeDbOct:24};
const bp={
  id:'bp-1',type:'bandpass',lowFrequencyHz:100,highFrequencyHz:1800,
  highpassSlopeDbOct:48,lowpassSlopeDbOct:96
};
const lp={id:'lp-1',type:'lowpass',frequencyHz:1600,slopeDbOct:192};

const hpHistory=metadata.append(source,hp,{model:'LINKWITZ_RILEY_BILINEAR_V1'});
assert.strictEqual(hpHistory.length,1);
assert.strictEqual(hpHistory[0].highpass_cutoff_hz,80);
assert.strictEqual(hpHistory[0].highpass_slope_db_oct,24);
assert.strictEqual(hpHistory[0].lowpass_cutoff_hz,null);

const afterHp={...source,[metadata.HISTORY_KEY]:hpHistory};
const bpHistory=metadata.append(afterHp,bp,{model:'LINKWITZ_RILEY_BILINEAR_V1'});
const afterBp={...source,[metadata.HISTORY_KEY]:bpHistory};
const fullHistory=metadata.append(afterBp,lp,{model:'LINKWITZ_RILEY_BILINEAR_V1'});
const output={...source,[metadata.HISTORY_KEY]:fullHistory};

assert.strictEqual(fullHistory.length,3);
assert.strictEqual(fullHistory[1].highpass_cutoff_hz,100);
assert.strictEqual(fullHistory[1].highpass_slope_db_oct,48);
assert.strictEqual(fullHistory[1].lowpass_cutoff_hz,1800);
assert.strictEqual(fullHistory[1].lowpass_slope_db_oct,96);
assert.strictEqual(fullHistory[2].lowpass_cutoff_hz,1600);
assert.strictEqual(fullHistory[2].lowpass_slope_db_oct,192);

const range=metadata.effectiveRange(output,{minHz:20,maxHz:20000});
const hp24Guard=metadata.transitionGuardRatio(24);
const hp48Guard=metadata.transitionGuardRatio(48);
const lp96Guard=metadata.transitionGuardRatio(96);
const lp192Guard=metadata.transitionGuardRatio(192);
assert.strictEqual(metadata.DEFAULT_PASSBAND_SETTLE_DB,.5);
assert.ok(hp24Guard>hp48Guard&&hp48Guard>lp96Guard&&lp96Guard>lp192Guard&&lp192Guard>1);
assert.ok(Math.abs(range.fromHz-Math.max(80*hp24Guard,100*hp48Guard))<1e-9);
assert.ok(Math.abs(range.toHz-Math.min(1800/lp96Guard,1600/lp192Guard))<1e-9);
assert.deepStrictEqual(
  {
    rawFromHz:range.rawFromHz,
    rawToHz:range.rawToHz,
    valid:range.valid,
    filterCount:range.filterCount,
    insetAppliedCount:range.insetAppliedCount
  },
  {rawFromHz:100,rawToHz:1600,valid:true,filterCount:3,insetAppliedCount:4}
);
assert.ok(range.fromHz>range.rawFromHz);
assert.ok(range.toHz<range.rawToHz);

const untouched=metadata.effectiveRange(source,{minHz:20,maxHz:20000});
assert.deepStrictEqual(
  {fromHz:untouched.fromHz,toHz:untouched.toHz,appliedCount:untouched.appliedCount},
  {fromHz:20,toHz:20000,appliedCount:0}
);
assert.deepStrictEqual(
  metadata.effectiveRange(source),
  {
    fromHz:10,toHz:20000,rawFromHz:10,rawToHz:20000,valid:true,
    appliedCount:0,insetAppliedCount:0,settleDb:.5,filterCount:0,history:[]
  }
);

const impossible={
  [metadata.HISTORY_KEY]:[
    metadata.recordForFilter({id:'hp-x',type:'highpass',frequencyHz:2000,slopeDbOct:24}),
    metadata.recordForFilter({id:'lp-x',type:'lowpass',frequencyHz:1000,slopeDbOct:24})
  ]
};
assert.strictEqual(metadata.effectiveRange(impossible).valid,false);

const crossoverJs=read('gui/crossover-filter.js');
const autoEqJs=read('gui/mag-phase-gd-autoeq.js');
const html=read('gui/index.html');
assert.match(crossoverJs,/output\[passbandMetadata\.HISTORY_KEY\]=passbandMetadata\.append\(source,filter,\{model:MODEL\}\)/);
assert.match(autoEqJs,/passbandMetadata\.effectiveRange\(canonical,\{minHz:10,maxHz:maximum\}\)/);
assert.match(autoEqJs,/value="10" data-autoeq-fmin/);
assert.match(autoEqJs,/from\.value=inputFrequency\(range\.fromHz\)/);
assert.match(autoEqJs,/to\.value=inputFrequency\(range\.toHz\)/);
assert.match(html,/crossover-passband-metadata\.js\?v=xo-safe-range-20260913-1/);

console.log('RAPTOR crossover passband metadata contract PASS');
