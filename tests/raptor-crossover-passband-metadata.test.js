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
assert.deepStrictEqual(
  {fromHz:range.fromHz,toHz:range.toHz,valid:range.valid,filterCount:range.filterCount},
  {fromHz:100,toHz:1600,valid:true,filterCount:3}
);

const untouched=metadata.effectiveRange(source,{minHz:20,maxHz:20000});
assert.deepStrictEqual(
  {fromHz:untouched.fromHz,toHz:untouched.toHz,appliedCount:untouched.appliedCount},
  {fromHz:20,toHz:20000,appliedCount:0}
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
assert.match(autoEqJs,/passbandMetadata\.effectiveRange\(canonical,\{minHz:20,maxHz:maximum\}\)/);
assert.match(autoEqJs,/from\.value=inputFrequency\(range\.fromHz\)/);
assert.match(autoEqJs,/to\.value=inputFrequency\(range\.toHz\)/);
assert.match(html,/crossover-passband-metadata\.js\?v=crossover-history-20260913-1/);

console.log('RAPTOR crossover passband metadata contract PASS');
