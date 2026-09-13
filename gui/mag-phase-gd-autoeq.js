(()=>{
'use strict';

const filterApi=window.RaptorMagPhaseGdFilter;
const canonicalApi=window.RaptorMeasurementCanonicalV1;
const rbj=window.RaptorEqGeometryRBJ;
const passbandMetadata=window.RaptorCrossoverPassbandMetadata||null;
if(!filterApi||!canonicalApi||!rbj) return;

const panels=new Map();
const previews=new Map();
let panelZ=2720;
let sequence=1;

const AUTO_BAND_PREFIX='autoeq-';
const AUTO_BAND_LIMIT=16;
const AUTO_STOP_DB=.50;
const MIN_GAIN_DB=.05;
const MIN_Q=.20;
const MAX_Q=10;
const NULL_PROTECT_DEPTH_DB=6;
const NULL_WINDOW_OCT=.25;

function ensureStyle(){
  if(document.getElementById('mpgdAutoEqStyle')) return;
  const style=document.createElement('style');
  style.id='mpgdAutoEqStyle';
  style.textContent=`
    .mpgd-autoeq-open{
      height:18px;padding:0 7px;border:1px solid #c58a5d;border-radius:4px;
      background:#fff7f0;color:#a94a0b;font-size:7px;font-weight:850;line-height:1;
      cursor:pointer;touch-action:manipulation;user-select:none
    }
    .mpgd-autoeq-open:hover,.mpgd-autoeq-open:focus-visible{
      outline:none;border-color:var(--raptor-active-border,#e86f17);background:#fff0e3;
      box-shadow:0 0 0 1px rgba(232,111,23,.12)
    }
    .mpgd-autoeq-window{
      position:fixed;z-index:2720;width:min(336px,calc(100vw - 12px));
      display:grid;grid-template-rows:34px minmax(0,1fr);max-height:calc(100vh - 12px);
      border:1px solid #8f9ca7;border-radius:8px;background:#fff;
      box-shadow:0 16px 36px rgba(21,31,40,.24);overflow:hidden;color:#34414b
    }
    .mpgd-autoeq-window[hidden]{display:none!important}
    .mpgd-autoeq-head{
      display:flex;align-items:center;gap:7px;padding:0 6px 0 10px;
      border-bottom:1px solid #c1c9cf;background:linear-gradient(#fff,#f5f7f8);
      cursor:grab;touch-action:none;user-select:none
    }
    .mpgd-autoeq-head strong{font-size:10px;letter-spacing:.025em}
    .mpgd-autoeq-close{
      margin-left:auto;width:24px;height:24px;padding:0;border:0;border-radius:4px;
      background:transparent;color:#65737e;font-size:17px;line-height:1;cursor:pointer
    }
    .mpgd-autoeq-close:hover{background:#edf1f3;color:#25313a}
    .mpgd-autoeq-body{
      min-height:0;display:grid;gap:7px;padding:9px;overflow:auto;background:#f8fafb
    }
    .mpgd-autoeq-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .mpgd-autoeq-field{
      min-width:0;min-height:32px;display:grid;grid-template-columns:minmax(0,1fr) 92px;
      align-items:center;gap:8px;padding:5px 7px;border:1px solid #d0d7dc;
      border-radius:5px;background:#fff
    }
    .mpgd-autoeq-field--compact{grid-template-columns:minmax(0,1fr) 76px}
    .mpgd-autoeq-field>span{min-width:0;font-size:8px;font-weight:800;color:#46535d}
    .mpgd-autoeq-number{
      display:grid;grid-template-columns:minmax(0,1fr) 22px;align-items:center;gap:4px
    }
    .mpgd-autoeq-number input,.mpgd-autoeq-count-main input[type="number"]{
      width:100%;min-width:0;height:24px;box-sizing:border-box;padding:0 5px;
      border:1px solid #aeb9c2;border-radius:4px;background:#fff;color:#26323d;
      font-size:9px;font-variant-numeric:tabular-nums
    }
    .mpgd-autoeq-number b{color:#7a8790;font-size:7px;font-weight:800}
    .mpgd-autoeq-count-row{
      min-height:32px;display:grid;grid-template-columns:minmax(0,1fr) auto;
      align-items:center;gap:8px;padding:5px 7px;border:1px solid #d0d7dc;
      border-radius:5px;background:#fff
    }
    .mpgd-autoeq-count-main{
      min-width:0;display:grid;grid-template-columns:minmax(0,1fr) 64px;align-items:center;gap:7px
    }
    .mpgd-autoeq-count-main span{font-size:8px;font-weight:800;color:#46535d}
    .mpgd-autoeq-auto,.mpgd-autoeq-null{
      height:24px;display:inline-flex;align-items:center;gap:4px;padding:0 6px;
      border:1px solid #c4ccd2;border-radius:4px;background:#f8fafb;color:#4d5a65;
      font-size:7.5px;font-weight:800;cursor:pointer
    }
    .mpgd-autoeq-null{height:30px;justify-content:center;background:#fff}
    .mpgd-autoeq-auto input,.mpgd-autoeq-null input{
      width:11px;height:11px;margin:0;accent-color:var(--raptor-active,#e86f17)
    }
    .mpgd-autoeq-actions{display:grid;grid-template-columns:auto auto auto minmax(0,1fr);align-items:center;gap:5px}
    .mpgd-autoeq-button{
      min-width:62px;height:28px;padding:0 9px;border:1px solid #b5c0c8;border-radius:5px;
      background:#fff;color:#44515c;font-size:8px;font-weight:850;cursor:pointer;
      touch-action:manipulation
    }
    .mpgd-autoeq-button:hover{background:#f0f3f5}
    .mpgd-autoeq-add{
      border-color:#c26828;background:#e86f17;color:#fff;font-weight:900
    }
    .mpgd-autoeq-add:hover{background:#cf5f12}
    .mpgd-autoeq-clear{border-color:#c79a9a;color:#8b4545}
    .mpgd-autoeq-button:disabled{opacity:.45;cursor:default}
    .mpgd-autoeq-status{
      min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      color:#74818b;font-size:7px
    }
    .mpgd-autoeq-preview{
      min-height:54px;border:1px solid #d0d7dc;border-radius:5px;background:#fff;overflow:hidden
    }
    .mpgd-autoeq-preview-head{
      min-height:27px;display:flex;align-items:center;gap:6px;padding:0 7px;
      border-bottom:1px solid #d6dde1;background:#fafbfc
    }
    .mpgd-autoeq-preview-head strong{font-size:8px;color:#44515c}
    .mpgd-autoeq-preview-head span{margin-left:auto;font-size:7px;color:#78858e}
    .mpgd-autoeq-preview-list{
      max-height:132px;overflow:auto;padding:4px;background:#f8fafb
    }
    .mpgd-autoeq-preview-empty{padding:12px 6px;color:#9aa4ab;font-size:7.5px;text-align:center}
    .mpgd-autoeq-preview-row{
      min-height:27px;display:grid;grid-template-columns:24px minmax(0,1fr);
      align-items:center;gap:4px;padding:2px 5px;border:1px solid #d9dfe3;border-radius:4px;
      background:#fff
    }
    .mpgd-autoeq-preview-row+.mpgd-autoeq-preview-row{margin-top:3px}
    .mpgd-autoeq-preview-row b{font-size:7px;color:#a94a0b}
    .mpgd-autoeq-preview-row span{
      min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      font-size:7px;color:#596771;font-variant-numeric:tabular-nums
    }
    .mpgd-autoeq-metrics{
      display:grid;grid-template-columns:1fr 1fr;gap:5px
    }
    .mpgd-autoeq-metric{
      min-height:31px;padding:5px 6px;border:1px solid #d5dce1;border-radius:4px;background:#fff
    }
    .mpgd-autoeq-metric b{display:block;font-size:6.8px;color:#89959e}
    .mpgd-autoeq-metric span{display:block;margin-top:3px;font-size:8px;font-weight:850;color:#394650}
    @media(max-width:700px){
      .mpgd-autoeq-window{width:min(324px,calc(100vw - 10px))}
      .mpgd-autoeq-grid{grid-template-columns:1fr}
      .mpgd-autoeq-open{padding:0 6px;font-size:6.8px}
      .mpgd-autoeq-actions{grid-template-columns:auto auto auto}
      .mpgd-autoeq-status{grid-column:1/-1}
    }
  `;
  document.head.appendChild(style);
}

function clamp(value,min,max){
  const number=Number(value);
  if(!Number.isFinite(number)) return min;
  return Math.max(min,Math.min(max,number));
}
function inputFrequency(value){
  const number=Number(value);
  if(!Number.isFinite(number)) return '';
  return String(Math.round(number*1000)/1000);
}
function automaticCrossoverRange(filterId){
  if(!passbandMetadata) return null;
  const filter=filterApi.get(filterId);
  const canonical=filterApi.getOutput(filterId);
  if(!filter||!canonical) return null;

  const fs=Number(filter.sampleRateHz||canonical.sample_rate_hz);
  const maximum=Number.isFinite(fs)&&fs>0?Math.min(20000,fs/2*.98):20000;
  return passbandMetadata.effectiveRange(canonical,{minHz:20,maxHz:maximum});
}
function applyAutomaticCrossoverRange(filterId,panel,{force=false}={}){
  if(!panel) return null;
  const range=automaticCrossoverRange(filterId);
  if(!range) return null;
  if(!force&&panel.dataset.autoeqRangeMode==='manual') return range;

  const from=panel.querySelector('[data-autoeq-fmin]');
  const to=panel.querySelector('[data-autoeq-fmax]');
  if(!from||!to) return range;
  from.value=inputFrequency(range.fromHz);
  to.value=inputFrequency(range.toHz);
  panel.dataset.autoeqRangeMode='auto';
  panel.dataset.autoeqRangeSignature=range.fromHz+'|'+range.toHz+'|'+range.filterCount;
  previews.delete(String(filterId));
  renderPreview(panel,null);
  return range;
}
function crossoverRangeStatus(range){
  if(!range||range.appliedCount<1) return 'Ready';
  const label='XO range '+inputFrequency(range.fromHz)+'–'+inputFrequency(range.toHz)+' Hz';
  return range.valid?label:label+' · no overlapping passband';
}
function isAutoBand(band){
  return String(band?.id||'').startsWith(AUTO_BAND_PREFIX);
}
function percentileAbs(values,p=.95){
  const finite=[];
  for(const value of values){
    const n=Math.abs(Number(value));
    if(Number.isFinite(n)) finite.push(n);
  }
  if(!finite.length) return NaN;
  finite.sort((a,b)=>a-b);
  const index=Math.min(finite.length-1,Math.max(0,Math.ceil(p*finite.length)-1));
  return finite[index];
}
function maxAbs(values){
  let out=NaN;
  for(const value of values){
    const n=Math.abs(Number(value));
    if(!Number.isFinite(n)) continue;
    out=Number.isFinite(out)?Math.max(out,n):n;
  }
  return out;
}
function median(values){
  const finite=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!finite.length) return NaN;
  const mid=Math.floor(finite.length/2);
  return finite.length%2?finite[mid]:(finite[mid-1]+finite[mid])/2;
}
function clampPanelPosition(x,y,panel){
  const width=panel.offsetWidth||336;
  const height=panel.offsetHeight||380;
  return {
    x:Math.max(5,Math.min(window.innerWidth-width-5,x)),
    y:Math.max(5,Math.min(window.innerHeight-height-5,y))
  };
}
function bringPanelFront(panel){
  panelZ+=1;
  panel.style.zIndex=String(panelZ);
}
function startPanelDrag(event,panel){
  if(event.button!==undefined&&event.button!==0) return;
  if(event.target.closest('button,input,label,select,textarea,a')) return;
  event.preventDefault();
  bringPanelFront(panel);
  const pointerId=event.pointerId;
  const handle=event.currentTarget;
  const rect=panel.getBoundingClientRect();
  const dx=event.clientX-rect.left;
  const dy=event.clientY-rect.top;
  try{handle.setPointerCapture(pointerId)}catch{}
  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    if(moveEvent.cancelable) moveEvent.preventDefault();
    const pos=clampPanelPosition(moveEvent.clientX-dx,moveEvent.clientY-dy,panel);
    panel.style.left=pos.x+'px';
    panel.style.top=pos.y+'px';
    panel._position=pos;
  };
  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    try{if(handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)}catch{}
  };
  window.addEventListener('pointermove',move,{passive:false});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
}

