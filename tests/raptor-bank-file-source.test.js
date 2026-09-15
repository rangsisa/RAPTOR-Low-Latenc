'use strict';

const assert=require('assert');
const bank=require('../gui/bank-file-source.js');

const measurementPalette=new Set([
  '#4DA3FF','#FF9F43','#55D187','#A78BFA',
  '#FF6B6B','#36CFC9','#F6C85F','#8FA6B8',
  '#FF2D95','#8BD600','#563CFF'
]);
const expected=[
  {id:'bank-file-48k',name:'48K',sampleRate:48000,fftSize:32768,fMax:24000,color:'#E76F24'},
  {id:'bank-file-96k',name:'96K',sampleRate:96000,fftSize:65536,fMax:48000,color:'#43A047'},
  {id:'bank-file-192k',name:'192K',sampleRate:192000,fftSize:131072,fMax:96000,color:'#E24A4A'}
];

function relativeLuminance(hex){
  const channels=hex.slice(1).match(/../g).map(value=>parseInt(value,16)/255);
  const linear=channels.map(value=>value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4));
  return .2126*linear[0]+.7152*linear[1]+.0722*linear[2];
}

function contrastAgainstWhite(hex){
  return 1.05/(relativeLuminance(hex)+.05);
}

const entries=bank.buildEntries();
assert.strictEqual(entries.length,3);

for(let entryIndex=0;entryIndex<entries.length;entryIndex++){
  const entry=entries[entryIndex];
  const spec=expected[entryIndex];
  const canonical=entry.canonical;
  const points=canonical.points;

  assert.deepStrictEqual(
    {
      id:entry.id,
      name:entry.name,
      sampleRate:entry.sampleRate,
      fftSize:entry.fftSize,
      fMin:entry.fMin,
      fMax:entry.fMax,
      points:entry.points,
      color:entry.color
    },
    {...spec,fMin:1.46484375,points:591}
  );
  assert.strictEqual(measurementPalette.has(entry.color),false);
  assert.ok(contrastAgainstWhite(entry.color)>=3,'Bank color must remain visible against the light canvas');
  assert.strictEqual(canonical.format,'raptor.measurement.canonical.v1');
  assert.strictEqual(canonical.layout,'column-major');
  assert.deepStrictEqual(canonical.columns,['frequency_hz','magnitude_db','phase_deg','coherence']);
  assert.strictEqual(canonical.sample_rate_hz,spec.sampleRate);
  assert.strictEqual(canonical.base_fft_size,spec.fftSize);
  assert.strictEqual(canonical.data.length,591*4);
  assert.strictEqual(canonical.data_bytes,591*4*8);
  assert.strictEqual(entry.binHz,1.46484375);

  const frequency=canonical.data.subarray(0,points);
  const magnitude=canonical.data.subarray(points,points*2);
  const phase=canonical.data.subarray(points*2,points*3);
  const coherence=canonical.data.subarray(points*3,points*4);
  assert.strictEqual(frequency[0],1.46484375);
  assert.strictEqual(frequency[points-1],spec.fMax);
  for(let i=0;i<points;i++){
    if(i) assert.ok(frequency[i]>frequency[i-1]);
    assert.strictEqual(magnitude[i],0);
    assert.strictEqual(phase[i],0);
    assert.strictEqual(coherence[i],1);
  }
}

console.log('RAPTOR Bank File neutral source contract PASS');
