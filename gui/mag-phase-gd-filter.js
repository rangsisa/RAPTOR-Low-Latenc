(()=>{
'use strict';

const api=window.RaptorPipeline;
const canvas=document.getElementById('pipelineNodeCanvas');
const rbj=window.RaptorEqGeometryRBJ||null;
if(!api||!canvas) return;

const SVG_NS='http://www.w3.org/2000/svg';
const F0=20;
const F1=20000;
const GRAPH_WIDTH=1000;
const GRAPH_HEIGHT=220;
const FREQ_TICKS=[20,100,1000,10000,20000];
const FILTER_TYPE='mag-phase-gd';

let activeCard=null;
let filterSequence=1;
let windowZ=2460;
const windows=new Map();
let bandContextMenu=null;
let bandContextRequest=null;

function makeFilterId(){
  return 'mpgd-'+Date.now().toString(36)+'-'+(filterSequence++);
}

function defaultFilterState(position={x:360,y:120}){
  return {
    id:makeFilterId(),
    type:FILTER_TYPE,
    label:'Mag-Phase-GD Filter',
    position:{
      x:Number.isFinite(position.x)?position.x:360,
      y:Number.isFinite(position.y)?position.y:120
    },
    windowPosition:null,
    sampleRateHz:null,
    bands:[],
    ui:{phase:true,magnitude:true,wrap:false,sync:true}
  };
}

function cloneFilter(filter,rekey=false){
  return {
    id:rekey?makeFilterId():String(filter.id||makeFilterId()),
    type:FILTER_TYPE,
    label:'Mag-Phase-GD Filter',
    position:{
      x:Number(filter.position?.x)||360,
      y:Number(filter.position?.y)||120
    },
    windowPosition:filter.windowPosition&&Number.isFinite(filter.windowPosition.x)&&Number.isFinite(filter.windowPosition.y)
      ?{x:filter.windowPosition.x,y:filter.windowPosition.y}
      :null,
    sampleRateHz:Number.isFinite(Number(filter.sampleRateHz))&&Number(filter.sampleRateHz)>0?Number(filter.sampleRateHz):null,
    bands:Array.isArray(filter.bands)?filter.bands.map(band=>({
      id:String(band.id||('band-'+Math.random().toString(36).slice(2,8))),
      type:'peaking',
      frequencyHz:Number(band.frequencyHz),
      gainDb:Number(band.gainDb),
      q:Number(band.q)
    })):[],
    ui:{
      phase:filter.ui?.phase!==false,
      magnitude:filter.ui?.magnitude!==false,
      wrap:filter.ui?.wrap===true,
      sync:filter.ui?.sync!==false
    }
  };
}

function ensureFilters(card){
  if(!card) return [];
  if(!card._raptorLineState) card._raptorLineState={version:1,nodes:{}};
  if(!card._raptorLineState.nodes) card._raptorLineState.nodes={};
  if(!Array.isArray(card._raptorLineState.nodes.magPhaseGdFilters)){
    card._raptorLineState.nodes.magPhaseGdFilters=[];
  }
  card._raptorLineState.nodes.magPhaseGdFilters=
    card._raptorLineState.nodes.magPhaseGdFilters.map(filter=>cloneFilter(filter,false));
  return card._raptorLineState.nodes.magPhaseGdFilters;
}

function activeFilters(){
  return activeCard?ensureFilters(activeCard):[];
}

function filterById(id){
  return activeFilters().find(filter=>filter.id===id)||null;
}

function closeBandContext(){
  if(!bandContextMenu) return;
  bandContextMenu.hidden=true;
  bandContextRequest=null;
}

function closeAllWindows(){
  for(const win of windows.values()) win.remove();
  windows.clear();
  closeBandContext();
}

function removeRenderedNodes(){
  canvas.querySelectorAll('.mpgd-filter-node').forEach(node=>node.remove());
}

function clampNodePosition(position,node=null){
  const width=node?.offsetWidth||178;
  const height=node?.offsetHeight||82;
  const maxX=Math.max(8,canvas.scrollWidth-width-12);
  const maxY=Math.max(8,canvas.scrollHeight-height-12);
  return {
    x:Math.max(8,Math.min(maxX,Number(position.x)||8)),
    y:Math.max(8,Math.min(maxY,Number(position.y)||8))
  };
}

function startNodeDrag(event,node,filter){
  if(event.button!==undefined&&event.button!==0) return;
  if(event.target.closest('button')) return;
  event.preventDefault();
  const pointerId=event.pointerId;
  const canvasRect=canvas.getBoundingClientRect();
  const rect=node.getBoundingClientRect();
  const grabX=event.clientX-rect.left;
  const grabY=event.clientY-rect.top;
  node.classList.add('is-dragging');
  try{node.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    const next=clampNodePosition({
      x:moveEvent.clientX-canvasRect.left+canvas.scrollLeft-grabX,
      y:moveEvent.clientY-canvasRect.top+canvas.scrollTop-grabY
    },node);
    filter.position=next;
    node.style.left=next.x+'px';
    node.style.top=next.y+'px';
  };

  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    node.classList.remove('is-dragging');
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    try{if(node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId)}catch{}
  };

  window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
}

function buildNode(filter,index){
  const node=document.createElement('section');
  node.className='mpgd-filter-node';
  node.dataset.filterId=filter.id;
  node.setAttribute('aria-label','Mag Phase GD Filter '+(index+1));

  const pos=clampNodePosition(filter.position,node);
  filter.position=pos;
  node.style.left=pos.x+'px';
  node.style.top=pos.y+'px';

  const head=document.createElement('header');
  head.className='mpgd-filter-node-head';

  const title=document.createElement('div');
  title.className='mpgd-filter-node-title';
  title.innerHTML='<strong>Mag-Phase-GD Filter</strong><span>'+filter.id+'</span>';

  const open=document.createElement('button');
  open.className='mpgd-filter-open';
  open.type='button';
  open.title='Open filter editor';
  open.setAttribute('aria-label','Open '+filter.id);
  open.textContent='↗';
  open.addEventListener('click',event=>{
    event.stopPropagation();
    openFilterWindow(filter.id);
  });

  head.append(title,open);

  const body=document.createElement('div');
  body.className='mpgd-filter-node-body';
  body.innerHTML='<span class="mpgd-filter-port mpgd-filter-port--in" aria-hidden="true"></span><strong>MAG · PHASE · GD</strong><span class="mpgd-filter-port mpgd-filter-port--out" aria-hidden="true"></span>';

  const foot=document.createElement('footer');
  foot.className='mpgd-filter-node-foot';
  const bands=document.createElement('span');
  bands.textContent=filter.bands.length+' band'+(filter.bands.length===1?'':'s');
  const number=document.createElement('span');
  number.textContent='#'+String(index+1).padStart(2,'0');
  foot.append(bands,number);

  node.append(head,body,foot);
  node.addEventListener('pointerdown',event=>startNodeDrag(event,node,filter));
  node.addEventListener('contextmenu',event=>event.stopPropagation());
  return node;
}

function renderNodes(){
  removeRenderedNodes();
  if(!activeCard) return;
  activeFilters().forEach((filter,index)=>canvas.appendChild(buildNode(filter,index)));
}

function createFilterAt(x,y){
  if(!activeCard) return null;
  const filters=ensureFilters(activeCard);
  const filter=defaultFilterState(clampNodePosition({x:x-88,y:y-40}));
  filters.push(filter);
  renderNodes();

  document.dispatchEvent(new CustomEvent('raptor:filtercreated',{
    detail:{
      lineId:activeCard.dataset.lineId||null,
      filterId:filter.id,
      filterType:FILTER_TYPE,
      x:filter.position.x,
      y:filter.position.y
    }
  }));

  return filter;
}

function log10(value){return Math.log(value)/Math.LN10;}
function xOf(f){return (log10(f)-log10(F0))/(log10(F1)-log10(F0))*GRAPH_WIDTH;}
function yPhase(v){return GRAPH_HEIGHT-((Math.max(-180,Math.min(180,v))+180)/360)*GRAPH_HEIGHT;}
function yMagnitude(v){return GRAPH_HEIGHT-((Math.max(-40,Math.min(40,v))+40)/80)*GRAPH_HEIGHT;}
function wrapDeg(v){return ((v+180)%360+360)%360-180;}

function frequencyAtRatio(ratio){
  return Math.exp(Math.log(F0)+Math.max(0,Math.min(1,ratio))*Math.log(F1/F0));
}

function formatFrequency(value){
  if(value>=1000) return (value/1000).toFixed(value<10000?2:1).replace(/\.0+$|(?<=\.[0-9])0$/,'')+' kHz';
  return value.toFixed(value<100?1:0)+' Hz';
}

function responseForFilter(filter,count=480){
  const frequency=new Float64Array(count);
  const magnitudeDb=new Float64Array(count);
  const phaseDeg=new Float64Array(count);
  const groupDelayMs=new Float64Array(count);
  const rawPhase=new Float64Array(count);
  const fs=filter.sampleRateHz;
  const usableBands=rbj&&fs?filter.bands.filter(band=>
    Number.isFinite(band.frequencyHz)&&band.frequencyHz>0&&band.frequencyHz<fs/2&&
    Number.isFinite(band.gainDb)&&Number.isFinite(band.q)&&band.q>0
  ):[];

  for(let i=0;i<count;i++){
    const f=F0*Math.pow(F1/F0,i/(count-1));
    frequency[i]=f;
    let real=1,imag=0;
    let mag=0;

    for(const band of usableBands){
      const h=rbj.responseAt(f,band,fs);
      const nr=real*h.real-imag*h.imag;
      const ni=real*h.imag+imag*h.real;
      real=nr;imag=ni;
      mag+=h.magnitudeDb;
    }

    magnitudeDb[i]=mag;
    rawPhase[i]=Math.atan2(imag,real);
    phaseDeg[i]=rawPhase[i]*180/Math.PI;
  }

  // Filter-generated phase has explicit realization provenance, so deriving a
  // continuous local branch for GD is valid here and does not alter measurement authority.
  const unwrapped=new Float64Array(count);
  unwrapped[0]=rawPhase[0];
  for(let i=1;i<count;i++){
    let delta=rawPhase[i]-rawPhase[i-1];
    while(delta>Math.PI) delta-=2*Math.PI;
    while(delta<-Math.PI) delta+=2*Math.PI;
    unwrapped[i]=unwrapped[i-1]+delta;
  }

  if(fs){
    for(let i=0;i<count;i++){
      const lo=Math.max(0,i-1);
      const hi=Math.min(count-1,i+1);
      const dw=2*Math.PI*(frequency[hi]-frequency[lo])/fs;
      const gdSamples=dw!==0?-(unwrapped[hi]-unwrapped[lo])/dw:0;
      groupDelayMs[i]=gdSamples/fs*1000;
    }
  }

  return {frequency,magnitudeDb,phaseDeg,groupDelayMs,activeBands:usableBands.length};
}

function phasePath(response){
  let d='';
  let previous=null;
  for(let i=0;i<response.frequency.length;i++){
    const f=response.frequency[i],phase=response.phaseDeg[i];
    const x=xOf(f),y=yPhase(phase);
    if(previous===null){
      d+='M'+x.toFixed(2)+' '+y.toFixed(2)+' ';
    }else{
      const p0=response.phaseDeg[previous];
      const x0=xOf(response.frequency[previous]);
      const delta=phase-p0;
      if(Math.abs(delta)>180){
        let adjusted=phase,boundary=180,opposite=-180;
        if(delta>180){adjusted=phase-360;boundary=-180;opposite=180;}
        else{adjusted=phase+360;boundary=180;opposite=-180;}
        const den=adjusted-p0;
        let t=den===0?0:(boundary-p0)/den;
        t=Math.max(0,Math.min(1,t));
        const xc=x0+(x-x0)*t;
        d+='L'+xc.toFixed(2)+' '+yPhase(boundary).toFixed(2)+' ';
        d+='M'+xc.toFixed(2)+' '+yPhase(opposite).toFixed(2)+' ';
        d+='L'+x.toFixed(2)+' '+y.toFixed(2)+' ';
      }else{
        d+='L'+x.toFixed(2)+' '+y.toFixed(2)+' ';
      }
    }
    previous=i;
  }
  return d.trim();
}

function magnitudePath(response){
  let d='';
  for(let i=0;i<response.frequency.length;i++){
    const x=xOf(response.frequency[i]);
    const y=yMagnitude(response.magnitudeDb[i]);
    d+=(i?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)+' ';
  }
  return d.trim();
}

function nearestIndex(array,target){
  let lo=0,hi=array.length-1;
  while(lo<hi){
    const mid=(lo+hi)>>1;
    if(array[mid]<target) lo=mid+1;
    else hi=mid;
  }
  if(lo<=0) return 0;
  const prev=lo-1;
  return Math.abs(array[lo]-target)<Math.abs(array[prev]-target)?lo:prev;
}

function buildAxisLabels(container){
  container.replaceChildren();
  for(const f of FREQ_TICKS){
    const span=document.createElement('span');
    span.textContent=f>=1000?(f/1000)+'k':String(f);
    span.style.left=(xOf(f)/GRAPH_WIDTH*100)+'%';
    container.appendChild(span);
  }
}

function buildGraph(kind){
  const card=document.createElement('article');
  card.className='mpgd-filter-card';

  const head=document.createElement('header');
  head.className='mpgd-filter-card-head';
  const title=document.createElement('strong');
  title.textContent=kind==='phase'?'Phase':'Magnitude';
  const readout=document.createElement('div');
  readout.className='mpgd-filter-readout';
  readout.dataset.kind=kind;
  readout.textContent=kind==='phase'?'— Hz · —°':'— Hz · — dB';
  const unit=document.createElement('span');
  unit.className='mpgd-filter-unit';
  unit.textContent=kind==='phase'?'deg':'dB';
  head.append(title,readout,unit);

  const plot=document.createElement('div');
  plot.className='mpgd-filter-plot';
  plot.dataset.kind=kind;

  const grid=document.createElement('div');
  grid.className='mpgd-filter-grid';

  const svg=document.createElementNS(SVG_NS,'svg');
  svg.setAttribute('class','mpgd-filter-svg mpgd-filter-svg--'+(kind==='phase'?'phase':'mag'));
  svg.setAttribute('viewBox','0 0 '+GRAPH_WIDTH+' '+GRAPH_HEIGHT);
  svg.setAttribute('preserveAspectRatio','none');
  const trace=document.createElementNS(SVG_NS,'path');
  trace.setAttribute('class','trace');
  svg.appendChild(trace);

  const y=document.createElement('div');
  y.className='mpgd-filter-ylabels';
  y.innerHTML=kind==='phase'
    ?'<span>180°</span><span>0°</span><span>-180°</span>'
    :'<span>40</span><span>0</span><span>-40</span>';

  const x=document.createElement('div');
  x.className='mpgd-filter-xlabels';
  buildAxisLabels(x);

  plot.append(grid,svg,y,x);
  card.append(head,plot);
  return card;
}

function bringToFront(win){
  windowZ+=1;
  for(const item of windows.values()) item.classList.remove('is-front');
  win.style.zIndex=String(windowZ);
  win.classList.add('is-front');
}

function clampWindowPosition(x,y,win){
  const width=win.offsetWidth||760;
  const height=win.offsetHeight||560;
  return {
    x:Math.max(4,Math.min(window.innerWidth-width-4,x)),
    y:Math.max(4,Math.min(window.innerHeight-height-4,y))
  };
}

function startWindowDrag(event,win,filter){
  if(event.button!==undefined&&event.button!==0) return;
  if(event.target.closest('button')) return;
  event.preventDefault();
  bringToFront(win);
  const pointerId=event.pointerId;
  const rect=win.getBoundingClientRect();
  const dx=event.clientX-rect.left;
  const dy=event.clientY-rect.top;
  try{event.currentTarget.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    const pos=clampWindowPosition(moveEvent.clientX-dx,moveEvent.clientY-dy,win);
    win.style.left=pos.x+'px';
    win.style.top=pos.y+'px';
    filter.windowPosition=pos;
  };

  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    try{if(event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture(pointerId)}catch{}
  };

  window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
}

function ensureBandContext(){
  if(bandContextMenu) return bandContextMenu;
  const menu=document.createElement('div');
  menu.className='mpgd-filter-context';
  menu.hidden=true;
  const add=document.createElement('button');
  add.type='button';
  add.textContent='Add Band';
  add.addEventListener('click',()=>{
    const request=bandContextRequest;
    closeBandContext();
    if(!request) return;
    document.dispatchEvent(new CustomEvent('raptor:filteraddbandrequest',{detail:{...request}}));
  });
  menu.appendChild(add);
  document.body.appendChild(menu);
  bandContextMenu=menu;
  return menu;
}

function openBandContext(event,filter,kind){
  event.preventDefault();
  event.stopPropagation();
  const rect=event.currentTarget.getBoundingClientRect();
  const ratio=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)));
  const frequencyHz=frequencyAtRatio(ratio);
  const yRatio=Math.max(0,Math.min(1,(event.clientY-rect.top)/Math.max(1,rect.height)));
  const pointerValue=kind==='phase'?180-yRatio*360:40-yRatio*80;
  bandContextRequest=Object.freeze({
    filterId:filter.id,
    filterType:FILTER_TYPE,
    graphKind:kind,
    frequencyHz,
    pointerValue
  });

  const menu=ensureBandContext();
  menu.hidden=false;
  menu.style.left='0px';
  menu.style.top='0px';
  const mr=menu.getBoundingClientRect();
  menu.style.left=Math.max(5,Math.min(window.innerWidth-mr.width-5,event.clientX))+'px';
  menu.style.top=Math.max(5,Math.min(window.innerHeight-mr.height-5,event.clientY))+'px';
}