function estimateQ(frequency,residual,index){
  const center=Math.abs(Number(residual[index]));
  if(!(center>0)) return 1.41421356;
  const threshold=center*.5;
  const sign=Math.sign(residual[index])||1;
  let left=index;
  let right=index;
  while(left>0){
    const value=Number(residual[left-1]);
    if(!Number.isFinite(value)||Math.sign(value)!==sign||Math.abs(value)<threshold) break;
    left-=1;
  }
  while(right<residual.length-1){
    const value=Number(residual[right+1]);
    if(!Number.isFinite(value)||Math.sign(value)!==sign||Math.abs(value)<threshold) break;
    right+=1;
  }
  const f0=Number(frequency[index]);
  const fLo=Number(frequency[left]);
  const fHi=Number(frequency[right]);
  const bandwidth=fHi-fLo;
  if(!(Number.isFinite(f0)&&f0>0&&Number.isFinite(bandwidth)&&bandwidth>0)) return 1.41421356;
  return clamp(f0/bandwidth,MIN_Q,MAX_Q);
}
function candidateCorrectionDb(residualValue,maxBoost,maxCut){
  const wanted=-Number(residualValue);
  if(!Number.isFinite(wanted)) return 0;
  return Math.max(-maxCut,Math.min(maxBoost,wanted));
}
function localMedianMagnitude(frequency,magnitude,index){
  const f0=Number(frequency[index]);
  if(!(f0>0)) return NaN;
  const bucket=[];
  for(let i=0;i<frequency.length;i++){
    const f=Number(frequency[i]);
    const m=Number(magnitude[i]);
    if(!(f>0&&Number.isFinite(m))) continue;
    if(Math.abs(Math.log2(f/f0))<=NULL_WINDOW_OCT) bucket.push(m);
  }
  return median(bucket);
}
function shouldProtectNull(frequency,baselineMagnitude,index,gainDb){
  if(!(gainDb>0)) return false;
  const current=Number(baselineMagnitude[index]);
  const local=localMedianMagnitude(frequency,baselineMagnitude,index);
  return Number.isFinite(current)&&Number.isFinite(local)&&(local-current)>=NULL_PROTECT_DEPTH_DB;
}
function removeAutoContribution(frequency,magnitude,autoBands,fs){
  const baseline=new Float64Array(magnitude.length);
  for(let i=0;i<magnitude.length;i++){
    let value=Number(magnitude[i]);
    if(!Number.isFinite(value)){baseline[i]=NaN;continue;}
    for(const band of autoBands){
      try{value-=rbj.responseAt(Number(frequency[i]),band,fs).magnitudeDb}catch{}
    }
    baseline[i]=value;
  }
  return baseline;
}

