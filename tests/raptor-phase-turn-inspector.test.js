'use strict';
const assert=require('assert');
const {performance}=require('perf_hooks');
const fs=require('fs'),path=require('path');
const I=require('../gui/raptor-phase-turn-inspector.js');
function wrap(v){while(v>180)v-=360;while(v<-180)v+=360;return v;}
function linearViews(n,f0,f1,delayMs,intercept=73,coh=.95){const f=new Float64Array(n),p=new Float64Array(n),c=new Float64Array(n),m=new Float64Array(n),s=-delayMs/1000*360;for(let i=0;i<n;i++){const x=f0+(f1-f0)*i/(n-1);f[i]=x;p[i]=wrap(intercept+s*x);c[i]=coh;}return{frequency_hz:f,phase_deg:p,coherence:c,magnitude_db:m};}
let passed=0;function test(name,fn){fn();passed++;console.log('PASS',String(passed).padStart(2,'0'),name);}
for(const [name,span,d] of [['-360/1000Hz = +1ms',1000,1],['-360/500Hz = +2ms',500,2],['-360/2000Hz = +0.5ms',2000,.5]])test(name,()=>{const r=I.analyzeViewsAtFrequency(linearViews(501,1000,1000+span,d,576),1000+span/2);assert.equal(r.status,'LINEAR_DELAY');assert.ok(Math.abs(r.fittedDelayMs-d)<1e-6);});
test('arbitrary phase intercept',()=>assert.equal(I.analyzeViewsAtFrequency(linearViews(601,500,1700,1,123.4),1100).status,'LINEAR_DELAY'));
test('+180/-180 crossing',()=>assert.ok(I.prepareViews(linearViews(801,100,2000,1,0)).boundaries.length));
test('-180/+180 crossing',()=>assert.ok(I.prepareViews(linearViews(801,100,2000,-1,0)).boundaries.length));
test('more than one rotation',()=>{const r=I.analyzeViewsAtFrequency(linearViews(1801,100,4100,1,55),2600);assert.equal(r.status,'LINEAR_DELAY');assert.ok(Math.abs(r.rotations-1)<1e-9);});
test('curved line => AVERAGE_ONLY',()=>{const n=801,f=new Float64Array(n),p=new Float64Array(n),c=new Float64Array(n),m=new Float64Array(n);for(let i=0;i<n;i++){const t=i/(n-1);f[i]=1000+1000*t;p[i]=wrap(120-360*(.08*t+.92*t*t));c[i]=.95;}assert.equal(I.analyzeViewsAtFrequency({frequency_hz:f,phase_deg:p,coherence:c,magnitude_db:m},1500).status,'AVERAGE_ONLY');});
test('incomplete turn',()=>assert.equal(I.analyzeViewsAtFrequency(linearViews(200,1000,1300,1,30),1150).status,'UNREADABLE'));
test('positive slope => time advance',()=>{const r=I.analyzeViewsAtFrequency(linearViews(601,1000,2200,-1,22),1600);assert.equal(r.status,'LINEAR_DELAY');assert.ok(r.fittedDelayMs<0);assert.equal(r.delayInterpretation,'NEGATIVE_DELAY / TIME_ADVANCE');});
test('NaN gap',()=>{const v=linearViews(801,100,2100,1,80);v.phase_deg[400]=NaN;assert.equal(I.analyzeViewsAtFrequency(v,1000).status,'UNREADABLE');});
test('low coherence',()=>assert.equal(I.analyzeViewsAtFrequency(linearViews(601,1000,2200,1,20,.05),1600).reason,'LOW_COHERENCE'));
test('outlier rejection',()=>{const v=linearViews(701,1000,2400,1,10,.95);v.phase_deg[350]=wrap(v.phase_deg[350]+20);const r=I.analyzeViewsAtFrequency(v,1700);assert.equal(r.status,'LINEAR_DELAY');assert.ok(r.pointsRejected>=1);});
test('exact sample boundary',()=>assert.equal(I.analyzeViewsAtFrequency(linearViews(101,1000,2000,1,540),2000).status,'LINEAR_DELAY'));
test('591 points benchmark',()=>{const v=linearViews(591,20,2000,1,25);let t=performance.now();const p=I.prepareViews(v),a=performance.now()-t;t=performance.now();const r=I.analyzePrepared(p,300),b=performance.now()-t;assert.equal(r.status,'LINEAR_DELAY');console.log('  prepare='+a.toFixed(3)+'ms click='+b.toFixed(3)+'ms');});
test('16384 points benchmark',()=>{const v=linearViews(16384,20,20000,1,25);let t=performance.now();const p=I.prepareViews(v),a=performance.now()-t;t=performance.now();const r=I.analyzePrepared(p,8000),b=performance.now()-t;assert.equal(r.status,'LINEAR_DELAY');console.log('  prepare='+a.toFixed(3)+'ms click='+b.toFixed(3)+'ms');});
test('Canonical/source arrays unchanged',()=>{const v=linearViews(591,20,2000,1,25),f=new Float64Array(v.frequency_hz),p=new Float64Array(v.phase_deg),c=new Float64Array(v.coherence);I.analyzeViewsAtFrequency(v,1000);for(let i=0;i<f.length;i++){assert.ok(Object.is(v.frequency_hz[i],f[i]));assert.ok(Object.is(v.phase_deg[i],p[i]));assert.ok(Object.is(v.coherence[i],c[i]));}});
class FakePlot{constructor(){this.listeners={};}addEventListener(k,f){(this.listeners[k]||(this.listeners[k]=[])).push(f);}removeEventListener(k,f){this.listeners[k]=(this.listeners[k]||[]).filter(x=>x!==f);}querySelector(){return null;}getBoundingClientRect(){return{left:0,top:0,width:1000,height:220};}dispatchEvent(){return true;}fire(k,e){for(const f of this.listeners[k]||[])f(e);}}
test('pointermove performs no fit',()=>{const plot=new FakePlot(),v=linearViews(1001,20,20000,.2,70),xOf=f=>Math.log(f/20)/Math.log(1000)*1000,yPhase=p=>220-((Math.max(-180,Math.min(180,p))+180)/360)*220,frequencyAtRatio=r=>Math.exp(Math.log(20)+r*Math.log(1000));I.create({plot,getViews:()=>v,frequencyAtRatio,xOf,yPhase});assert.ok(!plot.listeners.pointermove);});
test('click not on phase line',()=>{const plot=new FakePlot(),v=linearViews(1001,20,20000,.2,70),xOf=f=>Math.log(f/20)/Math.log(1000)*1000,yPhase=p=>220-((Math.max(-180,Math.min(180,p))+180)/360)*220,frequencyAtRatio=r=>Math.exp(Math.log(20)+r*Math.log(1000)),ins=I.create({plot,getViews:()=>v,frequencyAtRatio,xOf,yPhase});plot.fire('click',{button:0,clientX:500,clientY:219,target:{}});assert.equal(ins.getResult(),null);});
const mag=fs.readFileSync(path.join(__dirname,'../gui/mag-phase-gd-filter.js'),'utf8');
test('right-click Add Band preserved',()=>assert.ok(mag.includes("plot.addEventListener('contextmenu',event=>openBandContext(event,filter,kind));")));
test('normal cursor/readout preserved',()=>{assert.ok(mag.includes("plot.addEventListener('pointermove',event=>"));assert.ok(mag.includes("restoreIdleGraphReadout(win,filter,kind)"));});
console.log('RESULT '+passed+'/'+passed+' PASS');