function bindPlot(win,filter,plot){
  const kind=plot.dataset.kind;
  plot.addEventListener('pointermove',event=>{
    const response=win._mpgdResponse||responseForFilter(filter);
    const rect=plot.getBoundingClientRect();
    const ratio=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)));
    const f=frequencyAtRatio(ratio);
    const i=nearestIndex(response.frequency,f);
    const phase=response.phaseDeg[i];
    const mag=response.magnitudeDb[i];
    const gd=response.groupDelayMs[i];
    const value=kind==='phase'?phase:mag;

    const readout=win.querySelector('.mpgd-filter-readout[data-kind="'+kind+'"]');
    if(readout) readout.textContent=kind==='phase'
      ?formatFrequency(response.frequency[i])+' · '+phase.toFixed(2)+'°'
      :formatFrequency(response.frequency[i])+' · '+mag.toFixed(3)+' dB';

    const gdValue=win.querySelector('[data-filter-gd]');
    if(gdValue) gdValue.textContent=Number.isFinite(gd)?gd.toFixed(4)+' ms':'—';

    const svg=plot.querySelector('svg');
    let v=svg.querySelector('.cursor-v');
    let h=svg.querySelector('.cursor-h');
    let p=svg.querySelector('.cursor-point');
    if(!v){
      v=document.createElementNS(SVG_NS,'line');v.setAttribute('class','cursor cursor-v');v.setAttribute('y1','0');v.setAttribute('y2',String(GRAPH_HEIGHT));
      h=document.createElementNS(SVG_NS,'line');h.setAttribute('class','cursor cursor-h');h.setAttribute('x1','0');h.setAttribute('x2',String(GRAPH_WIDTH));
      p=document.createElementNS(SVG_NS,'circle');p.setAttribute('class','cursor-point');p.setAttribute('r','3');
      svg.append(v,h,p);
    }
    const xx=xOf(response.frequency[i]);
    const yy=kind==='phase'?yPhase(value):yMagnitude(value);
    v.setAttribute('x1',xx);v.setAttribute('x2',xx);
    h.setAttribute('y1',yy);h.setAttribute('y2',yy);
    p.setAttribute('cx',xx);p.setAttribute('cy',yy);
    v.hidden=h.hidden=p.hidden=false;
  });

  plot.addEventListener('pointerleave',()=>{
    const readout=win.querySelector('.mpgd-filter-readout[data-kind="'+kind+'"]');
    if(readout) readout.textContent=kind==='phase'?'— Hz · —°':'— Hz · — dB';
    plot.querySelectorAll('.cursor,.cursor-point').forEach(node=>node.hidden=true);
  });

  plot.addEventListener('contextmenu',event=>openBandContext(event,filter,kind));
}