function prepareProblem(filterId,options){
  const filter=filterApi.get(filterId);
  const canonical=filterApi.getOutput(filterId);
  if(!filter||!canonical) throw new Error('Connect an input before AutoEQ.');
  canonicalApi.validate(canonical);
  const views=canonicalApi.views(canonical);
  const frequency=views.frequency_hz;
  const magnitude=views.magnitude_db;
  const coherence=views.coherence;
  if(!(frequency&&magnitude&&frequency.length===magnitude.length)) throw new Error('Magnitude data is unavailable.');

  const fs=Number(filter.sampleRateHz||canonical.sample_rate_hz);
  if(!(Number.isFinite(fs)&&fs>0)) throw new Error('Sample Rate is required for AutoEQ.');

  const nyquistLimit=Math.min(20000,fs/2*.98);
  const fMin=clamp(options.fMin,20,nyquistLimit);
  const fMax=clamp(options.fMax,20,nyquistLimit);
  if(!(fMax>fMin)) throw new Error('Frequency To must be higher than From.');

  const targetDb=clamp(options.targetDb,-40,40);
  const minCoherence=clamp(options.minCoherence,0,1);
  const maxBoost=clamp(options.maxBoost,0,24);
  const maxCut=clamp(options.maxCut,0,24);
  const manualCount=Math.round(clamp(options.bandCount,1,24));
  const limit=options.autoCount?AUTO_BAND_LIMIT:manualCount;

  const autoBands=filter.bands.filter(band=>isAutoBand(band)&&band.graphKind!=='phase');
  const baselineMagnitude=removeAutoContribution(frequency,magnitude,autoBands,fs);

  const indexMap=[];
  for(let i=0;i<frequency.length;i++){
    const f=Number(frequency[i]);
    const m=Number(baselineMagnitude[i]);
    const c=coherence?Number(coherence[i]):1;
    if(!(Number.isFinite(f)&&f>=fMin&&f<=fMax&&Number.isFinite(m))) continue;
    if(Number.isFinite(c)&&c<minCoherence) continue;
    indexMap.push(i);
  }
  if(indexMap.length<3) throw new Error('Not enough trusted points inside the AutoEQ range.');

  const fitFrequency=new Float64Array(indexMap.length);
  const fitBaseline=new Float64Array(indexMap.length);
  const fitCoherence=new Float64Array(indexMap.length);
  const residual=new Float64Array(indexMap.length);
  for(let n=0;n<indexMap.length;n++){
    const i=indexMap[n];
    fitFrequency[n]=Number(frequency[i]);
    fitBaseline[n]=Number(baselineMagnitude[i]);
    const c=coherence?Number(coherence[i]):1;
    fitCoherence[n]=Number.isFinite(c)?clamp(c,0,1):1;
    residual[n]=fitBaseline[n]-targetDb;
  }

  return {
    filter,canonical,fs,fMin,fMax,targetDb,minCoherence,maxBoost,maxCut,limit,
    autoCount:options.autoCount===true,
    nullProtect:options.nullProtect!==false,
    fitFrequency,fitBaseline,fitCoherence,residual
  };
}

