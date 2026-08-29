(()=>{
'use strict';

const api=window.RaptorPipeline;
const canvas=document.getElementById('pipelineNodeCanvas');
const wireSvg=document.querySelector('.pipeline-wire-layer');
const measurementNode=document.getElementById('measurementNode');
const measurementList=document.getElementById('measurementList');
const canonicalApi=window.RaptorMeasurementCanonicalV1||null;
if(!api||!canvas||!wireSvg||!measurementNode||!measurementList||!canonicalApi) return;

const SVG_NS='http://www.w3.org/2000/svg';
const TYPES=new Set(['lowpass','highpass']);
const SLOPES=Object.freeze([12,24,48,96,192]);
const FREQUENCIES=Object.freeze([
  20,25,31.5,40,50,63,80,90,100,110,125,160,200,250,315,400,500,630,800,
  1000,1250,1600,2000,2500,3150,3400,4000,5000,6300,8000,10000,12500,16000,20000
]);
const MODEL='LINKWITZ_RILEY_BILINEAR_V1';

let activeCard=null;
let sequence=1;
let persistentWireGroup=null;

function makeId(type){
  return (type==='lowpass'?'lp':'hp')+'-'+Date.now().toString(36)+'-'+(sequence++);
}
function labelFor(type){return type==='lowpass'?'Lowpass Filter':'Highpass Filter';}
function defaultFilter(type,position={x:390,y:150}){
  return {
    id:makeId(type),
    type,
    label:labelFor(type),
    position:{
      x:Number.isFinite(position.x)?position.x:390,
      y:Number.isFinite(position.y)?position.y:150
    },
    input:null,
    bypass:false,
    slopeDbOct:24,
    frequencyHz:1000,
    sampleRateHz:null
  };
}
function cloneFilter(filter,rekey=false){
  const type=TYPES.has(filter?.type)?filter.type:'lowpass';
  const slope=SLOPES.includes(Number(filter?.slopeDbOct))?Number(filter.slopeDbOct):24;
  const frequency=FREQUENCIES.includes(Number(filter?.frequencyHz))?Number(filter.frequencyHz):1000;
  return {
    id:rekey?makeId(type):String(filter?.id||makeId(type)),
    type,
    label:labelFor(type),
    position:{
      x:Number(filter?.position?.x)||390,
      y:Number(filter?.position?.y)||150
    },
    input:filter?.input?.id?{kind:'measurement',id:String(filter.input.id)}:null,
    bypass:filter?.bypass===true,
    slopeDbOct:slope,
    frequencyHz:frequency,
    sampleRateHz:Number.isFinite(Number(filter?.sampleRateHz))&&Number(filter.sampleRateHz)>0?Number(filter.sampleRateHz):null
  };
}
function normalizeFilter(filter){
  if(!filter||typeof filter!=='object') return defaultFilter('lowpass');
  const normalized=cloneFilter(filter,false);
  Object.assign(filter,normalized);
  return filter;
}
function ensureFilters(card){
  if(!card) return [];
  if(!card._raptorLineState) card._raptorLineState={version:1,nodes:{}};
  if(!card._raptorLineState.nodes) card._raptorLineState.nodes={};
  if(!Array.isArray(card._raptorLineState.nodes.crossoverFilters)){
    card._raptorLineState.nodes.crossoverFilters=[];
  }
  const filters=card._raptorLineState.nodes.crossoverFilters;
  for(let i=0;i<filters.length;i++) filters[i]=normalizeFilter(filters[i]);
  return filters;
}
function activeFilters(){return activeCard?ensureFilters(activeCard):[];}
function filterById(id){return activeFilters().find(filter=>filter.id===id)||null;}
function sourceEntry(filter){
  return filter.input?.id?api.getMeasurement?.(filter.input.id)||null:null;
}
function sourceColor(filter){return sourceEntry(filter)?.color||'#8FA6B8';}
function sampleRateFor(filter){
  const entry=sourceEntry(filter);
  const value=Number(filter.sampleRateHz??entry?.sampleRate??entry?.canonical?.sample_rate_hz);
  return Number.isFinite(value)&&value>0?value:null;
}
function baseViews(filter){
  const canonical=sourceEntry(filter)?.canonical||null;
  if(!canonical) return null;
  try{
    canonicalApi.validate(canonical);
    return canonicalApi.views(canonical);
  }catch{
    return null;
  }
}
function principalRad(value){return Math.atan2(Math.sin(value),Math.cos(value));}

function linkwitzRileyDelta(type,frequencyHz,cutoffHz,slopeDbOct,sampleRateHz){
  if(!TYPES.has(type)) throw new RangeError('Unsupported crossover type');
  if(!SLOPES.includes(slopeDbOct)) throw new RangeError('Unsupported crossover slope');
  if(!(frequencyHz>0&&cutoffHz>0&&sampleRateHz>0&&cutoffHz<sampleRateHz/2)) throw new RangeError('Invalid crossover geometry');

  const f=Math.min(frequencyHz,sampleRateHz/2*(1-1e-12));
  const butterworthOrder=slopeDbOct/12;
  const warped=2*sampleRateHz*Math.tan(Math.PI*f/sampleRateHz);
  const omegaC=2*sampleRateHz*Math.tan(Math.PI*cutoffHz/sampleRateHz);

  let logMagnitude=0;
  let phase=0;

  for(let k=0;k<butterworthOrder;k++){
    const theta=Math.PI*(2*k+butterworthOrder+1)/(2*butterworthOrder);
    const poleRe=omegaC*Math.cos(theta);
    const poleIm=omegaC*Math.sin(theta);

    const denRe=-poleRe;
    const denIm=warped-poleIm;
    let numRe,numIm;

    if(type==='lowpass'){
      numRe=-poleRe;
      numIm=-poleIm;
    }else{
      numRe=0;
      numIm=warped;
    }

    const numMagnitude=Math.hypot(numRe,numIm);
    const denMagnitude=Math.hypot(denRe,denIm);
    if(!(numMagnitude>0&&denMagnitude>0)){
      return {magnitudeDb:-Infinity,phaseRad:0};
    }

    logMagnitude+=Math.log(numMagnitude)-Math.log(denMagnitude);
    phase+=Math.atan2(numIm,numRe)-Math.atan2(denIm,denRe);
  }

  // Linkwitz-Riley = two identical Butterworth sections in cascade.
  return {
    magnitudeDb:(40/Math.LN10)*logMagnitude,
    phaseRad:principalRad(2*phase)
  };
}

function derivedViews(filter){
  const base=baseViews(filter);
  if(!base) return null;
  if(filter.bypass) return base;

  const fs=sampleRateFor(filter);
  if(!fs||!(filter.frequencyHz<fs/2)) return null;

  const frequency=base.frequency_hz;
  const magnitude=base.magnitude_db;
  const phase=base.phase_deg;
  if(!(frequency&&magnitude&&phase)) return null;

  const outMagnitude=new Float64Array(frequency.length);
  const outPhase=new Float64Array(frequency.length);

  for(let i=0;i<frequency.length;i++){
    const f=Number(frequency[i]);
    const sourceMagnitude=Number(magnitude[i]);
    const sourcePhase=Number(phase[i]);
    if(!(Number.isFinite(f)&&f>0&&Number.isFinite(sourceMagnitude)&&Number.isFinite(sourcePhase))) return null;

    const delta=linkwitzRileyDelta(filter.type,f,filter.frequencyHz,filter.slopeDbOct,fs);
    outMagnitude[i]=sourceMagnitude+delta.magnitudeDb;
    outPhase[i]=principalRad(sourcePhase*Math.PI/180+delta.phaseRad)*180/Math.PI;
  }

  return Object.freeze({
    ...base,
    magnitude_db:outMagnitude,
    phase_deg:outPhase,
    crossover_geometry:Object.freeze({
      model:MODEL,
      type:filter.type,
      cutoff_hz:filter.frequencyHz,
      slope_db_oct:filter.slopeDbOct,
      butterworth_order:filter.slopeDbOct/12,
      lr_order:filter.slopeDbOct/6,
      sample_rate_hz:fs,
      canonical_mutated:false
    })
  });
}

function getOutput(filterId){
  const filter=filterById(filterId);
  if(!filter) return null;
  const entry=sourceEntry(filter);
  const views=derivedViews(filter);
  if(!entry||!views) return null;
  return {
    schema:'raptor.response_descriptor.v1',
    filterId:filter.id,
    filterType:filter.type,
    outputKind:'response',
    bypass:filter.bypass===true,
    sourceMeasurementId:entry.id,
    color:entry.color||null,
    frequency_hz:views.frequency_hz,
    magnitude_db:views.magnitude_db,
    phase_deg:views.phase_deg,
    coherence:views.coherence||null,
    sampleRateHz:sampleRateFor(filter),
    processing:Object.freeze({
      model:MODEL,
      type:filter.type,
      cutoffFrequencyHz:filter.frequencyHz,
      slopeDbOct:filter.slopeDbOct
    }),
    canonicalMutated:false
  };
}

function hexTint(hex,alpha=.10){
  const value=String(hex||'').replace('#','');
  const full=value.length===3?value.split('').map(c=>c+c).join(''):value;
  if(!/^[0-9a-f]{6}$/i.test(full)) return 'rgba(143,166,184,'+alpha+')';
  const n=parseInt(full,16);
  return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+alpha+')';
}
function clampNodePosition(position,node=null){
  const width=node?.offsetWidth||242;
  const height=node?.offsetHeight||148;
  const maxX=Math.max(8,canvas.scrollWidth-width-12);
  const maxY=Math.max(8,canvas.scrollHeight-height-12);
  return {
    x:Math.max(8,Math.min(maxX,Number(position.x)||8)),
    y:Math.max(8,Math.min(maxY,Number(position.y)||8))
  };
}
function startNodeDrag(event,node,filter){
  if(event.button!==undefined&&event.button!==0) return;
  if(event.target.closest('button,input,label,select,textarea,a')) return;
  event.preventDefault();
  const pointerId=event.pointerId;
  const rect=node.getBoundingClientRect();
  const canvasRect=canvas.getBoundingClientRect();
  const grabX=event.clientX-rect.left;
  const grabY=event.clientY-rect.top;
  node.classList.add('is-dragging');
  try{node.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    if(moveEvent.cancelable) moveEvent.preventDefault();
    const next=clampNodePosition({
      x:moveEvent.clientX-canvasRect.left+canvas.scrollLeft-grabX,
      y:moveEvent.clientY-canvasRect.top+canvas.scrollTop-grabY
    },node);
    filter.position=next;
    node.style.left=next.x+'px';
    node.style.top=next.y+'px';
    renderConnections();
  };
  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    node.classList.remove('is-dragging');
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    try{if(node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId)}catch{}
  };
  window.addEventListener('pointermove',move,{passive:false});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
}

function frequencyLabel(value){
  if(value>=1000){
    const k=value/1000;
    return (Number.isInteger(k)?k:k.toFixed(k<10?2:1).replace(/0+$/,'').replace(/\.$/,''))+' kHz';
  }
  return value+' Hz';
}
function validFrequencyOptions(filter){
  const fs=sampleRateFor(filter);
  return FREQUENCIES.filter(value=>!fs||value<fs/2);
}
function normalizeFrequencyForSource(filter){
  const options=validFrequencyOptions(filter);
  if(!options.length) return;
  if(options.includes(filter.frequencyHz)) return;
  const target=filter.frequencyHz;
  filter.frequencyHz=options.reduce((best,value)=>
    Math.abs(value-target)<Math.abs(best-target)?value:best
  ,options[0]);
}
function applyLineage(node,filter){
  const entry=sourceEntry(filter);
  const color=entry?.color||'#8FA6B8';
  node.classList.toggle('has-lineage',!!entry);
  node.classList.toggle('is-bypassed',filter.bypass===true);
  node.style.setProperty('--lineage-color',color);
  node.style.setProperty('--lineage-tint',hexTint(color,.12));
  node.style.setProperty('--lineage-tint-soft',hexTint(color,.055));

  const inputName=node.querySelector('[data-xo-input-name]');
  if(inputName) inputName.textContent=entry?.name||'Not connected';

  const input=node.querySelector('.xo-filter-input');
  const output=node.querySelector('.xo-filter-output');
  if(input){
    input.classList.toggle('is-connected',!!entry);
    input.style.setProperty('--port-color',color);
  }
  if(output) output.style.setProperty('--port-color',color);
}

function buildNode(filter,index){
  const node=document.createElement('section');
  node.className='xo-filter-node';
  node.dataset.filterId=filter.id;
  node.dataset.filterType=filter.type;
  node.setAttribute('aria-label',labelFor(filter.type)+' '+(index+1));

  const pos=clampNodePosition(filter.position,node);
  filter.position=pos;
  node.style.left=pos.x+'px';
  node.style.top=pos.y+'px';

  const head=document.createElement('header');
  head.className='xo-filter-node-head';
  const title=document.createElement('div');
  title.className='xo-filter-node-title';
  title.innerHTML='<strong>'+labelFor(filter.type)+'</strong><span>'+filter.id+'</span>';
  head.appendChild(title);

  const body=document.createElement('div');
  body.className='xo-filter-node-body';

  const inputPane=document.createElement('div');
  inputPane.className='xo-filter-input-pane';
  const input=document.createElement('button');
  input.type='button';
  input.className='xo-filter-input';
  input.dataset.filterInput=filter.id;
  input.title='Input';
  const inputCopy=document.createElement('div');
  inputCopy.className='xo-filter-input-copy';
  inputCopy.innerHTML='<span>INPUT</span><strong data-xo-input-name>Not connected</strong>';
  inputPane.append(input,inputCopy);

  const controls=document.createElement('div');
  controls.className='xo-filter-controls';

  const slopeLabel=document.createElement('label');
  slopeLabel.className='xo-filter-control';
  slopeLabel.innerHTML='<span>Slope</span>';
  const slope=document.createElement('select');
  slope.setAttribute('aria-label','Crossover slope');
  for(const value of SLOPES){
    const option=document.createElement('option');
    option.value=String(value);
    option.textContent=value+' dB/oct';
    option.selected=value===filter.slopeDbOct;
    slope.appendChild(option);
  }
  slope.addEventListener('change',()=>{
    filter.slopeDbOct=Number(slope.value);
    document.dispatchEvent(new CustomEvent('raptor:crossoverfilterchange',{
      detail:{filterId:filter.id,type:filter.type,slopeDbOct:filter.slopeDbOct,frequencyHz:filter.frequencyHz}
    }));
  });
  slopeLabel.appendChild(slope);

  const frequencyLabelEl=document.createElement('label');
  frequencyLabelEl.className='xo-filter-control';
  frequencyLabelEl.innerHTML='<span>Frequency</span>';
  const frequency=document.createElement('select');
  frequency.setAttribute('aria-label','Crossover frequency');
  const fs=sampleRateFor(filter);
  for(const value of FREQUENCIES){
    const option=document.createElement('option');
    option.value=String(value);
    option.textContent=frequencyLabel(value);
    option.disabled=!!fs&&value>=fs/2;
    option.selected=value===filter.frequencyHz;
    frequency.appendChild(option);
  }
  frequency.addEventListener('change',()=>{
    filter.frequencyHz=Number(frequency.value);
    document.dispatchEvent(new CustomEvent('raptor:crossoverfilterchange',{
      detail:{filterId:filter.id,type:filter.type,slopeDbOct:filter.slopeDbOct,frequencyHz:filter.frequencyHz}
    }));
  });
  frequencyLabelEl.appendChild(frequency);

  controls.append(slopeLabel,frequencyLabelEl);

  const outputPane=document.createElement('div');
  outputPane.className='xo-filter-output-pane';
  const outputCopy=document.createElement('div');
  outputCopy.className='xo-filter-output-copy';
  outputCopy.innerHTML='<span>OUTPUT</span><strong>Response</strong>';
  const output=document.createElement('button');
  output.type='button';
  output.className='xo-filter-output';
  output.dataset.filterId=filter.id;
  output.title='Response output';
  output.setAttribute('aria-label','Response output from '+filter.id);
  output.addEventListener('pointerdown',event=>{
    event.stopPropagation();
    const descriptor=getOutput(filter.id);
    document.dispatchEvent(new CustomEvent('raptor:filteroutputwirestart',{
      detail:{
        filterId:filter.id,
        filterType:filter.type,
        outputKind:'response',
        bypass:filter.bypass===true,
        sourceMeasurementId:filter.input?.id||null,
        color:sourceColor(filter),
        hasData:!!descriptor
      }
    }));
  });
  outputPane.append(outputCopy,output);

  body.append(inputPane,controls,outputPane);

  const foot=document.createElement('footer');
  foot.className='xo-filter-node-foot';

  const bypassLabel=document.createElement('label');
  bypassLabel.className='xo-filter-bypass';
  const bypass=document.createElement('input');
  bypass.type='checkbox';
  bypass.checked=filter.bypass===true;
  bypass.setAttribute('aria-label','Bypass '+filter.id);
  bypass.addEventListener('change',event=>{
    event.stopPropagation();
    filter.bypass=bypass.checked;
    applyLineage(node,filter);
    document.dispatchEvent(new CustomEvent('raptor:filterbypasschange',{
      detail:{filterId:filter.id,filterType:filter.type,bypass:filter.bypass}
    }));
  });
  const bypassText=document.createElement('span');
  bypassText.textContent='Bypass';
  bypassLabel.append(bypass,bypassText);

  const model=document.createElement('span');
  model.className='xo-filter-model';
  model.textContent='LR';

  const remove=document.createElement('button');
  remove.type='button';
  remove.className='xo-filter-delete';
  remove.textContent='Delete';
  remove.addEventListener('click',event=>{
    event.stopPropagation();
    const ok=window.confirm('Delete '+labelFor(filter.type)+' '+filter.id+'?');
    if(ok) deleteFilter(filter.id);
  });

  foot.append(bypassLabel,model,remove);
  node.append(head,body,foot);
  node.addEventListener('pointerdown',event=>startNodeDrag(event,node,filter));
  node.addEventListener('contextmenu',event=>event.stopPropagation());

  applyLineage(node,filter);
  return node;
}

function removeRenderedNodes(){
  canvas.querySelectorAll('.xo-filter-node').forEach(node=>{
    const filterId=node.dataset.filterId;
    if(filterId) api.unregisterInput?.('xo:'+filterId+':input');
    node.remove();
  });
}
function renderNodes(){
  removeRenderedNodes();
  if(!activeCard){
    ensureWireGroup().replaceChildren();
    return;
  }

  activeFilters().forEach((filter,index)=>{
    if(filter.input?.id&&!api.getMeasurement?.(filter.input.id)){
      filter.input=null;
      filter.sampleRateHz=null;
    }
    normalizeFrequencyForSource(filter);
    const node=buildNode(filter,index);
    canvas.appendChild(node);
    const input=node.querySelector('.xo-filter-input');
    api.registerInput?.('xo:'+filter.id+':input',input,{
      radius:50,
      canAccept:entry=>!!entry&&!filter.input?.id,
      onConnect:entry=>connectInput(filter,entry)
    });
  });

  requestAnimationFrame(renderConnections);
}
function createFilter(type,x,y){
  if(!activeCard||!TYPES.has(type)) return null;
  const filter=defaultFilter(type,clampNodePosition({x:x-121,y:y-74}));
  ensureFilters(activeCard).push(filter);
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filtercreated',{
    detail:{
      lineId:activeCard.dataset.lineId||null,
      filterId:filter.id,
      filterType:filter.type,
      x:filter.position.x,
      y:filter.position.y
    }
  }));
  return filter;
}
function deleteFilter(filterId){
  if(!activeCard) return false;
  const filters=ensureFilters(activeCard);
  const index=filters.findIndex(filter=>filter.id===filterId);
  if(index<0) return false;
  const filter=filters[index];
  filters.splice(index,1);
  api.unregisterInput?.('xo:'+filterId+':input');
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filterdeleted',{
    detail:{filterId,filterType:filter.type}
  }));
  return true;
}
function connectInput(filter,entry){
  if(!filter||!entry||filter.input?.id) return false;
  filter.input={kind:'measurement',id:entry.id};
  filter.sampleRateHz=Number(entry.sampleRate??entry.canonical?.sample_rate_hz)||null;
  normalizeFrequencyForSource(filter);
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filterinputchange',{
    detail:{filterId:filter.id,filterType:filter.type,sourceId:entry.id,connected:true,color:entry.color||null}
  }));
  return true;
}
function disconnectInput(filter){
  if(!filter?.input?.id) return false;
  const sourceId=filter.input.id;
  filter.input=null;
  filter.sampleRateHz=null;
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filterinputchange',{
    detail:{filterId:filter.id,filterType:filter.type,sourceId,connected:false}
  }));
  return true;
}

