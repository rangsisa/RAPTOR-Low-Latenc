(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.RaptorPhaseTurnInspector=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const DEFAULTS=Object.freeze({
  graphWidth:1000,graphHeight:220,hitRadiusPx:12,minPoints:6,
  minPhaseTravelDeg:300,minMedianCoherence:.20,
  coherenceWeightFloor:.20,coherenceWeightScale:.80,
  madSigma:3.5,madFloorDeg:2,linearR2Min:.992,linearRmseMaxDeg:6,
  boundaryEpsilonDeg:1e-7,frequencyEpsilonHz:1e-9,maxOverlaySegments:900
});
const opts=o=>Object.freeze({...DEFAULTS,...(o||{})});
const finite=v=>Number.isFinite(Number(v));
function median(a){if(!a.length)return NaN;const b=a.slice().sort((x,y)=>x-y),m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2;}
function wrap180(v){v=Number(v);if(!Number.isFinite(v))return NaN;while(v>180)v-=360;while(v<-180)v+=360;return v;}
function binaryNearest(a,t,s=0,e=a.length-1){let lo=Math.max(0,s|0),hi=Math.min(a.length-1,e|0);if(hi<lo)return-1;while(lo<hi){const m=(lo+hi)>>1;if(Number(a[m])<t)lo=m+1;else hi=m;}if(lo<=s)return lo;return Math.abs(Number(a[lo])-t)<Math.abs(Number(a[lo-1])-t)?lo:lo-1;}

function prepareViews(views,options){
  const o=opts(options),f=views?.frequency_hz,p=views?.phase_deg,c=views?.coherence||null;
  const n=Math.min(f?.length||0,p?.length||0,c?c.length:Infinity);
  const u=new Float64Array(n);u.fill(NaN);
  const runId=new Int32Array(n);runId.fill(-1);
  const runs=[],boundaries=[];
  let start=-1,offset=0,pf=NaN,pp=NaN,pu=NaN;
  function finish(end){if(start<0||end<start)return;const r={id:runs.length,start,end,boundaries:[]};runs.push(r);for(let i=start;i<=end;i++)runId[i]=r.id;}
  for(let i=0;i<n;i++){
    const fi=Number(f[i]),pi=Number(p[i]);
    const valid=Number.isFinite(fi)&&fi>0&&Number.isFinite(pi)&&(start<0||fi>pf);
    if(!valid){finish(i-1);start=-1;offset=0;pf=pp=pu=NaN;continue;}
    if(start<0){start=i;u[i]=pi;pf=fi;pp=pi;pu=pi;continue;}
    const d=pi-pp;let boundary=null,next=offset;
    if(d>180){boundary=-180;next-=360;} else if(d<-180){boundary=180;next+=360;}
    const ui=pi+next;u[i]=ui;
    if(boundary!==null){
      const target=boundary+offset,den=ui-pu;
      let t=Math.abs(den)<=o.boundaryEpsilonDeg?0:(target-pu)/den;
      t=Math.max(0,Math.min(1,t));
      boundaries.push({leftIndex:i-1,rightIndex:i,frequencyHz:pf+(fi-pf)*t,wrappedPhaseDeg:boundary,unwrappedPhaseDeg:target});
    }
    offset=next;pf=fi;pp=pi;pu=ui;
  }
  finish(n-1);
  for(const b of boundaries){const id=runId[b.leftIndex];if(id>=0&&id===runId[b.rightIndex])runs[id].boundaries.push(b);}
  return Object.freeze({views,options:o,points:n,unwrapped:u,runId,runs,boundaries});
}
function localDirection(prep,index){
  const id=prep.runId[index];if(id<0)return 0;const r=prep.runs[id];
  for(let span=4;span<=32;span+=4){const a=Math.max(r.start,index-span),b=Math.min(r.end,index+span),d=prep.unwrapped[b]-prep.unwrapped[a];if(Math.abs(d)>1e-9)return Math.sign(d);}
  return 0;
}
function interpolateLevel(prep,run,target,direction){
  const u=prep.unwrapped,f=prep.views.frequency_hz,p=prep.views.phase_deg,e=prep.options.boundaryEpsilonDeg;
  for(let i=run.start;i<run.end;i++){
    const a=u[i],b=u[i+1];
    if(Math.abs(a-target)<=e)return{frequencyHz:Number(f[i]),wrappedPhaseDeg:Number(p[i]),unwrappedPhaseDeg:target,leftIndex:i,rightIndex:i,t:0};
    const crosses=direction>0?(a<=target&&b>=target):(a>=target&&b<=target);
    if(crosses){const t=Math.abs(b-a)<=e?0:(target-a)/(b-a);return{frequencyHz:Number(f[i])+(Number(f[i+1])-Number(f[i]))*t,wrappedPhaseDeg:wrap180(target),unwrappedPhaseDeg:target,leftIndex:i,rightIndex:i+1,t};}
  }
  if(Math.abs(u[run.end]-target)<=e)return{frequencyHz:Number(f[run.end]),wrappedPhaseDeg:Number(p[run.end]),unwrappedPhaseDeg:target,leftIndex:run.end,rightIndex:run.end,t:0};
  return null;
}
function selectTurn(prep,index){
  const id=prep.runId[index];if(id<0)return{status:'UNREADABLE',reason:'INVALID_GAP'};
  const run=prep.runs[id],direction=localDirection(prep,index);if(!direction)return{status:'UNREADABLE',reason:'NO_PHASE_DIRECTION'};
  const refF=Number(prep.views.frequency_hz[index]),bs=run.boundaries,e=prep.options.frequencyEpsilonHz;
  let before=-1;for(let j=0;j<bs.length;j++){if(bs[j].frequencyHz<=refF+e)before=j;else break;}
  if(before>=0&&Math.abs(bs[before].frequencyHz-refF)<=e&&before>0)return{run,direction,start:bs[before-1],end:bs[before],boundaryMode:'wrap'};
  if(before>=0&&before+1<bs.length)return{run,direction,start:bs[before],end:bs[before+1],boundaryMode:'wrap'};
  const u0=prep.unwrapped[run.start],ur=prep.unwrapped[index],progress=direction*(ur-u0);
  let k=Math.floor((progress+prep.options.boundaryEpsilonDeg)/360);if(k<0)k=0;
  for(const candidate of [k,k-1]){
    if(candidate<0)continue;
    const a=u0+direction*360*candidate,b=a+direction*360;
    const start=interpolateLevel(prep,run,a,direction),end=interpolateLevel(prep,run,b,direction);
    if(start&&end&&start.frequencyHz<=refF+e&&end.frequencyHz>=refF-e)return{run,direction,start,end,boundaryMode:'derived'};
  }
  return{status:'UNREADABLE',reason:'INCOMPLETE_TURN'};
}
function weightedFit(xs,ys,ws,mask){
  let sw=0,sx=0,sy=0;for(let i=0;i<xs.length;i++){if(mask&&!mask[i])continue;const w=ws[i];sw+=w;sx+=w*xs[i];sy+=w*ys[i];}
  if(!(sw>0))return null;const mx=sx/sw,my=sy/sw;let sxx=0,sxy=0;
  for(let i=0;i<xs.length;i++){if(mask&&!mask[i])continue;const w=ws[i],dx=xs[i]-mx;sxx+=w*dx*dx;sxy+=w*dx*(ys[i]-my);}
  if(!(sxx>0))return null;return{slopeDegPerHz:sxy/sxx,interceptDeg:my-(sxy/sxx)*mx};
}
function quality(xs,ys,ws,mask,slope,intercept){
  let sw=0,sy=0;for(let i=0;i<xs.length;i++){if(mask&&!mask[i])continue;sw+=ws[i];sy+=ws[i]*ys[i];}
  if(!(sw>0))return{r2:NaN,rmse:NaN};const mean=sy/sw;let sse=0,sst=0;
  for(let i=0;i<xs.length;i++){if(mask&&!mask[i])continue;const w=ws[i],res=ys[i]-(intercept+slope*xs[i]),dy=ys[i]-mean;sse+=w*res*res;sst+=w*dy*dy;}
  return{r2:sst>0?1-sse/sst:1,rmse:Math.sqrt(sse/sw)};
}
function robustFit(xs,ys,ws,o){
  let mask=new Array(xs.length).fill(true),fit=weightedFit(xs,ys,ws,mask);if(!fit)return null;
  const residuals=xs.map((x,i)=>Math.abs(ys[i]-(fit.interceptDeg+fit.slopeDegPerHz*x)));
  const med=median(residuals),mad=median(residuals.map(v=>Math.abs(v-med))),threshold=Math.max(o.madFloorDeg,o.madSigma*mad*1.4826);
  const next=residuals.map(v=>v<=threshold),retained=next.reduce((n,v)=>n+(v?1:0),0);
  if(retained>=o.minPoints&&retained<xs.length){mask=next;fit=weightedFit(xs,ys,ws,mask)||fit;}
  const q=quality(xs,ys,ws,mask,fit.slopeDegPerHz,fit.interceptDeg);
  return{...fit,...q,mask,pointsUsed:mask.reduce((n,v)=>n+(v?1:0),0),pointsRejected:mask.reduce((n,v)=>n+(v?0:1),0),madDeg:mad,residualThresholdDeg:threshold};
}
function collect(prep,sel){
  const f=prep.views.frequency_hz,c=prep.views.coherence||null,u=prep.unwrapped,x=[],y=[],coh=[],ids=[],a=sel.start.frequencyHz,b=sel.end.frequencyHz,e=prep.options.frequencyEpsilonHz;
  for(let i=sel.run.start;i<=sel.run.end;i++){const fi=Number(f[i]);if(fi<a-e||fi>b+e||!Number.isFinite(fi)||!Number.isFinite(u[i]))continue;x.push(fi);y.push(u[i]);coh.push(c&&finite(c[i])?Math.max(0,Math.min(1,Number(c[i]))):NaN);ids.push(i);}
  if(!x.length||Math.abs(x[0]-a)>e){x.unshift(a);y.unshift(sel.start.unwrappedPhaseDeg);coh.unshift(NaN);ids.unshift(-1);}
  if(Math.abs(x[x.length-1]-b)>e){x.push(b);y.push(sel.end.unwrappedPhaseDeg);coh.push(NaN);ids.push(-1);}
  return{x,y,coh,ids};
}
const unreadable=(reason,extra={})=>Object.freeze({status:'UNREADABLE',reason,...extra});
function analyzePrepared(prep,index){
  if(!prep||index<0||index>=prep.points)return unreadable('REFERENCE_OUT_OF_RANGE');
  const sel=selectTurn(prep,index);if(sel.status==='UNREADABLE')return unreadable(sel.reason,{referenceIndex:index});
  const pts=collect(prep,sel),o=prep.options,travel=sel.end.unwrappedPhaseDeg-sel.start.unwrappedPhaseDeg,df=sel.end.frequencyHz-sel.start.frequencyHz;
  if(!(df>0))return unreadable('NON_POSITIVE_FREQUENCY_SPAN');
  if(Math.abs(travel)<o.minPhaseTravelDeg)return unreadable('INSUFFICIENT_PHASE_TRAVEL',{phaseTravelDeg:travel});
  if(pts.x.length<o.minPoints)return unreadable('INSUFFICIENT_POINTS',{pointsAvailable:pts.x.length});
  const finiteC=pts.coh.filter(Number.isFinite),cohMedian=finiteC.length?median(finiteC):NaN;
  if(finiteC.length&&cohMedian<o.minMedianCoherence)return unreadable('LOW_COHERENCE',{coherenceMedian:cohMedian,pointsAvailable:pts.x.length,start:sel.start,end:sel.end});
  const ws=pts.coh.map(v=>Number.isFinite(v)?o.coherenceWeightFloor+o.coherenceWeightScale*v*v:1);
  const fit=robustFit(pts.x,pts.y,ws,o);if(!fit||fit.pointsUsed<o.minPoints)return unreadable('FIT_FAILED');
  const avg=-(travel/df)/360*1000,fitted=-(fit.slopeDegPerHz/360)*1000,linear=fit.r2>=o.linearR2Min&&fit.rmse<=o.linearRmseMaxDeg,primary=linear?fitted:avg;
  return Object.freeze({
    status:linear?'LINEAR_DELAY':'AVERAGE_ONLY',reason:linear?'ROBUST_LINEAR_FIT':'NON_CONSTANT_DELAY_CURVATURE',
    delayInterpretation:primary<0?'NEGATIVE_DELAY / TIME_ADVANCE':'POSITIVE_DELAY',
    start:sel.start,reference:{index,frequencyHz:Number(prep.views.frequency_hz[index]),wrappedPhaseDeg:Number(prep.views.phase_deg[index]),unwrappedPhaseDeg:Number(prep.unwrapped[index])},end:sel.end,
    deltaFrequencyHz:df,phaseTravelDeg:travel,rotations:Math.abs(travel)/360,equivalentDelayMs:avg,fittedDelayMs:fitted,
    slopeDegPerHz:fit.slopeDegPerHz,interceptDeg:fit.interceptDeg,r2:fit.r2,rmse:fit.rmse,coherenceMedian:cohMedian,
    pointsAvailable:pts.x.length,pointsUsed:fit.pointsUsed,pointsRejected:fit.pointsRejected,boundaryMode:sel.boundaryMode,sourceIndices:pts.ids
  });
}
function analyzeViewsAtFrequency(views,frequencyHz,options){const p=prepareViews(views,options);if(!p.points)return unreadable('NO_DATA');return analyzePrepared(p,binaryNearest(views.frequency_hz,frequencyHz,0,p.points-1));}
function distance(px,py,x1,y1,x2,y2){const dx=x2-x1,dy=y2-y1;if(dx===0&&dy===0)return Math.hypot(px-x1,py-y1);const t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy)));return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));}
function visibleSegments(f0,p0,f1,p1,xOf,yPhase){
  if(![f0,p0,f1,p1].every(Number.isFinite)||!(f1>f0))return[];
  const x0=xOf(f0),x1=xOf(f1),d=p1-p0;if(Math.abs(d)<=180)return[[x0,yPhase(p0),x1,yPhase(p1)]];
  let adjusted,boundary,opposite;if(d>180){adjusted=p1-360;boundary=-180;opposite=180;}else{adjusted=p1+360;boundary=180;opposite=-180;}
  const den=adjusted-p0;let t=Math.abs(den)<1e-12?0:(boundary-p0)/den;t=Math.max(0,Math.min(1,t));const xc=x0+(x1-x0)*t;
  return[[x0,yPhase(p0),xc,yPhase(boundary)],[xc,yPhase(opposite),x1,yPhase(p1)]];
}
function pairSegments(prep,a,b,xOf,yPhase){if(a<0||b<0||prep.runId[a]<0||prep.runId[a]!==prep.runId[b])return[];return visibleSegments(Number(prep.views.frequency_hz[a]),Number(prep.views.phase_deg[a]),Number(prep.views.frequency_hz[b]),Number(prep.views.phase_deg[b]),xOf,yPhase);}
function hitTest(prep,clientX,clientY,rect,xOf,yPhase,displayIndices,targetFrequencyHz){
  const ids=(displayIndices?.length?Array.from(displayIndices):Array.from({length:prep.points},(_,i)=>i)).filter(i=>i>=0&&i<prep.points&&prep.runId[i]>=0);if(ids.length<2)return null;
  const gx=Math.max(0,Math.min(prep.options.graphWidth,(clientX-rect.left)/Math.max(1,rect.width)*prep.options.graphWidth));
  let lo=0,hi=ids.length-1;while(lo<hi){const m=(lo+hi)>>1;if(xOf(Number(prep.views.frequency_hz[ids[m]]))<gx)lo=m+1;else hi=m;}
  const from=Math.max(1,lo-5),to=Math.min(ids.length-1,lo+5);let best=null;
  for(let j=from;j<=to;j++){const a=ids[j-1],b=ids[j];for(const s of pairSegments(prep,a,b,xOf,yPhase)){const x1=rect.left+s[0]/prep.options.graphWidth*rect.width,y1=rect.top+s[1]/prep.options.graphHeight*rect.height,x2=rect.left+s[2]/prep.options.graphWidth*rect.width,y2=rect.top+s[3]/prep.options.graphHeight*rect.height,d=distance(clientX,clientY,x1,y1,x2,y2);if(!best||d<best.distancePx)best={distancePx:d,a,b};}}
  if(!best||best.distancePx>prep.options.hitRadiusPx)return null;return{index:binaryNearest(prep.views.frequency_hz,targetFrequencyHz,Math.min(best.a,best.b),Math.max(best.a,best.b)),distancePx:best.distancePx};
}
function geometry(prep,result,xOf,yPhase){
  if(!result?.start||!result?.end||!result?.reference)return null;
  const pts=[{frequencyHz:result.start.frequencyHz,wrappedPhaseDeg:result.start.wrappedPhaseDeg}];
  for(let i=0;i<prep.points;i++){const f=Number(prep.views.frequency_hz[i]);if(f>result.start.frequencyHz&&f<result.end.frequencyHz&&prep.runId[i]>=0)pts.push({frequencyHz:f,wrappedPhaseDeg:Number(prep.views.phase_deg[i])});}
  pts.push({frequencyHz:result.end.frequencyHz,wrappedPhaseDeg:result.end.wrappedPhaseDeg});
  if(pts.length>prep.options.maxOverlaySegments+2){const keep=[pts[0]],stride=(pts.length-1)/prep.options.maxOverlaySegments;for(let n=1;n<prep.options.maxOverlaySegments;n++)keep.push(pts[Math.min(pts.length-2,Math.round(n*stride))]);keep.push(pts[pts.length-1]);pts.splice(0,pts.length,...keep);}
  const segments=[];for(let i=1;i<pts.length;i++)segments.push(...visibleSegments(pts[i-1].frequencyHz,pts[i-1].wrappedPhaseDeg,pts[i].frequencyHz,pts[i].wrappedPhaseDeg,xOf,yPhase));
  const point=v=>({x:xOf(v.frequencyHz),y:yPhase(v.wrappedPhaseDeg)});return{segments,start:point(result.start),reference:point(result.reference),end:point(result.end)};
}
function create(config){
  if(!config?.plot)throw new TypeError('plot is required');for(const k of ['getViews','frequencyAtRatio','xOf','yPhase'])if(typeof config[k]!=='function')throw new TypeError(k+' is required');
  const o=opts(config.options),plot=config.plot;let cache=null,last=null,analysisCount=0,prepareCount=0;
  function prepared(){const v=config.getViews();if(!v?.frequency_hz||!v?.phase_deg)return null;if(cache&&cache.views===v&&cache.f===v.frequency_hz&&cache.p===v.phase_deg&&cache.c===v.coherence)return cache.prep;const p=prepareViews(v,o);cache={views:v,f:v.frequency_hz,p:v.phase_deg,c:v.coherence,prep:p};prepareCount++;return p;}
  function emit(result,reason){last=result||null;if(typeof config.onResult==='function')config.onResult(last,{reason});if(typeof CustomEvent==='function'&&plot.dispatchEvent)try{plot.dispatchEvent(new CustomEvent('raptor:phaseturninspect',{bubbles:true,detail:{result:last,reason}}));}catch{}}
  function click(event){if(event.button!==undefined&&event.button!==0)return;if(typeof config.shouldIgnoreEvent==='function'&&config.shouldIgnoreEvent(event))return;const p=prepared();if(!p)return;const surface=plot.querySelector?.('svg')||plot,rect=surface.getBoundingClientRect(),ratio=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width))),target=config.frequencyAtRatio(ratio),ids=typeof config.getDisplayIndices==='function'?config.getDisplayIndices(p.views):null,hit=hitTest(p,event.clientX,event.clientY,rect,config.xOf,config.yPhase,ids,target);if(!hit)return;analysisCount++;const r=analyzePrepared(p,hit.index);emit(r.status==='UNREADABLE'?r:Object.freeze({...r,geometry:geometry(p,r,config.xOf,config.yPhase)}),'selection');}
  plot.addEventListener('click',click);
  return Object.freeze({clear(reason='clear'){if(last)emit(null,reason);},destroy(){plot.removeEventListener('click',click);last=null;cache=null;},invalidate(reason='response-change'){cache=null;if(last)emit(null,reason);},getResult(){return last;},stats(){return Object.freeze({analysisCount,prepareCount});}});
}
return Object.freeze({DEFAULTS,create,prepareViews,analyzePrepared,analyzeViewsAtFrequency,_test:Object.freeze({binaryNearest,robustFit,hitTest,geometry,wrap180})});
});