function proposeBands(filterId,options){
  const problem=prepareProblem(filterId,options);
  const {
    fs,maxBoost,maxCut,limit,autoCount,nullProtect,
    fitFrequency,fitBaseline,fitCoherence,residual
  }=problem;

  const beforeResidual=Float64Array.from(residual);
  const proposed=[];
  const usedCenters=[];
  const stamp=Date.now().toString(36);

  for(let bandIndex=0;bandIndex<limit;bandIndex++){
    let bestIndex=-1;
    let bestGain=0;
    let bestScore=-1;

    for(let i=0;i<fitFrequency.length;i++){
      const f=fitFrequency[i];
      if(usedCenters.some(center=>Math.abs(Math.log2(f/center))<.08)) continue;
      const gain=candidateCorrectionDb(residual[i],maxBoost,maxCut);
      if(nullProtect&&shouldProtectNull(fitFrequency,fitBaseline,i,gain)) continue;
      const score=Math.abs(gain)*(.50+.50*fitCoherence[i]);
      if(score>bestScore){
        bestScore=score;
        bestGain=gain;
        bestIndex=i;
      }
    }

    if(bestIndex<0||Math.abs(bestGain)<MIN_GAIN_DB) break;
    if(autoCount&&Math.abs(bestGain)<AUTO_STOP_DB) break;

    const band={
      id:AUTO_BAND_PREFIX+stamp+'-'+(sequence++),
      type:'peaking',
      frequencyHz:fitFrequency[bestIndex],
      gainDb:bestGain,
      q:estimateQ(fitFrequency,residual,bestIndex),
      graphKind:'magnitude'
    };
    rbj.normalizeOperation(band,fs);
    proposed.push(band);
    usedCenters.push(band.frequencyHz);

    for(let i=0;i<fitFrequency.length;i++){
      const response=rbj.responseAt(fitFrequency[i],band,fs);
      residual[i]+=response.magnitudeDb;
    }
  }

  if(!proposed.length) throw new Error(autoCount
    ?'No trusted correction remains above the Auto stop range.'
    :'No usable correction band was found.');

  return {
    filterId:String(filterId),
    fs,
    bands:proposed,
    stats:{
      pointCount:fitFrequency.length,
      beforeP95Db:percentileAbs(beforeResidual,.95),
      afterP95Db:percentileAbs(residual,.95),
      beforeMaxDb:maxAbs(beforeResidual),
      afterMaxDb:maxAbs(residual)
    },
    options:{
      fMin:problem.fMin,fMax:problem.fMax,targetDb:problem.targetDb,
      minCoherence:problem.minCoherence,maxBoost,maxCut,
      bandCount:problem.limit,autoCount,nullProtect
    }
  };
}