function ensureWireGroup(){
  if(persistentWireGroup?.isConnected) return persistentWireGroup;
  persistentWireGroup=wireSvg.querySelector('.xo-persistent-wires');
  if(!persistentWireGroup){
    persistentWireGroup=document.createElementNS(SVG_NS,'g');
    persistentWireGroup.setAttribute('class','pipeline-persistent-wires xo-persistent-wires');
    const preview=document.getElementById('pipelineWirePreview');
    if(preview) wireSvg.insertBefore(persistentWireGroup,preview);
    else wireSvg.appendChild(persistentWireGroup);
  }
  return persistentWireGroup;
}
function measurementHandle(fileId){
  const files=(activeCard?activeCard._raptorLineState?.nodes?.measurement?.files:[])||[];
  const index=files.findIndex(file=>file.id===fileId);
  if(index<0) return null;
  return [...measurementList.querySelectorAll('.measurement-file')][index]?.querySelector('.measurement-output')||null;
}
function canvasPointFor(element){
  const canvasRect=canvas.getBoundingClientRect();
  const rect=element.getBoundingClientRect();
  return {
    x:rect.left+rect.width/2-canvasRect.left+canvas.scrollLeft,
    y:rect.top+rect.height/2-canvasRect.top+canvas.scrollTop
  };
}
function wireCurve(start,end){
  const bend=Math.max(52,Math.abs(end.x-start.x)*.38);
  return 'M '+start.x+' '+start.y+' C '+(start.x+bend)+' '+start.y+', '+(end.x-bend)+' '+end.y+', '+end.x+' '+end.y;
}
function renderConnections(){
  const group=ensureWireGroup();
  group.replaceChildren();
  if(!activeCard) return;

  for(const filter of activeFilters()){
    const entry=sourceEntry(filter);
    const source=entry?measurementHandle(entry.id):null;
    const target=canvas.querySelector('.xo-filter-node[data-filter-id="'+filter.id+'"] .xo-filter-input');
    if(!entry||!source||!target) continue;

    const d=wireCurve(canvasPointFor(source),canvasPointFor(target));
    const hit=document.createElementNS(SVG_NS,'path');
    hit.setAttribute('class','pipeline-persistent-wire-hit');
    hit.setAttribute('d',d);
    hit.dataset.wireId='xo-input:'+filter.id;
    hit.dataset.sourceId=entry.id;
    hit.dataset.targetId=filter.id;

    const path=document.createElementNS(SVG_NS,'path');
    path.setAttribute('class','pipeline-persistent-wire');
    path.setAttribute('stroke',entry.color||'#8FA6B8');
    path.setAttribute('d',d);

    const flow=document.createElementNS(SVG_NS,'path');
    flow.setAttribute('class','pipeline-wire-flow');
    flow.setAttribute('d',d);
    group.append(hit,path,flow);
  }
}