function renderWindow(filter,win){
  const response=responseForFilter(filter);
  win._mpgdResponse=response;

  const phaseTrace=win.querySelector('.mpgd-filter-svg--phase .trace');
  const magTrace=win.querySelector('.mpgd-filter-svg--mag .trace');
  if(phaseTrace) phaseTrace.setAttribute('d',phasePath(response));
  if(magTrace) magTrace.setAttribute('d',magnitudePath(response));

  const phaseCard=win.querySelector('.mpgd-filter-card[data-filter-card="phase"]');
  const magCard=win.querySelector('.mpgd-filter-card[data-filter-card="magnitude"]');
  if(phaseCard) phaseCard.style.opacity=filter.ui.phase?'1':'.20';
  if(magCard) magCard.style.opacity=filter.ui.magnitude?'1':'.20';

  const bands=win.querySelector('[data-filter-band-count]');
  if(bands) bands.textContent=filter.bands.length+' band'+(filter.bands.length===1?'':'s');

  const sr=win.querySelector('[data-filter-sr]');
  if(sr) sr.textContent=filter.sampleRateHz?((filter.sampleRateHz/1000).toFixed(1).replace(/\.0$/,'')+' kHz'):'Not bound';

  const status=win.querySelector('[data-filter-status]');
  if(status){
    status.textContent=filter.bands.length===0
      ?'Neutral transfer'
      :(filter.sampleRateHz?response.activeBands+' active band'+(response.activeBands===1?'':'s'):'Waiting for Sample Rate');
  }
}

