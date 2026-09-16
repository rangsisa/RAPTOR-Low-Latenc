'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const candles=require('../gui/coherence-candles.js');
const read=name=>fs.readFileSync(path.join(__dirname,'../gui',name),'utf8');
const el=()=>({appendChild(){},querySelectorAll(){return[];}});
const document={getElementById(){return null;},createElement:el,head:el(),body:el(),querySelectorAll(){return[];},addEventListener(){}};
let source,filter={id:'test',sampleRateHz:48000,bands:[],bypass:false};
const ctx=vm.createContext({window:{addEventListener(){}},document,Float64Array,console,MutationObserver:class{observe(){}}});
for(const name of ['measurement-canonical-v1.js','eq-geometry-rbj.js']) vm.runInContext(read(name),ctx);
const canonical=ctx.window.RaptorMeasurementCanonicalV1,rbj=ctx.window.RaptorEqGeometryRBJ;
ctx.window.RaptorMagPhaseGdFilter={get:()=>filter,getOutput(){
  const out=canonical.clone(source),v=canonical.views(out);
  if(!filter.bypass) for(const b of filter.bands) if(b.graphKind!=='phase') for(let i=0;i<out.points;i++) v.magnitude_db[i]+=rbj.responseAt(v.frequency_hz[i],b,48000).magnitudeDb;
  return out;
},setBands(id,bands){filter.bands=bands;}};
// Expose private numeric helpers only in this VM, never in the shipped API.
vm.runInContext(read('mag-phase-gd-autoeq.js').replace('window.RaptorMagPhaseGdAutoEq=','window.numericTest={trialResidual,responseGrid,nullProtectionMask};window.RaptorMagPhaseGdAutoEq='),ctx);
const auto=ctx.window.RaptorMagPhaseGdAutoEq;
const numeric=ctx.window.numericTest;
for(const rate of [48000,96000,192000]) for(const q of [.2,1.414,10]) for(const gainDb of [-24,6,24]){
  const frequency=new Float64Array([10,20,80,1000,8000,20000]);
  const band={frequencyHz:80,q,gainDb};
  const result=numeric.trialResidual(new Float64Array(frequency.length),band,rate,numeric.responseGrid(frequency,rate));
  frequency.forEach((f,i)=>assert.ok(Math.abs(result[i]-rbj.responseAt(f,band,rate).magnitudeDb)<1e-7));
}
const nf=Float64Array.from({length:101},(_,i)=>100*Math.pow(10,i/100));
const nm=Float64Array.from(nf,(f,i)=>i%7===0?-12:Math.sin(i)*2);
const mask=numeric.nullProtectionMask(nf,nm);
nf.forEach((f,i)=>{
  const values=Array.from(nm).filter((m,k)=>Math.abs(Math.log2(nf[k]/f))<=.25).sort((a,b)=>a-b);
  const mid=Math.floor(values.length/2),median=values.length%2?values[mid]:(values[mid-1]+values[mid])/2;
  assert.equal(mask[i],median-nm[i]>=6?1:0,'Sliding median parity');
});
const opts={fMin:100,fMax:4000,targetDb:0,minCoherence:.5,maxBoost:12,maxCut:12,bandCount:4,autoCount:false,nullProtect:false};
function dataset(coherence=()=>.9,magnitude=f=>6*Math.exp(-(Math.log2(f/1000)**2)/.1),n=401){
  filter={id:'test',sampleRateHz:48000,bands:[],bypass:false};
  const rows=Array.from({length:n},(_,i)=>{const f=100*Math.pow(40,i/(n-1));return [f,magnitude(f,i),0,coherence(f,i)].join(' ');});
  source=canonical.parseText(rows.join('\n'),{sampleRateHz:48000});return canonical.views(source);
}
function preview(options={}){return auto.preview('test',{...opts,...options});}
const v=dataset();const original=Array.from(source.data),p=preview();
assert.ok(p.bands.length>0);assert.ok(p.stats.afterWeightedRmsDb<p.stats.beforeWeightedRmsDb);
assert.deepEqual(Array.from(source.data),original,'Preview cannot mutate canonical');
const weights=v.coherence,m=v.magnitude_db;
const expected=Math.sqrt(m.reduce((sum,x,i)=>sum+weights[i]*x*x,0)/weights.reduce((s,x)=>s+x,0));
assert.ok(Math.abs(p.stats.beforeWeightedRmsDb-expected)<1e-12);
auto.apply('test',p);
const rendered=canonical.views(ctx.window.RaptorMagPhaseGdFilter.getOutput());
const actualRms=Math.sqrt(rendered.magnitude_db.reduce((s,x,i)=>s+weights[i]*x*x,0)/weights.reduce((s,x)=>s+x,0));
assert.ok(Math.abs(actualRms-p.stats.afterWeightedRmsDb)<1e-8,'Compiled prediction must equal editor RBJ output');
const again=preview();
assert.ok(Math.abs(again.stats.beforeWeightedRmsDb-p.stats.beforeWeightedRmsDb)<1e-10,'Rerun removes previous Auto bands exactly');
assert.deepEqual(Array.from(canonical.views(source).coherence),Array.from(weights));
filter.bypass=true;assert.throws(()=>preview(),/Bypass/);