document.addEventListener('raptor:pipelinefilterrequest',event=>{
  const type=event.detail?.filterType;
  if(!TYPES.has(type)||!activeCard) return;
  createFilter(type,Number(event.detail.x)||390,Number(event.detail.y)||150);
});
document.addEventListener('raptor:pipelinedisconnectrequest',event=>{
  const wireId=String(event.detail?.wireId||'');
  if(!wireId.startsWith('xo-input:')) return;
  const filterId=wireId.slice('xo-input:'.length);
  const filter=filterById(filterId);
  if(!filter) return;
  if(event.detail?.sourceId&&String(event.detail.sourceId)!==String(filter.input?.id||'')) return;
  disconnectInput(filter);
});

const baseCreate=api.createState?.bind(api);
if(baseCreate){
  api.createState=()=>{
    const state=baseCreate();
    if(!state.nodes) state.nodes={};
    state.nodes.crossoverFilters=[];
    return state;
  };
}
const baseClone=api.cloneState?.bind(api);
if(baseClone){
  api.cloneState=state=>{
    const clone=baseClone(state);
    if(!clone.nodes) clone.nodes={};
    clone.nodes.crossoverFilters=Array.isArray(state?.nodes?.crossoverFilters)
      ?state.nodes.crossoverFilters.map(filter=>cloneFilter(filter,true))
      :[];
    return clone;
  };
}
const baseLoad=api.load?.bind(api);
if(baseLoad){
  api.load=card=>{
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
      activeCard=null;
      removeRenderedNodes();
      ensureWireGroup().replaceChildren();
    }
    baseDelete(card);
  };
}

