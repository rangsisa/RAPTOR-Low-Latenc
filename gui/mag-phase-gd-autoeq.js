(()=>{
'use strict';

const filterApi=window.RaptorMagPhaseGdFilter;
const canonicalApi=window.RaptorMeasurementCanonicalV1;
const rbj=window.RaptorEqGeometryRBJ;
if(!filterApi||!canonicalApi||!rbj) return;

const panels=new Map();
let panelZ=2720;
let sequence=1;
const AUTO_BAND_LIMIT=16;
const AUTO_STOP_DB=.50;
const MIN_GAIN_DB=.05;
const MIN_Q=.20;
const MAX_Q=10;

function ensureStyle(){
  if(document.getElementById('mpgdAutoEqStyle')) return;
  const style=document.createElement('style');
  style.id='mpgdAutoEqStyle';
  style.textContent=`
    .mpgd-autoeq-open{
      height:18px;
      padding:0 7px;
      border:1px solid #c58a5d;
      border-radius:4px;
      background:#fff7f0;
      color:#a94a0b;
      font-size:7px;
      font-weight:850;
      line-height:1;
      cursor:pointer;
      touch-action:manipulation;
      user-select:none
    }
    .mpgd-autoeq-open:hover,
    .mpgd-autoeq-open:focus-visible{
      outline:none;
      border-color:var(--raptor-active-border,#e86f17);
      background:#fff0e3;
      box-shadow:0 0 0 1px rgba(232,111,23,.12)
    }
    .mpgd-autoeq-window{
      position:fixed;
      z-index:2720;
      width:min(286px,calc(100vw - 12px));
      display:grid;
      grid-template-rows:34px auto;
      border:1px solid #8f9ca7;
      border-radius:8px;
      background:#fff;
      box-shadow:0 16px 36px rgba(21,31,40,.24);
      overflow:hidden;
      color:#34414b
    }
    .mpgd-autoeq-window[hidden]{display:none!important}
    .mpgd-autoeq-head{
      display:flex;
      align-items:center;
      gap:7px;
      padding:0 6px 0 10px;
      border-bottom:1px solid #c1c9cf;
      background:linear-gradient(#fff,#f5f7f8);
      cursor:grab;
      touch-action:none;
      user-select:none
    }
    .mpgd-autoeq-head strong{
      font-size:10px;
      letter-spacing:.025em
    }
    .mpgd-autoeq-close{
      margin-left:auto;
      width:24px;
      height:24px;
      padding:0;
      border:0;
      border-radius:4px;
      background:transparent;
      color:#65737e;
      font-size:17px;
      line-height:1;
      cursor:pointer
    }
    .mpgd-autoeq-close:hover{background:#edf1f3;color:#25313a}
    .mpgd-autoeq-body{
      display:grid;
      gap:8px;
      padding:10px;
      background:#f8fafb
    }
    .mpgd-autoeq-field{
      min-width:0;
      min-height:32px;
      display:grid;
      grid-template-columns:minmax(0,1fr) 92px;
      align-items:center;
      gap:8px;
      padding:5px 7px;
      border:1px solid #d0d7dc;
      border-radius:5px;
      background:#fff
    }
    .mpgd-autoeq-field>span{
      min-width:0;
      font-size:8px;
      font-weight:800;
      color:#46535d
    }
    .mpgd-autoeq-number{
      display:grid;
      grid-template-columns:minmax(0,1fr) 22px;
      align-items:center;
      gap:4px
    }
    .mpgd-autoeq-number input{
      width:100%;
      min-width:0;
      height:24px;
      box-sizing:border-box;
      padding:0 5px;
      border:1px solid #aeb9c2;
      border-radius:4px;
      background:#fff;
      color:#26323d;
      font-size:9px;
      font-variant-numeric:tabular-nums
    }
    .mpgd-autoeq-number b{
      color:#7a8790;
      font-size:7px;
      font-weight:800
    }
    .mpgd-autoeq-count-row{
      min-height:32px;
      display:grid;
      grid-template-columns:minmax(0,1fr) auto;
      align-items:center;
      gap:8px;
      padding:5px 7px;
      border:1px solid #d0d7dc;
      border-radius:5px;
      background:#fff
    }
    .mpgd-autoeq-count-main{
      min-width:0;
      display:grid;
      grid-template-columns:minmax(0,1fr) 64px;
      align-items:center;
      gap:7px
    }
    .mpgd-autoeq-count-main span{
      font-size:8px;
      font-weight:800;
      color:#46535d
    }
    .mpgd-autoeq-count-main input[type="number"]{
      width:64px;
      height:24px;
      box-sizing:border-box;
      padding:0 5px;
      border:1px solid #aeb9c2;
      border-radius:4px;
      font-size:9px;
      font-variant-numeric:tabular-nums
    }
    .mpgd-autoeq-auto{
      height:24px;
      display:inline-flex;
      align-items:center;
      gap:4px;
      padding:0 6px;
      border:1px solid #c4ccd2;
      border-radius:4px;
      background:#f8fafb;
      color:#4d5a65;
      font-size:7.5px;
      font-weight:800;
      cursor:pointer
    }
    .mpgd-autoeq-auto input{
      width:11px;
      height:11px;
      margin:0;
      accent-color:var(--raptor-active,#e86f17)
    }
    .mpgd-autoeq-actions{
      display:flex;
      align-items:center;
      gap:7px
    }
    .mpgd-autoeq-add{
      min-width:74px;
      height:28px;
      padding:0 11px;
      border:1px solid #c26828;
      border-radius:5px;
      background:#e86f17;
      color:#fff;
      font-size:8.5px;
      font-weight:900;
      cursor:pointer;
      touch-action:manipulation
    }
    .mpgd-autoeq-add:hover{background:#cf5f12}
    .mpgd-autoeq-add:disabled{opacity:.45;cursor:default}
    .mpgd-autoeq-status{
      min-width:0;
      flex:1 1 auto;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
      color:#74818b;
      font-size:7px
    }
    @media(max-width:700px){
      .mpgd-autoeq-window{width:min(274px,calc(100vw - 10px))}
      .mpgd-autoeq-field{grid-template-columns:minmax(0,1fr) 86px}
      .mpgd-autoeq-open{padding:0 6px;font-size:6.8px}
    }
  `;
  document.head.appendChild(style);
}

function clamp(value,min,max){
  const number=Number(value);
  if(!Number.isFinite(number)) return min;
  return Math.max(min,Math.min(max,number));
}

function clampPanelPosition(x,y,panel){
  const width=panel.offsetWidth||286;
  const height=panel.offsetHeight||230;
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

function proposeBands(filterId,options){
  const filter=filterApi.get(filterId);
  const canonical=filterApi.getOutput(filterId);
  if(!filter||!canonical) throw new Error('Connect an input before AutoEQ.');
  canonicalApi.validate(canonical);
  const views=canonicalApi.views(canonical);
  const frequency=views.frequency_hz;
  const magnitude=views.magnitude_db;
  if(!(frequency&&magnitude&&frequency.length===magnitude.length)) throw new Error('Magnitude data is unavailable.');

  const fs=Number(filter.sampleRateHz||canonical.sample_rate_hz);
  if(!(Number.isFinite(fs)&&fs>0)) throw new Error('Sample Rate is required for AutoEQ.');
  const maxFrequency=Math.min(20000,fs/2*.98);
  const maxBoost=clamp(options.maxBoost,0,24);
  const maxCut=clamp(options.maxCut,0,24);
  const manualCount=Math.round(clamp(options.bandCount,1,24));
  const limit=options.autoCount?AUTO_BAND_LIMIT:manualCount;

  const indexMap=[];
  for(let i=0;i<frequency.length;i++){
    const f=Number(frequency[i]);
    const m=Number(magnitude[i]);
    if(Number.isFinite(f)&&f>=20&&f<=maxFrequency&&Number.isFinite(m)) indexMap.push(i);
  }
  if(indexMap.length<3) throw new Error('Not enough magnitude points in 20 Hz – Nyquist.');

  const fitFrequency=new Float64Array(indexMap.length);
  const residual=new Float64Array(indexMap.length);
  for(let n=0;n<indexMap.length;n++){
    fitFrequency[n]=Number(frequency[indexMap[n]]);
    residual[n]=Number(magnitude[indexMap[n]]);
  }

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
      const score=Math.abs(gain);
      if(score>bestScore){
        bestScore=score;
        bestGain=gain;
        bestIndex=i;
      }
    }

    if(bestIndex<0||bestScore<MIN_GAIN_DB) break;
    if(options.autoCount&&bestScore<AUTO_STOP_DB) break;

    const band={
      id:'autoeq-'+stamp+'-'+(sequence++),
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

  if(!proposed.length) throw new Error(options.autoCount
    ?'Magnitude is already inside the AutoEQ stop range.'
    :'No usable correction band was found.');

  const nextBands=[...filter.bands,...proposed];
  filterApi.setBands(filterId,nextBands,fs);
  return proposed;
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
      '<label class="mpgd-autoeq-field"><span>Max Boost</span><span class="mpgd-autoeq-number"><input type="number" min="0" max="24" step="0.1" value="6" data-autoeq-boost><b>dB</b></span></label>'+
      '<label class="mpgd-autoeq-field"><span>Max Cut</span><span class="mpgd-autoeq-number"><input type="number" min="0" max="24" step="0.1" value="12" data-autoeq-cut><b>dB</b></span></label>'+
      '<div class="mpgd-autoeq-count-row">'+
        '<label class="mpgd-autoeq-count-main"><span>Bands</span><input type="number" min="1" max="24" step="1" value="8" data-autoeq-count></label>'+
        '<label class="mpgd-autoeq-auto"><input type="checkbox" data-autoeq-auto><span>Auto</span></label>'+
      '</div>'+
      '<div class="mpgd-autoeq-actions">'+
        '<button type="button" class="mpgd-autoeq-add" data-autoeq-add>Add</button>'+
        '<span class="mpgd-autoeq-status" data-autoeq-status>Ready · target 0 dB</span>'+
      '</div>'+
    '</div>';

  document.body.appendChild(panel);
  panels.set(String(filterId),panel);
  bringPanelFront(panel);

  const head=panel.querySelector('.mpgd-autoeq-head');
  const count=panel.querySelector('[data-autoeq-count]');
  const auto=panel.querySelector('[data-autoeq-auto]');
  const status=panel.querySelector('[data-autoeq-status]');
  const add=panel.querySelector('[data-autoeq-add]');

  head.addEventListener('pointerdown',event=>startPanelDrag(event,panel));
  panel.addEventListener('pointerdown',()=>bringPanelFront(panel));
  panel.querySelector('.mpgd-autoeq-close').addEventListener('click',()=>{panel.hidden=true;});
  auto.addEventListener('change',()=>{
    count.disabled=auto.checked;
    status.textContent=auto.checked?'Auto band count · target 0 dB':'Manual band count · target 0 dB';
  });

  add.addEventListener('click',()=>{
    add.disabled=true;
    status.textContent='Calculating…';
    try{
      const proposed=proposeBands(filterId,{
        maxBoost:panel.querySelector('[data-autoeq-boost]').value,
        maxCut:panel.querySelector('[data-autoeq-cut]').value,
        bandCount:count.value,
        autoCount:auto.checked
      });
      status.textContent='Added '+proposed.length+' magnitude band'+(proposed.length===1?'':'s');
    }catch(error){
      status.textContent=error instanceof Error?error.message:'AutoEQ failed';
    }finally{
      add.disabled=false;
    }
  });

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
  panel.hidden=false;
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
    }
  }
}

ensureStyle();
scanWindows();
new MutationObserver(()=>scanWindows()).observe(document.body,{childList:true,subtree:true});

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
})();