// Zero coherence has zero influence even at a zero threshold.
dataset(()=>0);assert.throws(()=>preview({minCoherence:0}),/trusted points/);
dataset(()=>.499);assert.throws(()=>preview(),/trusted points/);
dataset(()=>.5);assert.equal(preview().stats.pointCount,401);
dataset(()=>.755);assert.equal(preview({minCoherence:.755}).stats.pointCount,401);
assert.throws(()=>preview({minCoherence:.756}),/trusted points/);
assert.throws(()=>preview({minCoherence:50}),/0\.\.1/);
dataset(()=>1);assert.equal(preview({minCoherence:1}).stats.pointCount,401);

// A zero-coherence spike must not create a center or affect the objective.
dataset((f,i)=>i===100?0:.9,(f,i)=>i===100?24:6*Math.exp(-(Math.log2(f/1000)**2)/.1));
const zero=preview({minCoherence:0});
assert.equal(zero.stats.pointCount,400);
assert.ok(zero.bands.every(b=>Math.abs(b.frequencyHz-canonical.views(source).frequency_hz[100])>1e-6));

// Low-coherence gaps cannot be bridged when estimating width.
dataset((f)=>f>600&&f<1600?.1:1,()=>6);
const gap=preview({bandCount:1});
assert.ok(gap.bands[0].frequencyHz<=600||gap.bands[0].frequencyHz>=1600);
assert.ok(gap.bands[0].q> .2,'Must not derive the broad whole-range Q across a rejected gap');

// Weighted metrics use c, not a nonzero floor, squared c, or candle summaries.
const weighted=dataset(f=>f<1000?.25:1,f=>f<1000?4:2);
const wp=preview({minCoherence:0});
let sum=0,total=0;for(let i=0;i<source.points;i++){sum+=weighted.coherence[i]*weighted.magnitude_db[i]**2;total+=weighted.coherence[i];}
assert.ok(Math.abs(wp.stats.beforeWeightedRmsDb-Math.sqrt(sum/total))<1e-12);
assert.ok(wp.stats.afterWeightedRmsDb<wp.stats.beforeWeightedRmsDb);

// Equal-height errors prioritize the truly more coherent lobe.
const lobes=f=>6*Math.exp(-(Math.log2(f/500)**2)/.06)+6*Math.exp(-(Math.log2(f/2000)**2)/.06);
dataset(f=>f<1000?.2:.9,lobes);
assert.ok(preview({minCoherence:0,bandCount:1}).bands[0].frequencyHz>1000);
dataset(f=>f<1000?.9:.2,lobes);
assert.ok(preview({minCoherence:0,bandCount:1}).bands[0].frequencyHz<1000);

// Applying Auto EQ retains manual magnitude/phase bands and phase samples.
dataset();filter.bands=[{id:'manual',frequencyHz:300,gainDb:1,q:2,graphKind:'magnitude'},{id:'manual-phase',frequencyHz:900,gainDb:45,q:1,graphKind:'phase'}];
auto.apply('test',preview());
assert.ok(filter.bands.some(b=>b.id==='manual'));assert.ok(filter.bands.some(b=>b.id==='manual-phase'));
assert.ok(canonical.views(source).phase_deg.every(v=>v===0));