new MutationObserver(()=>{
  if(!activeCard) return;
  for(const filter of activeFilters()){
    const node=canvas.querySelector('.xo-filter-node[data-filter-id="'+filter.id+'"]');
    if(node) applyLineage(node,filter);
  }
  requestAnimationFrame(renderConnections);
}).observe(measurementList,{childList:true,subtree:false});

new MutationObserver(()=>requestAnimationFrame(renderConnections))
  .observe(measurementNode,{attributes:true,attributeFilter:['style']});
new ResizeObserver(()=>requestAnimationFrame(renderConnections)).observe(measurementNode);
canvas.addEventListener('scroll',()=>requestAnimationFrame(renderConnections),{passive:true});

window.RaptorCrossoverFilter=Object.freeze({
  model:MODEL,
  create:createFilter,
  list:()=>activeFilters().map(filter=>cloneFilter(filter,false)),
  get:filterId=>{
    const filter=filterById(filterId);
    return filter?cloneFilter(filter,false):null;
  },
  getOutput,
  responseAt(filterId,frequencyHz){
    const filter=filterById(filterId);
    const fs=filter?sampleRateFor(filter):null;
    if(!filter||!fs) return null;
    return linkwitzRileyDelta(filter.type,Number(frequencyHz),filter.frequencyHz,filter.slopeDbOct,fs);
  },
  setBypass(filterId,bypass){
    const filter=filterById(filterId);
    if(!filter) return false;
    filter.bypass=!!bypass;
    renderNodes();
    return true;
  },
  delete:deleteFilter,
  refresh:renderNodes,
  refreshConnections:renderConnections
});
})();