function buildFilterWindow(filter){
  const win=document.createElement('section');
  win.className='mpgd-filter-window';
  win.dataset.filterId=filter.id;
  win.setAttribute('role','dialog');
  win.setAttribute('aria-label','Mag Phase GD Filter '+filter.id);

  const head=document.createElement('header');
  head.className='mpgd-filter-window-head';

  const title=document.createElement('div');
  title.className='mpgd-filter-window-title';
  title.innerHTML='<strong>Mag-Phase-GD Filter</strong><span>'+filter.id+'</span>';

  const close=document.createElement('button');
  close.className='mpgd-filter-window-close';
  close.type='button';
  close.setAttribute('aria-label','Close filter editor');
  close.textContent='×';
  close.addEventListener('click',()=>{win.hidden=true;win.classList.remove('is-front');});

  head.append(title,close);

  const body=document.createElement('div');
  body.className='mpgd-filter-window-body';

  const main=document.createElement('section');
  main.className='mpgd-filter-main';

  const toolbar=document.createElement('div');
  toolbar.className='mpgd-filter-toolbar';

  const controls=[
    ['phase','Phase'],
    ['magnitude','Magnitude'],
    ['wrap','Wrap phase'],
    ['sync','Sync cursor']
  ];
  for(const [key,label] of controls){
    const item=document.createElement('label');
    item.className='mpgd-filter-check';
    const input=document.createElement('input');
    input.type='checkbox';
    input.checked=!!filter.ui[key];
    input.addEventListener('change',()=>{
      filter.ui[key]=input.checked;
      renderWindow(filter,win);
    });
    const text=document.createElement('span');
    text.textContent=label;
    item.append(input,text);
    toolbar.appendChild(item);
  }
  const chip=document.createElement('span');
  chip.className='mpgd-filter-idchip';
  chip.textContent=filter.id;
  toolbar.appendChild(chip);

  const graphs=document.createElement('section');
  graphs.className='mpgd-filter-graphs';
  const phase=buildGraph('phase');
  phase.dataset.filterCard='phase';
  const mag=buildGraph('magnitude');
  mag.dataset.filterCard='magnitude';
  graphs.append(phase,mag);

  main.append(toolbar,graphs);

  const tools=document.createElement('aside');
  tools.className='mpgd-filter-tools';
  tools.innerHTML=
    '<header class="mpgd-filter-tools-head"><div><strong>FILTER TOOLS</strong><span>Per-instance workspace</span></div></header>'+
    '<div class="mpgd-filter-tools-body">'+
      '<div class="mpgd-filter-metric"><span>Group Delay @ cursor</span><strong data-filter-gd>0.0000 ms</strong></div>'+
      '<div class="mpgd-filter-metric"><span>Sample Rate</span><strong data-filter-sr>Not bound</strong></div>'+
      '<div class="mpgd-filter-metric"><span>Band state</span><strong data-filter-band-count>0 bands</strong></div>'+
      '<div class="mpgd-filter-metric"><span>Status</span><strong data-filter-status>Neutral transfer</strong></div>'+
      '<div class="mpgd-filter-note">This filter owns its own ID and band state. Right-click Phase or Magnitude to request Add Band.</div>'+
    '</div>';

  body.append(main,tools);
  win.append(head,body);
  document.body.appendChild(win);

  head.addEventListener('pointerdown',event=>startWindowDrag(event,win,filter));
  win.addEventListener('pointerdown',()=>bringToFront(win));

  win.querySelectorAll('.mpgd-filter-plot').forEach(plot=>bindPlot(win,filter,plot));
  renderWindow(filter,win);

  requestAnimationFrame(()=>{
    const initial=filter.windowPosition||{
      x:Math.max(8,(window.innerWidth-win.offsetWidth)/2),
      y:Math.max(8,(window.innerHeight-win.offsetHeight)/2)
    };
    const pos=clampWindowPosition(initial.x,initial.y,win);
    win.style.left=pos.x+'px';
    win.style.top=pos.y+'px';
    filter.windowPosition=pos;
  });

  return win;
}