function applyProposal(filterId,proposal){
  if(!proposal?.bands?.length) throw new Error('Preview AutoEQ before applying.');
  const filter=filterApi.get(filterId);
  if(!filter) throw new Error('AutoEQ filter no longer exists.');
  const manualBands=filter.bands.filter(band=>!isAutoBand(band));
  filterApi.setBands(filterId,[...manualBands,...proposal.bands],proposal.fs);
  previews.set(String(filterId),proposal);
  return proposal.bands.length;
}
function clearAutoBands(filterId){
  const filter=filterApi.get(filterId);
  if(!filter) return 0;
  const autoCount=filter.bands.filter(isAutoBand).length;
  if(!autoCount) return 0;
  const kept=filter.bands.filter(band=>!isAutoBand(band));
  filterApi.setBands(filterId,kept,filter.sampleRateHz);
  previews.delete(String(filterId));
  return autoCount;
}

function renderPreview(panel,proposal=null){
  const list=panel.querySelector('[data-autoeq-preview-list]');
  const summary=panel.querySelector('[data-autoeq-preview-summary]');
  const before=panel.querySelector('[data-autoeq-before]');
  const after=panel.querySelector('[data-autoeq-after]');
  if(!list) return;
  list.replaceChildren();

  if(!proposal?.bands?.length){
    const empty=document.createElement('div');
    empty.className='mpgd-autoeq-preview-empty';
    empty.textContent='Preview has not been calculated';
    list.appendChild(empty);
    if(summary) summary.textContent='0 bands';
    if(before) before.textContent='—';
    if(after) after.textContent='—';
    return;
  }

  proposal.bands.forEach((band,index)=>{
    const row=document.createElement('div');
    row.className='mpgd-autoeq-preview-row';
    const number=document.createElement('b');
    number.textContent=String(index+1);
    const text=document.createElement('span');
    text.textContent=Math.round(band.frequencyHz*10)/10+' Hz · '+(band.gainDb>=0?'+':'')+
      band.gainDb.toFixed(2)+' dB · Q '+band.q.toFixed(2);
    row.append(number,text);
    list.appendChild(row);
  });
  if(summary) summary.textContent=proposal.bands.length+' band'+(proposal.bands.length===1?'':'s');
  if(before) before.textContent=Number.isFinite(proposal.stats.beforeP95Db)
    ?proposal.stats.beforeP95Db.toFixed(2)+' dB P95':'—';
  if(after) after.textContent=Number.isFinite(proposal.stats.afterP95Db)
    ?proposal.stats.afterP95Db.toFixed(2)+' dB P95':'—';
}

