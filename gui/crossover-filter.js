(()=>{
'use strict';

const api=window.RaptorPipeline;
const workspaceView=window.RaptorPipelineWorkspaceView;
const canvas=document.getElementById('pipelineNodeCanvas');
const wireSvg=document.querySelector('.pipeline-wire-layer');
const measurementNode=document.getElementById('measurementNode');
const measurementList=document.getElementById('measurementList');
const canonicalApi=window.RaptorMeasurementCanonicalV1||null;
if(!api||!workspaceView||!canvas||!wireSvg||!measurementNode||!measurementList||!canonicalApi) return;

const SVG_NS='http://www.w3.org/2000/svg';
const TYPES=new Set(['lowpass','highpass']);
const SLOPES=Object.freeze([12,24,48,96,192]);
const MODEL='LINKWITZ_RILEY_BILINEAR_V1';

let activeCard=null;
let sequence=1;
let persistentWireGroup=null;
let parameterPopover=null;
let parameterPopoverFilterId=null;

function formatCompactFrequency(value){
  const f=Number(value);
  if(!Number.isFinite(f)) return '—';
  if(f>=1000){
    const k=f/1000;
    const text=k>=10?k.toFixed(k%1?1:0):k.toFixed(k%1?2:0);
    return text.replace(/\.0+$|(?<=\.[0-9])0+$/,'')+' kHz';
  }
  return (Number.isInteger(f)?String(f):String(Number(f.toFixed(2))))+' Hz';
}

function slopeIconMarkup(type){
  const path=type==='highpass'
    ?'M8 34 C18 34 24 32 30 25 C36 17 40 10 50 8'
    :'M8 8 C18 8 24 10 30 17 C36 25 40 32 50 34';
  return '<svg viewBox="0 0 58 42" aria-hidden="true"><path class="xo-filter-slope-axis" d="M7 36 H52 M7 6 V36"/><path class="xo-filter-slope-curve" d="'+path+'"/></svg>';
}

function updateSlopeSummary(button,filter){
  if(!button||!filter) return;
  const summary=button.querySelector('.xo-filter-slope-summary');
  if(summary) summary.textContent=filter.slopeDbOct+' dB • '+formatCompactFrequency(filter.frequencyHz);
  button.setAttribute('aria-label','Edit '+labelFor(filter.type)+' slope and frequency. '+filter.slopeDbOct+' dB per octave at '+formatCompactFrequency(filter.frequencyHz));
  button.title='Edit slope and frequency';
}

function closeParameterPopover(){
  if(parameterPopover?.isConnected) parameterPopover.remove();
  parameterPopover=null;
  parameterPopoverFilterId=null;
}

function clampPopoverPosition(anchor,popover){
  const rect=anchor.getBoundingClientRect();
  const width=popover.offsetWidth||250;
  const height=popover.offsetHeight||150;
  const margin=8;
  let left=rect.left+rect.width/2-width/2;
  let top=rect.bottom+8;
  if(top+height>window.innerHeight-margin) top=rect.top-height-8;
  left=Math.max(margin,Math.min(window.innerWidth-width-margin,left));
  top=Math.max(margin,Math.min(window.innerHeight-height-margin,top));
  return {left,top};
}

function openParameterPopover(anchor,filter){
  if(parameterPopoverFilterId===filter.id&&parameterPopover?.isConnected){
    closeParameterPopover();
    return;
  }
  closeParameterPopover();

  const popover=document.createElement('section');
  popover.className='xo-filter-parameter-popover';
  popover.dataset.filterId=filter.id;
  popover.setAttribute('role','dialog');
  popover.setAttribute('aria-label',labelFor(filter.type)+' settings');

  const head=document.createElement('header');
  head.className='xo-filter-parameter-popover-head';
  const title=document.createElement('strong');
  title.textContent=labelFor(filter.type);
  const close=document.createElement('button');
  close.type='button';
  close.className='xo-filter-parameter-popover-close';
  close.setAttribute('aria-label','Close filter settings');
  close.textContent='×';
  close.addEventListener('click',event=>{
    event.stopPropagation();
    closeParameterPopover();
  });
  head.append(title,close);

  const body=document.createElement('div');
  body.className='xo-filter-parameter-popover-body';

  const slopeLabel=document.createElement('label');
  slopeLabel.className='xo-filter-parameter-field';
  const slopeName=document.createElement('span');
  slopeName.textContent='Slope';
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
    const next=Number(slope.value);
    if(next===filter.slopeDbOct) return;
    filter.slopeDbOct=next;
    updateSlopeSummary(anchor,filter);
    document.dispatchEvent(new CustomEvent('raptor:crossoverfilterchange',{
      detail:{filterId:filter.id,type:filter.type,slopeDbOct:filter.slopeDbOct,frequencyHz:filter.frequencyHz}
    }));
    notifyOutputChange(filter.id,filter.type,'slope-change');
  });
  slopeLabel.append(slopeName,slope);

  const frequencyLabel=document.createElement('label');
  frequencyLabel.className='xo-filter-parameter-field';
  const frequencyName=document.createElement('span');
  frequencyName.textContent='Frequency';
  const frequency=document.createElement('input');
  frequency.type='number';
  frequency.inputMode='decimal';
  frequency.step='any';
  frequency.min='0.000001';
  frequency.value=String(filter.frequencyHz);
  frequency.setAttribute('aria-label','Crossover frequency in Hz');
  const maxFrequency=maxFrequencyForFilter(filter);
  if(maxFrequency) frequency.max=String(maxFrequency);

  const commit=()=>{
    const ok=commitFrequencyInput(filter,frequency);
    if(ok) updateSlopeSummary(anchor,filter);
    return ok;
  };
  frequency.addEventListener('change',commit);
  frequency.addEventListener('blur',commit);
  frequency.addEventListener('keydown',event=>{
    if(event.key==='Enter'){
      event.preventDefault();
      if(commit()) frequency.blur();
    }else if(event.key==='Escape'){
      event.preventDefault();
      frequency.value=String(filter.frequencyHz);
      frequency.removeAttribute('aria-invalid');
      closeParameterPopover();
    }
  });
  frequencyLabel.append(frequencyName,frequency);

  body.append(slopeLabel,frequencyLabel);
  popover.append(head,body);
  popover.addEventListener('pointerdown',event=>event.stopPropagation());
  popover.addEventListener('contextmenu',event=>event.stopPropagation());
  document.body.appendChild(popover);

  parameterPopover=popover;
  parameterPopoverFilterId=filter.id;
  requestAnimationFrame(()=>{
    if(!popover.isConnected) return;
    const pos=clampPopoverPosition(anchor,popover);
    popover.style.left=pos.left+'px';
    popover.style.top=pos.top+'px';
    frequency.focus({preventScroll:true});
    frequency.select();
  });
}

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
  const rawFrequency=Number(filter?.frequencyHz);
  const frequency=Number.isFinite(rawFrequency)&&rawFrequency>0?rawFrequency:1000;
  return {
    id:rekey?makeId(type):String(filter?.id||makeId(type)),
    type,
    label:labelFor(type),
    position:{
      x:Number(filter?.position?.x)||390,
      y:Number(filter?.position?.y)||150
    },
    input:filter?.input?.id?{
      kind:filter.input.kind==='filter'?'filter':'measurement',
      id:String(filter.input.id)
    }:null,
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
function sourceRef(filter){
  if(!filter?.input?.id) return null;
  return {
    kind:filter.input.kind==='filter'?'filter':'measurement',
    id:String(filter.input.id)
  };
}
const LINEAGE_BASE_COLOR='#8FA6B8';

function sourceExists(filter){
  const ref=sourceRef(filter);
  if(!ref) return false;
  return ref.kind==='filter'?!!filterById(ref.id):!!api.getMeasurement?.(ref.id);
}

function lineageInfo(filter,seen=new Set()){
  if(!filter) return {active:false,color:LINEAGE_BASE_COLOR,measurementId:null};

  const filterId=String(filter.id||'');
  if(filterId&&seen.has(filterId)){
    return {active:false,color:LINEAGE_BASE_COLOR,measurementId:null};
  }

  const nextSeen=new Set(seen);
  if(filterId) nextSeen.add(filterId);

  const ref=sourceRef(filter);
  if(!ref) return {active:false,color:LINEAGE_BASE_COLOR,measurementId:null};

  if(ref.kind==='measurement'){
    const entry=api.getMeasurement?.(ref.id)||null;
    return {
      active:!!entry,
      color:entry?.color||LINEAGE_BASE_COLOR,
      measurementId:entry?ref.id:null
    };
  }

  const upstream=filterById(ref.id);
  if(!upstream) return {active:false,color:LINEAGE_BASE_COLOR,measurementId:null};
  return lineageInfo(upstream,nextSeen);
}

function sourceColor(filter){
  return lineageInfo(filter).color;
}

function lineageMeasurementName(filter){
  const lineage=lineageInfo(filter);
  if(!lineage.active||!lineage.measurementId) return null;
  return api.getMeasurement?.(lineage.measurementId)?.name||null;
}

function downstreamOutputIds(filterId){
  const rootId=String(filterId||'');
  if(!rootId) return [];
  const affected=new Set([rootId]);

  // This walk is observation/event propagation only. It never rejects,
  // rewrites, or restricts Pipeline topology.
  let expanded=true;
  while(expanded){
    expanded=false;
    for(const candidate of activeFilters()){
      const ref=sourceRef(candidate);
      const candidateId=String(candidate.id||'');
      if(!candidateId||affected.has(candidateId)) continue;
      if(ref?.kind==='filter'&&affected.has(String(ref.id))){
        affected.add(candidateId);
        expanded=true;
      }
    }
  }
  return [...affected];
}

function notifyOutputChange(filterId,filterType,reason){
  const affectedFilterIds=downstreamOutputIds(filterId);
  document.dispatchEvent(new CustomEvent('raptor:crossoveroutputchange',{
    detail:{
      filterId:String(filterId||''),
      filterType:filterType||filterById(filterId)?.type||null,
      reason:String(reason||'output-change'),
      affectedFilterIds
    }
  }));
}

function notifyLineageChange(filterId,filterType,reason){
  const filter=filterById(filterId);
  const lineage=filter?lineageInfo(filter):{active:false,color:LINEAGE_BASE_COLOR,measurementId:null};
  document.dispatchEvent(new CustomEvent('raptor:crossoverlineagechange',{
    detail:{
      filterId:String(filterId||''),
      filterType:filterType||filter?.type||null,
      reason:String(reason||'lineage-change'),
      active:lineage.active===true,
      color:lineage.color,
      measurementId:lineage.measurementId
    }
  }));
}
function sourceName(filter){
  const ref=sourceRef(filter);
  if(!ref) return null;
  if(ref.kind==='measurement') return api.getMeasurement?.(ref.id)?.name||null;
  const upstream=filterById(ref.id);
  return upstream?upstream.label+' · '+upstream.id:null;
}
function sampleRateFor(filter){
  const ref=sourceRef(filter);
  let value=Number(filter.sampleRateHz);
  if(ref?.kind==='measurement'){
    const entry=api.getMeasurement?.(ref.id)||null;
    value=Number(entry?.sampleRate??entry?.canonical?.sample_rate_hz??value);
  }else if(ref?.kind==='filter'){
    const upstream=filterById(ref.id);
    value=Number(upstream?.sampleRateHz??value);
  }
  return Number.isFinite(value)&&value>0?value:null;
}
function sourceCanonical(filter){
  const ref=sourceRef(filter);
  if(!ref) return null;
  if(ref.kind==='measurement'){
    const canonical=api.getMeasurement?.(ref.id)?.canonical||null;
    if(!canonical) return null;
    try{
      canonicalApi.validate(canonical);
      return canonical;
    }catch{
      return null;
    }
  }
  const upstream=filterById(ref.id);
  return upstream?processedCanonical(upstream):null;
}
function canConnectInput(filter,source){
  if(!filter||filter.input?.id||!source?.id) return false;
  try{
    canonicalApi.validate(source.canonical);
    return true;
  }catch{
    return false;
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

function processedCanonical(filter){
  if(!filter) return null;
  const source=sourceCanonical(filter);
  if(!source) return null;

  // LP/HP is intentionally a file/response processor only:
  // Canonical V1 in -> Canonical V1 out. No graph/editor state is involved.
  const output=canonicalApi.clone(source);
  if(filter.bypass) return output;

  const fsValue=Number(source.sample_rate_hz??sampleRateFor(filter));
  const fs=Number.isFinite(fsValue)&&fsValue>0?fsValue:null;
  if(!fs||!(filter.frequencyHz<fs/2)) return null;

  const views=canonicalApi.views(output);
  const frequency=views.frequency_hz;
  const magnitude=views.magnitude_db;
  const phase=views.phase_deg;

  for(let i=0;i<output.points;i++){
    const f=Number(frequency[i]);
    const sourceMagnitude=Number(magnitude[i]);
    const sourcePhase=Number(phase[i]);
    if(!(Number.isFinite(f)&&f>0&&Number.isFinite(sourceMagnitude)&&Number.isFinite(sourcePhase))) return null;

    const delta=linkwitzRileyDelta(filter.type,f,filter.frequencyHz,filter.slopeDbOct,fs);
    magnitude[i]=sourceMagnitude+delta.magnitudeDb;
    phase[i]=principalRad(sourcePhase*Math.PI/180+delta.phaseRad)*180/Math.PI;
  }

  // The payload changed, so a source payload hash must never be carried forward.
  // A later serialization/export stage may compute a fresh hash if required.
  output.payload_sha256=null;
  output.measurement_id=filter.id;
  output.source_name=(source.source_name||sourceName(filter)||'Canonical V1')+' -> '+labelFor(filter.type);
  canonicalApi.validate(output);
  return output;
}

function getOutput(filterId){
  const filter=filterById(filterId);
  return filter?processedCanonical(filter):null;
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
  const maxX=Math.max(8,workspaceView.logicalScrollWidth()-width-12);
  return {
    x:Math.max(8,Math.min(maxX,Number(position.x)||8)),
    // Vertical overflow is intentionally unbounded like Measurement.
    // Moving a filter below the current viewport expands canvas.scrollHeight.
    y:Math.max(8,Number(position.y)||8)
  };
}
function startNodeDrag(event,node,filter){
  if(event.button!==undefined&&event.button!==0) return;
  if(event.target.closest('button,input,label,select,textarea,a')) return;
  event.preventDefault();
  const pointerId=event.pointerId;
  const grab=workspaceView.grabOffsetLogical(event,node);
  node.classList.add('is-dragging');
  try{node.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    if(moveEvent.cancelable) moveEvent.preventDefault();
    const point=workspaceView.clientToLogical(moveEvent.clientX,moveEvent.clientY);
    const next=clampNodePosition({
      x:point.x-grab.x,
      y:point.y-grab.y
    },node);
    filter.position=next;
    workspaceView.positionNode(node,next.x,next.y);
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

function maxFrequencyForFilter(filter){
  const fs=sampleRateFor(filter);
  return fs?fs/2:null;
}
function validFrequencyForFilter(filter,value){
  const frequency=Number(value);
  if(!(Number.isFinite(frequency)&&frequency>0)) return false;
  const max=maxFrequencyForFilter(filter);
  return !max||frequency<max;
}
function commitFrequencyInput(filter,input){
  const next=Number(input.value);
  if(!validFrequencyForFilter(filter,next)){
    input.value=String(filter.frequencyHz);
    input.setAttribute('aria-invalid','true');
    return false;
  }

  input.removeAttribute('aria-invalid');
  if(next===filter.frequencyHz) return true;

  filter.frequencyHz=next;
  document.dispatchEvent(new CustomEvent('raptor:crossoverfilterchange',{
    detail:{
      filterId:filter.id,
      type:filter.type,
      slopeDbOct:filter.slopeDbOct,
      frequencyHz:filter.frequencyHz
    }
  }));
  notifyOutputChange(filter.id,filter.type,'frequency-change');
  return true;
}
function applyLineage(node,filter){
  const linked=sourceExists(filter);
  const lineage=lineageInfo(filter);
  const color=lineage.color;
  node.classList.toggle('has-lineage',lineage.active===true);
  node.classList.toggle('is-bypassed',filter.bypass===true);
  node.style.setProperty('--lineage-color',color);
  node.style.setProperty('--lineage-tint',hexTint(color,.12));
  node.style.setProperty('--lineage-tint-soft',hexTint(color,.055));

  const inputName=node.querySelector('[data-xo-input-name]');
  if(inputName) inputName.textContent=sourceName(filter)||'Not connected';

  const input=node.querySelector('.xo-filter-input');
  const output=node.querySelector('.xo-filter-output');
  if(input){
    input.classList.toggle('is-connected',linked);
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

  const requestedX=Math.max(8,Number(filter.position?.x)||8);
  const requestedY=Math.max(8,Number(filter.position?.y)||8);
  const pos={x:requestedX,y:requestedY};
  filter.position=pos;
  workspaceView.positionNode(node,pos.x,pos.y);

  const head=document.createElement('header');
  head.className='xo-filter-node-head';
  const title=document.createElement('div');
  title.className='xo-filter-node-title';
  const sourceFileName=lineageMeasurementName(filter);
  const headerText=labelFor(filter.type)+(sourceFileName?' · '+sourceFileName:'');
  title.innerHTML='<strong></strong>';
  title.querySelector('strong').textContent=headerText;
  title.title=headerText;
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

  const slopeButton=document.createElement('button');
  slopeButton.type='button';
  slopeButton.className='xo-filter-slope-button';
  slopeButton.dataset.filterType=filter.type;
  slopeButton.innerHTML='<span class="xo-filter-slope-icon">'+slopeIconMarkup(filter.type)+'</span><strong class="xo-filter-slope-summary"></strong>';
  updateSlopeSummary(slopeButton,filter);
  slopeButton.addEventListener('click',event=>{
    event.stopPropagation();
    openParameterPopover(slopeButton,filter);
  });

  controls.appendChild(slopeButton);

  const outputPane=document.createElement('div');
  outputPane.className='xo-filter-output-pane';
  const outputCopy=document.createElement('div');
  outputCopy.className='xo-filter-output-copy';
  outputCopy.innerHTML='<span>OUTPUT</span>';
  const output=document.createElement('button');
  output.type='button';
  output.className='xo-filter-output';
  output.dataset.filterId=filter.id;
  output.title='Response output';
  output.setAttribute('aria-label','Response output from '+filter.id);
  output.addEventListener('pointerdown',event=>{
    event.stopPropagation();
    const canonical=getOutput(filter.id);
    const color=sourceColor(filter);
    api.startCanonicalWire?.(event,{
      kind:'filter',
      id:filter.id,
      name:filter.label,
      color,
      sampleRate:canonical?.sample_rate_hz||null,
      format:canonical?.format||canonicalApi.FORMAT,
      canonical,
      hasData:!!canonical
    },output);
    document.dispatchEvent(new CustomEvent('raptor:filteroutputwirestart',{
      detail:{
        filterId:filter.id,
        filterType:filter.type,
        outputKind:'canonical',
        bypass:filter.bypass===true,
        sourceKind:'filter',
        sourceId:filter.id,
        color,
        format:canonical?.format||canonicalApi.FORMAT,
        canonical,
        hasData:!!canonical
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
    notifyOutputChange(filter.id,filter.type,'bypass-change');
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
  closeParameterPopover();
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
    if(filter.input?.id&&!sourceExists(filter)){
      filter.input=null;
      filter.sampleRateHz=null;
    }
    const node=buildNode(filter,index);
    canvas.appendChild(node);
    const input=node.querySelector('.xo-filter-input');
    api.registerInput?.('xo:'+filter.id+':input',input,{
      radius:50,
      canAccept:source=>canConnectInput(filter,source),
      onConnect:(source,meta)=>connectInput(filter,source,meta)
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
  notifyLineageChange(filterId,filter.type,'filter-delete');
  return true;
}
function connectInput(filter,source,meta={}){
  if(!filter||!source||filter.input?.id) return false;
  const kind=meta.sourceKind==='filter'||source.kind==='filter'?'filter':'measurement';
  const sourceId=String(meta.sourceId??source.id??'');
  if(!sourceId) return false;

  let canonical=source.canonical||null;
  if(!canonical){
    canonical=kind==='filter'?getOutput(sourceId):api.getMeasurementCanonical?.(sourceId)||null;
  }
  try{canonicalApi.validate(canonical)}catch{return false;}

  filter.input={kind,id:sourceId};
  const sourceRate=Number(source.sampleRate??canonical.sample_rate_hz);
  filter.sampleRateHz=Number.isFinite(sourceRate)&&sourceRate>0?sourceRate:null;
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filterinputchange',{
    detail:{
      filterId:filter.id,
      filterType:filter.type,
      sourceKind:kind,
      sourceId,
      connected:true,
      color:sourceColor(filter)
    }
  }));
  notifyLineageChange(filter.id,filter.type,'input-connect');
  notifyOutputChange(filter.id,filter.type,'input-connect');
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
  notifyLineageChange(filter.id,filter.type,'input-disconnect');
  notifyOutputChange(filter.id,filter.type,'input-disconnect');
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
function filterHandle(filterId){
  const node=[...canvas.querySelectorAll('.xo-filter-node')]
    .find(candidate=>candidate.dataset.filterId===String(filterId));
  return node?.querySelector('.xo-filter-output')||null;
}
function sourceHandle(filter){
  const ref=sourceRef(filter);
  if(!ref) return null;
  return ref.kind==='filter'?filterHandle(ref.id):measurementHandle(ref.id);
}
function canvasPointFor(element){
  const canvasRect=canvas.getBoundingClientRect();
  const rect=element.getBoundingClientRect();
  return {
    x:rect.left+rect.width/2-canvasRect.left+canvas.scrollLeft,
    y:rect.top+rect.height/2-canvasRect.top+canvas.scrollTop
  };
}
function wireCurve(start,end,sourceElement=null,targetElement=null){
  return api.routeWire?.(start,end,{sourceElement,targetElement})||'';
}
function renderConnections(){
  const group=ensureWireGroup();
  group.replaceChildren();
  if(!activeCard) return;

  for(const filter of activeFilters()){
    const ref=sourceRef(filter);
    const source=sourceHandle(filter);
    const target=canvas.querySelector('.xo-filter-node[data-filter-id="'+filter.id+'"] .xo-filter-input');
    if(!ref||!source||!target) continue;

    const color=sourceColor(filter);
    const d=wireCurve(canvasPointFor(source),canvasPointFor(target),source,target);
    if(!d) continue;
    const hit=document.createElementNS(SVG_NS,'path');
    hit.setAttribute('class','pipeline-persistent-wire-hit');
    hit.setAttribute('d',d);
    hit.dataset.wireId='xo-input:'+filter.id;
    hit.dataset.sourceKind=ref.kind;
    hit.dataset.sourceId=ref.id;
    hit.dataset.targetId=filter.id;

    const path=document.createElementNS(SVG_NS,'path');
    path.setAttribute('class','pipeline-persistent-wire');
    path.setAttribute('stroke',color);
    path.setAttribute('d',d);

    const flow=document.createElementNS(SVG_NS,'path');
    flow.setAttribute('class','pipeline-wire-flow');
    flow.setAttribute('d',d);
    group.append(hit,path,flow);
  }
}

document.addEventListener('pointerdown',event=>{
  if(!parameterPopover?.isConnected) return;
  if(parameterPopover.contains(event.target)) return;
  if(event.target.closest('.xo-filter-slope-button')) return;
  closeParameterPopover();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&parameterPopover?.isConnected) closeParameterPopover();
});
window.addEventListener('resize',closeParameterPopover);

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
    const sourceFilters=Array.isArray(state?.nodes?.crossoverFilters)
      ?state.nodes.crossoverFilters
      :[];
    const idMap=new Map();
    for(const filter of sourceFilters){
      const type=TYPES.has(filter?.type)?filter.type:'lowpass';
      idMap.set(String(filter?.id||''),makeId(type));
    }
    clone.nodes.crossoverFilters=sourceFilters.map(filter=>{
      const copy=cloneFilter(filter,false);
      copy.id=idMap.get(String(filter?.id||''))||makeId(copy.type);
      if(copy.input?.kind==='filter'&&idMap.has(copy.input.id)){
        copy.input.id=idMap.get(copy.input.id);
      }
      return copy;
    });

    if(Array.isArray(clone.nodes.magPhaseGdFilters)){
      for(const filter of clone.nodes.magPhaseGdFilters){
        if(filter.input?.kind==='filter'&&idMap.has(filter.input.id)){
          filter.input.id=idMap.get(filter.input.id);
        }
      }
    }

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
    if(filter.input?.id&&!sourceExists(filter)){
      filter.input=null;
      filter.sampleRateHz=null;
    }
    const node=canvas.querySelector('.xo-filter-node[data-filter-id="'+filter.id+'"]');
    if(node) applyLineage(node,filter);
  }
  requestAnimationFrame(renderConnections);
}).observe(measurementList,{childList:true,subtree:false});

new MutationObserver(()=>requestAnimationFrame(renderConnections))
  .observe(measurementNode,{attributes:true,attributeFilter:['style']});
new ResizeObserver(()=>requestAnimationFrame(renderConnections)).observe(measurementNode);
canvas.addEventListener('scroll',()=>requestAnimationFrame(renderConnections),{passive:true});
document.addEventListener('raptor:pipelineobstacleschange',()=>requestAnimationFrame(renderConnections));
document.addEventListener('raptor:pipelinezoomchange',()=>requestAnimationFrame(renderConnections));

window.RaptorCrossoverFilter=Object.freeze({
  model:MODEL,
  create:createFilter,
  list:()=>activeFilters().map(filter=>cloneFilter(filter,false)),
  get:filterId=>{
    const filter=filterById(filterId);
    return filter?cloneFilter(filter,false):null;
  },
  getOutput,
  getLineage(filterId){
    const filter=filterById(filterId);
    const lineage=filter?lineageInfo(filter):{active:false,color:LINEAGE_BASE_COLOR,measurementId:null};
    return Object.freeze({...lineage});
  },
  setBypass(filterId,bypass){
    const filter=filterById(filterId);
    if(!filter) return false;
    filter.bypass=!!bypass;
    renderNodes();
    document.dispatchEvent(new CustomEvent('raptor:filterbypasschange',{
      detail:{filterId:filter.id,filterType:filter.type,bypass:filter.bypass}
    }));
    notifyOutputChange(filter.id,filter.type,'bypass-change');
    return true;
  },
  delete:deleteFilter,
  refresh:renderNodes,
  refreshConnections:renderConnections
});
})();
