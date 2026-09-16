(function(root){
'use strict';
// Original RAPTOR display: frequency-bucket summaries, not financial OHLC.
// Coherence is always the imported 0..1 value, independent of edited magnitude.
function quantile(sorted,p){
  const n=(sorted.length-1)*p,lo=Math.floor(n),t=n-lo;
  return sorted[lo]*(1-t)+sorted[Math.ceil(n)]*t;
}
function summarize(views,{minHz,maxHz,xOf,width=1000,spacing=12}){
  const buckets=new Map(),f=views.frequency_hz,c=views.coherence;
  if(!f||!c) return [];
  for(let i=0;i<f.length;i++){
    if(!Number.isFinite(f[i])||f[i]<minHz||f[i]>maxHz||!Number.isFinite(c[i])||c[i]<0||c[i]>1) continue;
    const x=xOf(f[i]);
    if(!Number.isFinite(x)||x<0||x>width) continue;
    const key=Math.floor(x/spacing);
    if(!buckets.has(key)) buckets.set(key,{x:Math.min(width-3,Math.max(3,(key+.5)*spacing)),fromHz:f[i],toHz:f[i],values:[]});
    const bucket=buckets.get(key);bucket.toHz=f[i];bucket.values.push(c[i]);
  }
  return [...buckets.values()].map(b=>{
    b.values.sort((a,b)=>a-b);
    return {x:b.x,fromHz:b.fromHz,toHz:b.toHz,count:b.values.length,min:b.values[0],max:b.values[b.values.length-1],q25:quantile(b.values,.25),median:quantile(b.values,.5),q75:quantile(b.values,.75)};
  });
}
function geometry(b,height=220){
  const bottom=height-4,lane=height*.28,y=c=>bottom-c*lane,x=b.x,w=2.5;
  // Zero-height bodies remain honest horizontal marks (no artificial floor).
  return `M${x} ${y(b.min)}V${y(b.max)} M${x-w} ${y(b.q25)}H${x+w}V${y(b.q75)}H${x-w}Z M${x-w-1} ${y(b.median)}H${x+w+1}`;
}
function render(svg,views,options){
  if(!svg) return;
  const ns='http://www.w3.org/2000/svg';
  let group=svg.querySelector('.raptor-coherence-candles');
  if(!group){group=document.createElementNS(ns,'g');group.setAttribute('class','raptor-coherence-candles');svg.appendChild(group);}
  group.replaceChildren();
  if(!views?.coherence) return;
  const height=options.height||220,width=options.width||1000;
  const screenWidth=svg.getBoundingClientRect().width||width;
  const buckets=summarize(views,{...options,spacing:Math.max(12,7*width/screenWidth)});
  if(!buckets.length) return;
  group.setAttribute('aria-label','Coherence candles, 0 to 100 percent; wick min–max, body 25–75 percentiles, mark median');
  for(const b of buckets){
    const path=document.createElementNS(ns,'path');path.setAttribute('d',geometry(b,height));
    const title=document.createElementNS(ns,'title');
    const pct=v=>(v*100).toFixed(1)+'%';
    title.textContent=`${b.fromHz.toFixed(1)}–${b.toHz.toFixed(1)} Hz · Coherence min ${pct(b.min)} · median ${pct(b.median)} · max ${pct(b.max)} · ${b.count} samples`;
    path.appendChild(title);group.appendChild(path);
  }
  for(const c of [0,.5,1]){
    const text=document.createElementNS(ns,'text');text.setAttribute('x','6');text.setAttribute('y',String(height-4-c*height*.28-2));
    text.textContent=(c===1?'Coh ':'')+(c*100)+'%';group.appendChild(text);
  }
}
const api=Object.freeze({summarize,geometry,render});
if(typeof module==='object'&&module.exports) module.exports=api;
else root.RaptorCoherenceCandles=api;
})(typeof window==='undefined'?globalThis:window);