function readOptions(panel){
  return {
    maxBoost:panel.querySelector('[data-autoeq-boost]').value,
    maxCut:panel.querySelector('[data-autoeq-cut]').value,
    bandCount:panel.querySelector('[data-autoeq-count]').value,
    autoCount:panel.querySelector('[data-autoeq-auto]').checked,
    fMin:panel.querySelector('[data-autoeq-fmin]').value,
    fMax:panel.querySelector('[data-autoeq-fmax]').value,
    targetDb:panel.querySelector('[data-autoeq-target]').value,
    minCoherence:panel.querySelector('[data-autoeq-coherence]').value,
    nullProtect:panel.querySelector('[data-autoeq-null]').checked
  };
}
function setBusy(panel,busy){
  panel.querySelectorAll('[data-autoeq-preview],[data-autoeq-add],[data-autoeq-clear]')
    .forEach(button=>{button.disabled=!!busy;});
}
function calculatePreview(filterId,panel){
  const proposal=proposeBands(filterId,readOptions(panel));
  previews.set(String(filterId),proposal);
  renderPreview(panel,proposal);
  return proposal;
}

function closePanel(filterId){
  const panel=panels.get(String(filterId));
  if(panel) panel.hidden=true;
}
function buildPanel(filterId,anchor){
  ensureStyle();
  const panel=document.createElement('section');
  panel.className='mpgd-autoeq-window';
  panel.dataset.filterId=filterId;
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-label','AutoEQ');
  panel.innerHTML=
    '<header class="mpgd-autoeq-head">'+
      '<strong>AutoEQ</strong>'+
      '<button type="button" class="mpgd-autoeq-close" aria-label="Close AutoEQ">×</button>'+
    '</header>'+
    '<div class="mpgd-autoeq-body">'+
      '<div class="mpgd-autoeq-grid">'+
        '<label class="mpgd-autoeq-field mpgd-autoeq-field--compact"><span>From</span><span class="mpgd-autoeq-number"><input type="number" min="20" max="20000" step="1" value="20" data-autoeq-fmin><b>Hz</b></span></label>'+
        '<label class="mpgd-autoeq-field mpgd-autoeq-field--compact"><span>To</span><span class="mpgd-autoeq-number"><input type="number" min="20" max="20000" step="1" value="20000" data-autoeq-fmax><b>Hz</b></span></label>'+
      '</div>'+
      '<label class="mpgd-autoeq-field"><span>Target Level</span><span class="mpgd-autoeq-number"><input type="number" min="-40" max="40" step="0.1" value="0" data-autoeq-target><b>dB</b></span></label>'+
      '<div class="mpgd-autoeq-grid">'+
        '<label class="mpgd-autoeq-field mpgd-autoeq-field--compact"><span>Max Boost</span><span class="mpgd-autoeq-number"><input type="number" min="0" max="24" step="0.1" value="6" data-autoeq-boost><b>dB</b></span></label>'+
        '<label class="mpgd-autoeq-field mpgd-autoeq-field--compact"><span>Max Cut</span><span class="mpgd-autoeq-number"><input type="number" min="0" max="24" step="0.1" value="12" data-autoeq-cut><b>dB</b></span></label>'+
      '</div>'+
      '<div class="mpgd-autoeq-grid">'+
        '<label class="mpgd-autoeq-field mpgd-autoeq-field--compact"><span>Min Coherence</span><span class="mpgd-autoeq-number"><input type="number" min="0" max="1" step="0.05" value="0.5" data-autoeq-coherence><b></b></span></label>'+
        '<label class="mpgd-autoeq-null"><input type="checkbox" checked data-autoeq-null><span>Protect nulls &gt;6 dB</span></label>'+
      '</div>'+
      '<div class="mpgd-autoeq-count-row">'+
        '<label class="mpgd-autoeq-count-main"><span>Bands</span><input type="number" min="1" max="24" step="1" value="8" data-autoeq-count></label>'+
        '<label class="mpgd-autoeq-auto"><input type="checkbox" data-autoeq-auto><span>Auto</span></label>'+
      '</div>'+
      '<section class="mpgd-autoeq-preview">'+
        '<header class="mpgd-autoeq-preview-head"><strong>Candidate Bands</strong><span data-autoeq-preview-summary>0 bands</span></header>'+
        '<div class="mpgd-autoeq-preview-list" data-autoeq-preview-list></div>'+
      '</section>'+
      '<div class="mpgd-autoeq-metrics">'+
        '<div class="mpgd-autoeq-metric"><b>Before residual</b><span data-autoeq-before>—</span></div>'+
        '<div class="mpgd-autoeq-metric"><b>Predicted residual</b><span data-autoeq-after>—</span></div>'+
      '</div>'+
      '<div class="mpgd-autoeq-actions">'+
        '<button type="button" class="mpgd-autoeq-button" data-autoeq-preview>Preview</button>'+
        '<button type="button" class="mpgd-autoeq-button mpgd-autoeq-add" data-autoeq-add>Add</button>'+
        '<button type="button" class="mpgd-autoeq-button mpgd-autoeq-clear" data-autoeq-clear>Clear Auto</button>'+
        '<span class="mpgd-autoeq-status" data-autoeq-status>Ready</span>'+
      '</div>'+
    '</div>';

  document.body.appendChild(panel);
  panels.set(String(filterId),panel);
  bringPanelFront(panel);

  const head=panel.querySelector('.mpgd-autoeq-head');
  const count=panel.querySelector('[data-autoeq-count]');
  const auto=panel.querySelector('[data-autoeq-auto]');
  const status=panel.querySelector('[data-autoeq-status]');
  const previewButton=panel.querySelector('[data-autoeq-preview]');
  const addButton=panel.querySelector('[data-autoeq-add]');
  const clearButton=panel.querySelector('[data-autoeq-clear]');

  panel.dataset.autoeqRangeMode='auto';
  const initialRange=applyAutomaticCrossoverRange(filterId,panel,{force:true});
  status.textContent=crossoverRangeStatus(initialRange);

  head.addEventListener('pointerdown',event=>startPanelDrag(event,panel));
  panel.addEventListener('pointerdown',()=>bringPanelFront(panel));
  panel.querySelector('.mpgd-autoeq-close').addEventListener('click',()=>{panel.hidden=true;});
  auto.addEventListener('change',()=>{
    count.disabled=auto.checked;
    previews.delete(String(filterId));
    renderPreview(panel,null);
    status.textContent=auto.checked?'Auto band count':'Manual band count';
  });

  panel.querySelectorAll('input').forEach(input=>{
    if(input===auto) return;
    input.addEventListener('input',()=>{
      if(input.matches('[data-autoeq-fmin],[data-autoeq-fmax]')){
        panel.dataset.autoeqRangeMode='manual';
      }
      previews.delete(String(filterId));
      renderPreview(panel,null);
      status.textContent='Settings changed · Preview again';
    });
    input.addEventListener('change',()=>{
      previews.delete(String(filterId));
      renderPreview(panel,null);
    });
  });

  previewButton.addEventListener('click',()=>{
    setBusy(panel,true);
    status.textContent='Calculating preview…';
    try{
      const proposal=calculatePreview(filterId,panel);
      status.textContent='Preview '+proposal.bands.length+' bands · no changes applied';
    }catch(error){
      renderPreview(panel,null);
      status.textContent=error instanceof Error?error.message:'AutoEQ preview failed';
    }finally{
      setBusy(panel,false);
    }
  });

  addButton.addEventListener('click',()=>{
    setBusy(panel,true);
    status.textContent='Calculating + adding…';
    try{
      const proposal=calculatePreview(filterId,panel);
      const added=applyProposal(filterId,proposal);
      status.textContent='Added '+added+' AutoEQ band'+(added===1?'':'s')+' · manual bands preserved';
    }catch(error){
      status.textContent=error instanceof Error?error.message:'AutoEQ failed';
    }finally{
      setBusy(panel,false);
    }
  });

  clearButton.addEventListener('click',()=>{
    setBusy(panel,true);
    try{
      const removed=clearAutoBands(filterId);
      renderPreview(panel,null);
      status.textContent=removed?'Cleared '+removed+' AutoEQ band'+(removed===1?'':'s'):'No AutoEQ bands to clear';
    }catch(error){
      status.textContent=error instanceof Error?error.message:'Could not clear AutoEQ bands';
    }finally{
      setBusy(panel,false);
    }
  });

  renderPreview(panel,previews.get(String(filterId))||null);

  requestAnimationFrame(()=>{
    const rect=anchor?.getBoundingClientRect?.();
    const initial=panel._position||{
      x:rect?Math.min(window.innerWidth-panel.offsetWidth-6,Math.max(6,rect.left)):Math.max(6,(window.innerWidth-panel.offsetWidth)/2),
      y:rect?Math.min(window.innerHeight-panel.offsetHeight-6,Math.max(6,rect.bottom+8)):Math.max(6,(window.innerHeight-panel.offsetHeight)/2)
    };
    const pos=clampPanelPosition(initial.x,initial.y,panel);
    panel.style.left=pos.x+'px';
    panel.style.top=pos.y+'px';
    panel._position=pos;
  });
  return panel;
}