function openFilterWindow(filterId){
  const filter=filterById(filterId);
  if(!filter) return null;
  let win=windows.get(filterId);
  if(!win||!win.isConnected){
    win=buildFilterWindow(filter);
    windows.set(filterId,win);
  }
  win.hidden=false;
  renderWindow(filter,win);
  bringToFront(win);
  return win;
}

function setBands(filterId,bands,sampleRateHz=null){
  const filter=filterById(filterId);
  if(!filter) throw new Error('Unknown Mag-Phase-GD Filter: '+filterId);
  if(!Array.isArray(bands)) throw new TypeError('bands must be an array');

  const fs=sampleRateHz===null?filter.sampleRateHz:Number(sampleRateHz);
  if(fs!==null&&(!Number.isFinite(fs)||fs<=0)) throw new RangeError('sampleRateHz must be > 0');

  const next=bands.map((band,index)=>({
    id:String(band.id||('band-'+(index+1))),
    type:'peaking',
    frequencyHz:Number(band.frequencyHz??band.f0),
    gainDb:Number(band.gainDb??band.gain),
    q:Number(band.q??band.Q)
  }));

  if(fs&&rbj){
    next.forEach(band=>rbj.normalizeOperation(band,fs));
  }

  filter.bands=next;
  filter.sampleRateHz=fs||null;
  renderNodes();
  const win=windows.get(filterId);
  if(win&&!win.hidden) renderWindow(filter,win);
  return getFilter(filterId);
}

