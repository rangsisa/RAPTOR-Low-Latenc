'use strict';

const assert=require('assert');
const rangeApi=require('../gui/mag-phase-gd-graph-range.js');

const close=(actual,expected,tolerance=1e-9)=>{
  assert.ok(Math.abs(actual-expected)<=tolerance,actual+' != '+expected);
};

assert.deepStrictEqual(rangeApi.DEFAULTS,{
  amplitudeDb:40,
  minFrequencyHz:10,
  maxFrequencyHz:20000
});

const defaults=rangeApi.normalize();
assert.deepStrictEqual(defaults,rangeApi.DEFAULTS);
assert.notStrictEqual(defaults,rangeApi.DEFAULTS);
assert.strictEqual(rangeApi.normalize(defaults),defaults);
assert.deepStrictEqual(rangeApi.normalize({amplitudeDb:'',minFrequencyHz:'',maxFrequencyHz:''}),rangeApi.DEFAULTS);

const custom=rangeApi.normalize({
  amplitudeDb:80,
  minFrequencyHz:5,
  maxFrequencyHz:40000
});
assert.deepStrictEqual(custom,{amplitudeDb:80,minFrequencyHz:5,maxFrequencyHz:40000});
close(rangeApi.xOf(5,custom,1000),0);
close(rangeApi.xOf(40000,custom,1000),1000);
close(rangeApi.frequencyAtRatio(0,custom),5);
close(rangeApi.frequencyAtRatio(1,custom),40000);
close(rangeApi.frequencyAtRatio(.5,custom),Math.sqrt(5*40000));

close(rangeApi.yMagnitude(80,custom,220),0);
close(rangeApi.yMagnitude(0,custom,220),110);
close(rangeApi.yMagnitude(-80,custom,220),220);
close(rangeApi.yMagnitude(160,custom,220),0);
close(rangeApi.yMagnitude(160,custom,220,false),-110);
assert.deepStrictEqual(rangeApi.magnitudeTicks(custom),[80,40,0,-40,-80]);

const ticks=rangeApi.frequencyTicks(defaults);
assert.strictEqual(ticks[0],10);
assert.strictEqual(ticks[ticks.length-1],20000);
assert.ok(ticks.includes(20));
assert.ok(ticks.includes(1000));
assert.ok(ticks.every((value,index)=>index===0||value>ticks[index-1]));

assert.deepStrictEqual(
  rangeApi.normalize({amplitudeDb:0,minFrequencyHz:100,maxFrequencyHz:10}),
  {amplitudeDb:1,minFrequencyHz:10,maxFrequencyHz:20000}
);

console.log('RESULT RAPTOR Mag-Phase-GD graph range PASS');