function openPanel(filterId,anchor){
  const id=String(filterId||'');
  if(!id) return;
  let panel=panels.get(id);
  if(!panel||!panel.isConnected) panel=buildPanel(id,anchor);
  else{
    panel.dataset.autoeqRangeMode='auto';
    const range=applyAutomaticCrossoverRange(id,panel,{force:true});
    const status=panel.querySelector('[data-autoeq-status]');
    if(status) status.textContent=crossoverRangeStatus(range);
  }
  panel.hidden=false;
  renderPreview(panel,previews.get(id)||null);
  bringPanelFront(panel);
}
function enhanceFilterWindow(win){
  if(!(win instanceof HTMLElement)) return;
  const filterId=String(win.dataset.filterId||'');
  if(!filterId) return;
  const magHead=win.querySelector('.mpgd-filter-card[data-filter-card="magnitude"] .mpgd-filter-card-head');
  if(!magHead||magHead.querySelector('.mpgd-autoeq-open')) return;
  const title=magHead.querySelector('strong');
  if(!title) return;

  const button=document.createElement('button');
  button.type='button';
  button.className='mpgd-autoeq-open';
  button.textContent='AutoEQ';
  button.setAttribute('aria-label','Open AutoEQ');
  button.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    openPanel(filterId,button);
  });
  title.insertAdjacentElement('afterend',button);

  const close=win.querySelector('.mpgd-filter-window-close');
  if(close&&!close.dataset.autoeqBound){
    close.dataset.autoeqBound='1';
    close.addEventListener('click',()=>closePanel(filterId));
  }
}
function scanWindows(){
  document.querySelectorAll('.mpgd-filter-window').forEach(enhanceFilterWindow);
  for(const [filterId,panel] of panels){
    if(!document.querySelector('.mpgd-filter-window[data-filter-id="'+CSS.escape(filterId)+'"]')){
      panel.remove();
      panels.delete(filterId);
      previews.delete(filterId);
    }
  }
}