function getFilter(filterId){
  const filter=filterById(filterId);
  return filter?cloneFilter(filter,false):null;
}

function listFilters(){
  return activeFilters().map(filter=>cloneFilter(filter,false));
}

document.addEventListener('raptor:pipelinefilterrequest',event=>{
  if(event.detail?.filterType!==FILTER_TYPE) return;
  if(!activeCard) return;
  createFilterAt(Number(event.detail.x)||360,Number(event.detail.y)||120);
});

document.addEventListener('pointerdown',event=>{
  if(bandContextMenu&&!bandContextMenu.hidden&&!bandContextMenu.contains(event.target)) closeBandContext();
});

document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    closeBandContext();
    const front=[...windows.values()].filter(win=>!win.hidden).sort((a,b)=>(Number(b.style.zIndex)||0)-(Number(a.style.zIndex)||0))[0];
    if(front) front.hidden=true;
  }
});

window.addEventListener('resize',()=>{
  closeBandContext();
  for(const [id,win] of windows){
    if(win.hidden) continue;
    const filter=filterById(id);
    if(!filter) continue;
    const rect=win.getBoundingClientRect();
    const pos=clampWindowPosition(rect.left,rect.top,win);
    win.style.left=pos.x+'px';
    win.style.top=pos.y+'px';
    filter.windowPosition=pos;
  }
});