dataset(()=>.95,(f,i)=>i===250?-20:4*Math.exp(-(Math.log2(f/500)**2)/.1));
const guarded=preview({nullProtect:true});
assert.ok(guarded.bands.every(b=>b.frequencyHz!==canonical.views(source).frequency_hz[250]),'Protect nulls must skip the deep notch');

// Dense inputs and the default null guard: bounded runtime and real improvement.
dataset(f=>f<700?.4:.9,f=>-4*Math.exp(-(Math.log2(f/1500)**2)/.12),16384);
const started=performance.now();const denseFit=preview({nullProtect:true,bandCount:8});
const elapsed=performance.now()-started;
assert.ok(denseFit.stats.afterWeightedRmsDb<denseFit.stats.beforeWeightedRmsDb);
assert.ok(elapsed<5000,'Dense Auto EQ unexpectedly slow: '+elapsed);
console.log('Dense 16384-point Auto EQ:',elapsed.toFixed(1),'ms');

// Candles preserve extremes and quantiles; no magnitude coupling or mutation.
const cv={frequency_hz:[100,101,102,103,104],coherence:[0,.25,.5,.75,1],magnitude_db:[-40,-5,0,5,40]};
const settings={minHz:100,maxHz:104,xOf:()=>50};
const summary=candles.summarize(cv,settings);
assert.equal(summary.length,1);
assert.deepEqual([summary[0].min,summary[0].q25,summary[0].median,summary[0].q75,summary[0].max],[0,.25,.5,.75,1]);
assert.deepEqual(summary,candles.summarize({...cv,magnitude_db:[0,0,0,0,0]},settings));
assert.deepEqual(cv.coherence,[0,.25,.5,.75,1]);
for(const c of [0,.5,1]){
  const b=candles.summarize({frequency_hz:[100],coherence:[c]},settings)[0];
  const y=Number(candles.geometry(b).match(/^M[^ ]+ ([^V]+)/)[1]);
  assert.ok(Math.abs(y-(216-c*61.6))<1e-10);
}
const dense={frequency_hz:Array.from({length:16000},(_,i)=>100+i/100),coherence:Array(16000).fill(.99)};dense.coherence[8123]=.01;
assert.equal(candles.summarize(dense,{minHz:100,maxHz:1000,xOf:()=>50})[0].min,.01);
assert.equal(candles.summarize({frequency_hz:[100,101],coherence:[NaN,2]},settings).length,0);

// Render/clear contract without a browser dependency; exercise real SVG builder.
class SvgElement{
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};}
  setAttribute(k,v){this.attrs[k]=v;}
  appendChild(c){this.children.push(c);}
  replaceChildren(){this.children=[];}
  querySelector(selector){return this.children.find(c=>'.'+c.attrs.class===selector)||null;}
  getBoundingClientRect(){return {width:640};}
}
global.document={createElementNS:(ns,tag)=>new SvgElement(tag)};
const svg=new SvgElement('svg');
candles.render(svg,cv,{...settings,width:1000,height:220});
const group=svg.querySelector('.raptor-coherence-candles');
assert.equal(group.children.filter(c=>c.tag==='path').length,1);
assert.match(group.children[0].children[0].textContent,/min 0.0%.*median 50.0%.*max 100.0%/);
assert.deepEqual(group.children.filter(c=>c.tag==='text').map(c=>c.textContent),['0%','50%','Coh 100%']);
candles.render(svg,null,{});assert.equal(group.children.length,0);delete global.document;
assert.throws(()=>canonical.parseText('100 0 0 90'),/0\.\.1/);
assert.throws(()=>canonical.parseText('100 0 0'),/4 numeric/);
assert.throws(()=>canonical.parseText('200 0 0 .9\n100 0 0 .8'),/strictly increasing/);
console.log('PASS coherence candles / exact weights / thresholds / gaps / rerun / bypass / canonical immutability');