ensureStyle();
scanWindows();
new MutationObserver(()=>scanWindows()).observe(document.body,{childList:true,subtree:true});

document.addEventListener('raptor:crossoveroutputchange',()=>{
  for(const [filterId,panel] of panels){
    if(!panel.isConnected) continue;
    previews.delete(String(filterId));
    renderPreview(panel,null);
    if(panel.dataset.autoeqRangeMode==='manual'){
      const status=panel.querySelector('[data-autoeq-status]');
      if(status) status.textContent='Upstream XO changed · manual range preserved';
      continue;
    }
    const range=applyAutomaticCrossoverRange(filterId,panel);
    const status=panel.querySelector('[data-autoeq-status]');
    if(status) status.textContent=crossoverRangeStatus(range);
  }
});

window.addEventListener('resize',()=>{
  for(const panel of panels.values()){
    if(panel.hidden||!panel.isConnected) continue;
    const rect=panel.getBoundingClientRect();
    const pos=clampPanelPosition(rect.left,rect.top,panel);
    panel.style.left=pos.x+'px';
    panel.style.top=pos.y+'px';
    panel._position=pos;
  }
},{passive:true});

document.addEventListener('keydown',event=>{
  if(event.key!=='Escape') return;
  const front=[...panels.values()]
    .filter(panel=>panel.isConnected&&!panel.hidden)
    .sort((a,b)=>(Number(b.style.zIndex)||0)-(Number(a.style.zIndex)||0))[0];
  if(front) front.hidden=true;
});

window.RaptorMagPhaseGdAutoEq=Object.freeze({
  open:openPanel,
  preview(filterId,options){return proposeBands(filterId,options||{});},
  apply(filterId,proposal){return applyProposal(filterId,proposal);},
  clear(filterId){return clearAutoBands(filterId);}
});
})();