const baseCreate=api.createState?.bind(api);
if(baseCreate){
  api.createState=()=>{
    const state=baseCreate();
    if(!state.nodes) state.nodes={};
    state.nodes.magPhaseGdFilters=[];
    return state;
  };
}

const baseClone=api.cloneState?.bind(api);
if(baseClone){
  api.cloneState=state=>{
    const clone=baseClone(state);
    if(!clone.nodes) clone.nodes={};
    clone.nodes.magPhaseGdFilters=Array.isArray(state?.nodes?.magPhaseGdFilters)
      ?state.nodes.magPhaseGdFilters.map(filter=>cloneFilter(filter,true))
      :[];
    return clone;
  };
}

const baseLoad=api.load?.bind(api);
if(baseLoad){
  api.load=card=>{
    closeAllWindows();
    baseLoad(card);
    activeCard=card;
    ensureFilters(card);
    renderNodes();
  };
}

const baseDelete=api.onDelete?.bind(api);
if(baseDelete){
  api.onDelete=card=>{
    if(card===activeCard){
      closeAllWindows();
      activeCard=null;
      removeRenderedNodes();
    }
    baseDelete(card);
  };
}

window.RaptorMagPhaseGdFilter=Object.freeze({
  type:FILTER_TYPE,
  createAt:createFilterAt,
  open:openFilterWindow,
  list:listFilters,
  get:getFilter,
  setBands,
  refresh:renderNodes
});
})();