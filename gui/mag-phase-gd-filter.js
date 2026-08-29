(()=>{
'use strict';

const api=window.RaptorPipeline;
const canvas=document.getElementById('pipelineNodeCanvas');
const wireSvg=document.querySelector('.pipeline-wire-layer');
const measurementNode=document.getElementById('measurementNode');
const measurementList=document.getElementById('measurementList');
const rbj=window.RaptorEqGeometryRBJ||null;
if(!api||!canvas||!wireSvg||!measurementNode||!measurementList) return;

const SVG_NS='http://www.w3.org/2000/svg';
const F0=20;
const F1=20000;
const GRAPH_WIDTH=1000;
const GRAPH_HEIGHT=220;
const MAX_DISPLAY_POINTS=1800;
const UNCERTAINTY_NEEDLE_MAX_HEIGHT=GRAPH_HEIGHT*.30;
const UNCERTAINTY_MAG_RELIEF_DB=6;
const UNCERTAINTY_CONFIDENCE_FLOOR=.25;
const FREQ_TICKS=[
  20,40,80,
  100,200,300,400,500,600,700,800,900,
  1000,2000,3000,4000,5000,6000,7000,8000,9000,
  10000,15000
];
const FILTER_TYPE='mag-phase-gd';
const BAND_COLORS=Object.freeze([
  '#FF1744',
  '#00C853',
  '#2979FF',
  '#FF9100',
  '#D500F9',
  '#00B8D4',
  '#FFD600',
  '#F50057'
]);

let activeCard=null;
let filterSequence=1;
let windowZ=2460;
const windows=new Map();
let bandContextMenu=null;
let bandContextRequest=null;
let persistentWireGroup=null;
let graphSequence=1;

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
    input:null,
    bypass:false,
    sampleRateHz:null,
    bands:[],
    ui:{phase:true,magnitude:true,wrap:false,sync:true,bandPoints:true}
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
    input:filter.input?.id?{kind:'measurement',id:String(filter.input.id)}:null,
    bypass:filter.bypass===true,
    sampleRateHz:Number.isFinite(Number(filter.sampleRateHz))&&Number(filter.sampleRateHz)>0?Number(filter.sampleRateHz):null,
    bands:Array.isArray(filter.bands)?filter.bands.map(band=>({
      id:String(band.id||('band-'+Math.random().toString(36).slice(2,8))),
      type:'peaking',
      frequencyHz:Number(band.frequencyHz),
      gainDb:Number(band.gainDb),
      q:Number(band.q),
      graphKind:band.graphKind==='phase'?'phase':'magnitude'
    })):[],
    ui:{
      phase:filter.ui?.phase!==false,
      magnitude:filter.ui?.magnitude!==false,
      wrap:filter.ui?.wrap===true,
      sync:filter.ui?.sync!==false,
      bandPoints:filter.ui?.bandPoints!==false
    }
  };
}

function normalizeFilterInPlace(filter){
  if(!filter||typeof filter!=='object') return defaultFilterState();
  if(!filter.id) filter.id=makeFilterId();
  filter.type=FILTER_TYPE;
  filter.label='Mag-Phase-GD Filter';
  if(!filter.position||!Number.isFinite(Number(filter.position.x))||!Number.isFinite(Number(filter.position.y))){
    filter.position={x:360,y:120};
  }
  if(filter.windowPosition&&(!Number.isFinite(Number(filter.windowPosition.x))||!Number.isFinite(Number(filter.windowPosition.y)))){
    filter.windowPosition=null;
  }
  filter.input=filter.input?.id?{kind:'measurement',id:String(filter.input.id)}:null;
  filter.bypass=filter.bypass===true;
  filter.sampleRateHz=Number.isFinite(Number(filter.sampleRateHz))&&Number(filter.sampleRateHz)>0?Number(filter.sampleRateHz):null;
  if(!Array.isArray(filter.bands)) filter.bands=[];
  for(const band of filter.bands){
    band.graphKind=band.graphKind==='phase'?'phase':'magnitude';
  }
  if(!filter.ui) filter.ui={phase:true,magnitude:true,wrap:false,sync:true,bandPoints:true};
  if(filter.ui.phase===undefined) filter.ui.phase=true;
  if(filter.ui.magnitude===undefined) filter.ui.magnitude=true;
  if(filter.ui.wrap===undefined) filter.ui.wrap=false;
  if(filter.ui.sync===undefined) filter.ui.sync=true;
  if(filter.ui.bandPoints===undefined) filter.ui.bandPoints=true;
  return filter;
}

function ensureFilters(card){
  if(!card) return [];
  if(!card._raptorLineState) card._raptorLineState={version:1,nodes:{}};
  if(!card._raptorLineState.nodes) card._raptorLineState.nodes={};
  if(!Array.isArray(card._raptorLineState.nodes.magPhaseGdFilters)){
    card._raptorLineState.nodes.magPhaseGdFilters=[];
  }
  const filters=card._raptorLineState.nodes.magPhaseGdFilters;
  for(let i=0;i<filters.length;i++) filters[i]=normalizeFilterInPlace(filters[i]);
  return filters;
}

function activeFilters(){
  return activeCard?ensureFilters(activeCard):[];
}

function filterById(id){
  return activeFilters().find(filter=>filter.id===id)||null;
}

function closeBandContext(){
  if(!bandContextMenu) return;
  if(bandContextMenu.isConnected) bandContextMenu.hidden=true;
  bandContextRequest=null;
}

function closeAllWindows(){
  for(const win of windows.values()){
    removeBandEditor(win);
    win.remove();
  }
  windows.clear();
  closeBandContext();
}

function removeRenderedNodes(){
  canvas.querySelectorAll('.mpgd-filter-node').forEach(node=>{
    const filterId=node.dataset.filterId;
    if(filterId) api.unregisterInput?.('mpgd:'+filterId+':input');
    node.remove();
  });
}

function ensurePersistentWireGroup(){
  if(persistentWireGroup?.isConnected) return persistentWireGroup;
  persistentWireGroup=wireSvg.querySelector('.mpgd-persistent-wires');
  if(!persistentWireGroup){
    persistentWireGroup=document.createElementNS(SVG_NS,'g');
    persistentWireGroup.setAttribute('class','pipeline-persistent-wires mpgd-persistent-wires');
    const preview=document.getElementById('pipelineWirePreview');
    if(preview) wireSvg.insertBefore(persistentWireGroup,preview);
    else wireSvg.appendChild(persistentWireGroup);
  }
  return persistentWireGroup;
}

function sourceEntry(filter){
  return filter.input?.id?api.getMeasurement?.(filter.input.id)||null:null;
}

function sourceColor(filter){
  return sourceEntry(filter)?.color||'#8FA6B8';
}

function hexTint(hex,alpha=.10){
  const value=String(hex||'').replace('#','');
  const full=value.length===3?value.split('').map(c=>c+c).join(''):value;
  if(!/^[0-9a-f]{6}$/i.test(full)) return 'rgba(143,166,184,'+alpha+')';
  const n=parseInt(full,16);
  return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+alpha+')';
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
  const group=ensurePersistentWireGroup();
  group.replaceChildren();
  if(!activeCard) return;

  for(const filter of activeFilters()){
    const entry=sourceEntry(filter);
    const source=entry?measurementHandle(entry.id):null;
    const target=canvas.querySelector('.mpgd-filter-node[data-filter-id="'+filter.id+'"] .mpgd-filter-input');
    if(!entry||!source||!target) continue;

    const d=wireCurve(canvasPointFor(source),canvasPointFor(target));
    const hit=document.createElementNS(SVG_NS,'path');
    hit.setAttribute('class','pipeline-persistent-wire-hit');
    hit.setAttribute('d',d);
    hit.dataset.wireId='mpgd-input:'+filter.id;
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

function applyNodeLineage(node,filter){
  const entry=sourceEntry(filter);
  const color=entry?.color||'#8FA6B8';
  node.classList.toggle('has-lineage',!!entry);
  node.classList.toggle('is-bypassed',filter.bypass===true);
  node.classList.toggle('is-filtering',filter.bypass!==true);
  node.style.setProperty('--lineage-color',color);
  node.style.setProperty('--lineage-tint',hexTint(color,.12));
  node.style.setProperty('--lineage-tint-soft',hexTint(color,.055));

  const inputName=node.querySelector('[data-filter-input-name]');
  if(inputName) inputName.textContent=entry?.name||'Not connected';
  const input=node.querySelector('.mpgd-filter-input');
  if(input){
    input.classList.toggle('is-connected',!!entry);
    input.style.setProperty('--port-color',color);
  }
  node.querySelectorAll('.mpgd-filter-output').forEach(output=>output.style.setProperty('--port-color',color));
}

function connectInput(filter,entry){
  if(!filter||!entry||filter.input?.id) return false;
  filter.input={kind:'measurement',id:entry.id};
  filter.sampleRateHz=Number(entry.sampleRate??entry.canonical?.sample_rate_hz)||null;
  renderNodes();
  const win=windows.get(filter.id);
  if(win&&!win.hidden) renderWindow(filter,win);
  document.dispatchEvent(new CustomEvent('raptor:filterinputchange',{
    detail:{filterId:filter.id,sourceId:entry.id,connected:true,color:entry.color||null}
  }));
  return true;
}

function disconnectInput(filter){
  if(!filter?.input?.id) return false;
  const sourceId=filter.input.id;
  filter.input=null;
  filter.sampleRateHz=null;
  renderNodes();
  const win=windows.get(filter.id);
  if(win&&!win.hidden) renderWindow(filter,win);
  document.dispatchEvent(new CustomEvent('raptor:filterinputchange',{
    detail:{filterId:filter.id,sourceId,connected:false}
  }));
  return true;
}

function deleteFilter(filterId){
  if(!activeCard) return false;
  const filters=ensureFilters(activeCard);
  const index=filters.findIndex(filter=>filter.id===filterId);
  if(index<0) return false;
  const filter=filters[index];
  filters.splice(index,1);
  api.unregisterInput?.('mpgd:'+filterId+':input');
  const win=windows.get(filterId);
  if(win){
    removeBandEditor(win);
    win.remove();
  }
  windows.delete(filterId);
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filterdeleted',{
    detail:{filterId,filterType:FILTER_TYPE}
  }));
  return true;
}

function clampNodePosition(position,node=null){
  const width=node?.offsetWidth||222;
  const height=node?.offsetHeight||128;
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
  const canvasRect=canvas.getBoundingClientRect();
  const rect=node.getBoundingClientRect();
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

  const actions=document.createElement('div');
  actions.className='mpgd-filter-node-actions';

  const play=document.createElement('button');
  play.className='mpgd-filter-play';
  play.type='button';
  play.title='Open filter workspace';
  play.setAttribute('aria-label','Open '+filter.id);
  play.textContent='▶';
  play.addEventListener('click',event=>{
    event.stopPropagation();
    openFilterWindow(filter.id);
  });

  actions.append(play);
  head.append(title,actions);

  const body=document.createElement('div');
  body.className='mpgd-filter-node-body';

  const inputPane=document.createElement('div');
  inputPane.className='mpgd-filter-input-pane';
  const input=document.createElement('button');
  input.className='mpgd-filter-input';
  input.type='button';
  input.dataset.filterInput=filter.id;
  input.title='1 input';
  input.setAttribute('aria-label','Input for '+filter.id);
  const inputCopy=document.createElement('div');
  inputCopy.className='mpgd-filter-input-copy';
  inputCopy.innerHTML='<span>INPUT</span><strong data-filter-input-name>Not connected</strong>';
  inputPane.append(input,inputCopy);

  const outputs=document.createElement('div');
  outputs.className='mpgd-filter-outputs';

  for(const [kind,label] of [['phase','Phase'],['magnitude','Magnitude']]){
    const row=document.createElement('div');
    row.className='mpgd-filter-output-row';
    row.dataset.outputKind=kind;
    const copy=document.createElement('div');
    copy.className='mpgd-filter-output-copy';
    copy.innerHTML='<span>OUTPUT</span><strong>'+label+'</strong>';

    const handle=document.createElement('button');
    handle.className='mpgd-filter-output';
    handle.type='button';
    handle.dataset.filterId=filter.id;
    handle.dataset.outputKind=kind;
    handle.title=label+' output';
    handle.setAttribute('aria-label',label+' output from '+filter.id);
    handle.addEventListener('pointerdown',event=>{
      event.stopPropagation();
      document.dispatchEvent(new CustomEvent('raptor:filteroutputwirestart',{
        detail:{
          filterId:filter.id,
          outputKind:kind,
          bypass:filter.bypass===true,
          sourceMeasurementId:filter.input?.id||null,
          color:sourceColor(filter)
        }
      }));
    });

    row.append(copy,handle);
    outputs.appendChild(row);
  }

  body.append(inputPane,outputs);

  const foot=document.createElement('footer');
  foot.className='mpgd-filter-node-foot';

  const bypassLabel=document.createElement('label');
  bypassLabel.className='mpgd-filter-bypass';
  const bypass=document.createElement('input');
  bypass.type='checkbox';
  bypass.checked=filter.bypass===true;
  bypass.setAttribute('aria-label','Bypass '+filter.id);
  bypass.addEventListener('change',event=>{
    event.stopPropagation();
    filter.bypass=bypass.checked;
    applyNodeLineage(node,filter);
    const win=windows.get(filter.id);
    if(win&&!win.hidden) renderWindow(filter,win);
    document.dispatchEvent(new CustomEvent('raptor:filterbypasschange',{
      detail:{filterId:filter.id,bypass:filter.bypass}
    }));
  });
  const bypassText=document.createElement('span');
  bypassText.textContent='Bypass';
  bypassLabel.append(bypass,bypassText);

  const count=document.createElement('span');
  count.className='mpgd-filter-band-count';
  count.textContent=filter.bands.length+' band'+(filter.bands.length===1?'':'s');

  const remove=document.createElement('button');
  remove.className='mpgd-filter-delete mpgd-filter-delete--footer';
  remove.type='button';
  remove.title='Delete filter';
  remove.setAttribute('aria-label','Delete '+filter.id);
  remove.textContent='Delete';
  remove.addEventListener('click',event=>{
    event.stopPropagation();
    const ok=window.confirm('Delete Mag-Phase-GD Filter '+filter.id+'?\n\nThis filter and its local band state will be removed.');
    if(ok) deleteFilter(filter.id);
  });

  foot.append(bypassLabel,count,remove);

  node.append(head,body,foot);
  node.addEventListener('pointerdown',event=>startNodeDrag(event,node,filter));
  node.addEventListener('contextmenu',event=>event.stopPropagation());
  applyNodeLineage(node,filter);
  return node;
}

function renderNodes(){
  removeRenderedNodes();
  if(!activeCard){
    ensurePersistentWireGroup().replaceChildren();
    return;
  }

  activeFilters().forEach((filter,index)=>{
    if(filter.input?.id&&!api.getMeasurement?.(filter.input.id)){
      filter.input=null;
      filter.sampleRateHz=null;
    }
    const node=buildNode(filter,index);
    canvas.appendChild(node);
    const input=node.querySelector('.mpgd-filter-input');
    api.registerInput?.('mpgd:'+filter.id+':input',input,{
      radius:50,
      canAccept:entry=>!!entry&&!filter.input?.id,
      onConnect:entry=>connectInput(filter,entry)
    });
  });

  requestAnimationFrame(renderConnections);
}

function createFilterAt(x,y){
  if(!activeCard) return null;
  const filters=ensureFilters(activeCard);
  const filter=defaultFilterState(clampNodePosition({x:x-111,y:y-64}));
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
function frequencyAtRatio(ratio){
  return Math.exp(Math.log(F0)+Math.max(0,Math.min(1,ratio))*Math.log(F1/F0));
}
function yPhase(value){
  const v=Math.max(-180,Math.min(180,value));
  return GRAPH_HEIGHT-((v+180)/360)*GRAPH_HEIGHT;
}
function yMagnitude(value){
  const v=Math.max(-40,Math.min(40,value));
  return GRAPH_HEIGHT-((v+40)/80)*GRAPH_HEIGHT;
}
function formatFrequency(value,withUnit=true){
  if(!Number.isFinite(value)||value<=0) return '—';
  let text='';
  if(value>=1000){
    const k=value/1000;
    text=(k<10?k.toFixed(2):k.toFixed(1)).replace(/\.?0+$/,'')+'k';
  }else{
    text=(value<100?value.toFixed(1):value.toFixed(0)).replace(/\.0$/,'');
  }
  return withUnit?text+' Hz':text;
}
function formatGridFrequency(value){
  return value>=1000?(value/1000)+'k':String(value);
}

function baseViewsForFilter(filter){
  const entry=sourceEntry(filter);
  const canonical=entry?.canonical||null;
  const canonicalApi=window.RaptorMeasurementCanonicalV1;
  if(!canonical||!canonicalApi) return null;
  try{
    canonicalApi.validate(canonical);
    return canonicalApi.views(canonical);
  }catch{
    return null;
  }
}

function displayViewsForFilter(filter){
  const base=baseViewsForFilter(filter);
  if(!base) return null;
  if(filter.bypass||!filter.bands.length) return base;

  const fs=Number(filter.sampleRateHz??sourceEntry(filter)?.sampleRate??sourceEntry(filter)?.canonical?.sample_rate_hz);
  if(!rbj||!Number.isFinite(fs)||fs<=0) return base;

  const frequency=base.frequency_hz;
  const magnitude=base.magnitude_db;
  const phase=base.phase_deg;
  if(!(frequency&&magnitude&&phase)) return base;

  try{
    const operations=filter.bands.map(band=>rbj.normalizeOperation(band,fs));
    const outMagnitude=new Float64Array(frequency.length);
    const outPhase=new Float64Array(frequency.length);
    let phaseOnlyCount=0;
    let magnitudeCount=0;
    for(const band of filter.bands){
      if(band.graphKind==='phase') phaseOnlyCount+=1;
      else magnitudeCount+=1;
    }

    for(let i=0;i<frequency.length;i++){
      const f=Number(frequency[i]);
      if(!(Number.isFinite(f)&&f>0&&f<=fs/2)) return base;

      let totalReal=1;
      let totalImag=0;
      let deltaMagnitudeDb=0;

      for(let n=0;n<operations.length;n++){
        const h=rbj.responseAt(f,operations[n],fs);
        const hMagnitude=Math.hypot(h.real,h.imag);
        if(!(hMagnitude>0)) continue;

        // Both band families contribute their RBJ phase geometry.
        // Phase bands are normalized to unity magnitude.
        const ur=h.real/hMagnitude;
        const ui=h.imag/hMagnitude;
        const nr=totalReal*ur-totalImag*ui;
        const ni=totalReal*ui+totalImag*ur;
        totalReal=nr;
        totalImag=ni;

        // Only Magnitude bands are allowed to modify Magnitude.
        if(filter.bands[n].graphKind!=='phase'){
          deltaMagnitudeDb+=h.magnitudeDb;
        }
      }

      const sourcePhase=Number(phase[i])*Math.PI/180;
      const sr=Math.cos(sourcePhase);
      const si=Math.sin(sourcePhase);
      const rr=sr*totalReal-si*totalImag;
      const ri=sr*totalImag+si*totalReal;

      outMagnitude[i]=Number(magnitude[i])+deltaMagnitudeDb;
      outPhase[i]=Math.atan2(ri,rr)*180/Math.PI;
    }

    return Object.freeze({
      ...base,
      magnitude_db:outMagnitude,
      phase_deg:outPhase,
      filter_geometry:Object.freeze({
        model:'RAPTOR_MAG_PHASE_GD_SPLIT_GEOMETRY',
        phase_band_rule:'PHASE_ONLY_UNIT_MAGNITUDE',
        magnitude_band_rule:'RBJ_MAGNITUDE_PLUS_COUPLED_PHASE',
        phase_only_count:phaseOnlyCount,
        magnitude_count:magnitudeCount,
        sample_rate_hz:fs,
        canonical_mutated:false
      })
    });
  }catch{
    return base;
  }
}

function pointsInDisplayRange(frequency,phase=null,coherence=null){
  const indices=[];
  for(let i=0;i<frequency.length;i++){
    const f=frequency[i];
    if(Number.isFinite(f)&&f>=F0&&f<=F1) indices.push(i);
  }
  if(indices.length<=MAX_DISPLAY_POINTS) return indices;

  const selected=new Set();
  const stride=(indices.length-1)/(MAX_DISPLAY_POINTS-1);
  for(let n=0;n<MAX_DISPLAY_POINTS;n++){
    selected.add(indices[Math.min(indices.length-1,Math.round(n*stride))]);
  }

  if(phase){
    for(let n=1;n<indices.length;n++){
      const a=indices[n-1],b=indices[n];
      if(Number.isFinite(phase[a])&&Number.isFinite(phase[b])&&Math.abs(phase[b]-phase[a])>180){
        selected.add(a);selected.add(b);
      }
    }
  }

  if(coherence){
    const bucketCount=Math.min(MAX_DISPLAY_POINTS,indices.length);
    for(let bucket=0;bucket<bucketCount;bucket++){
      const a=Math.floor(bucket*indices.length/bucketCount);
      const b=Math.min(indices.length,Math.max(a+1,Math.floor((bucket+1)*indices.length/bucketCount)));
      let worstIndex=null,worstValue=Infinity;
      for(let n=a;n<b;n++){
        const i=indices[n],value=coherence[i];
        if(Number.isFinite(value)&&value<worstValue){
          worstValue=value;worstIndex=i;
        }
      }
      if(worstIndex!==null) selected.add(worstIndex);
    }
  }
  return [...selected].sort((a,b)=>a-b);
}

function phasePathFromViews(views,indices){
  const frequency=views.frequency_hz;
  const phase=views.phase_deg;
  let path='';
  let previousIndex=null;

  for(const i of indices){
    const f1=frequency[i],p1=phase[i];
    if(!Number.isFinite(f1)||!Number.isFinite(p1)) continue;
    const x1=xOf(f1),y1=yPhase(p1);
    if(previousIndex===null){
      path+='M'+x1.toFixed(2)+' '+y1.toFixed(2)+' ';
      previousIndex=i;
      continue;
    }

    const f0=frequency[previousIndex],p0=phase[previousIndex];
    const x0=xOf(f0);
    const delta=p1-p0;
    if(Number.isFinite(f0)&&Number.isFinite(p0)&&Math.abs(delta)>180){
      let adjustedP1=p1,boundary=180,opposite=-180;
      if(delta>180){adjustedP1=p1-360;boundary=-180;opposite=180;}
      else{adjustedP1=p1+360;boundary=180;opposite=-180;}
      const den=adjustedP1-p0;
      let t=den===0?0:(boundary-p0)/den;
      t=Math.max(0,Math.min(1,t));
      const xCross=x0+(x1-x0)*t;
      path+='L'+xCross.toFixed(2)+' '+yPhase(boundary).toFixed(2)+' ';
      path+='M'+xCross.toFixed(2)+' '+yPhase(opposite).toFixed(2)+' ';
      path+='L'+x1.toFixed(2)+' '+y1.toFixed(2)+' ';
    }else{
      path+='L'+x1.toFixed(2)+' '+y1.toFixed(2)+' ';
    }
    previousIndex=i;
  }
  return path.trim();
}

function magnitudePathFromViews(views,indices){
  const frequency=views.frequency_hz;
  const magnitude=views.magnitude_db;
  let path='';
  for(const i of indices){
    const f=frequency[i],value=magnitude[i];
    if(!Number.isFinite(f)||!Number.isFinite(value)) continue;
    const x=xOf(f),y=yMagnitude(value);
    path+=(path?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)+' ';
  }
  return path.trim();
}

function magnitudeFillPath(linePath,views,indices){
  if(!linePath||!indices.length) return '';
  const frequency=views.frequency_hz;
  const first=frequency[indices[0]];
  const last=frequency[indices[indices.length-1]];
  if(!(Number.isFinite(first)&&Number.isFinite(last))) return '';
  return linePath+
    ' L'+xOf(last).toFixed(2)+' '+GRAPH_HEIGHT+
    ' L'+xOf(first).toFixed(2)+' '+GRAPH_HEIGHT+' Z';
}

function wrapMarkerPath(views,indices){
  const frequency=views.frequency_hz;
  const phase=views.phase_deg;
  let path='';
  for(let n=1;n<indices.length;n++){
    const a=indices[n-1],b=indices[n];
    const p0=phase[a],p1=phase[b];
    if(!(Number.isFinite(p0)&&Number.isFinite(p1))||Math.abs(p1-p0)<=180) continue;

    const f0=frequency[a],f1=frequency[b];
    let adjustedP1=p1,boundary=180;
    if(p1-p0>180){adjustedP1=p1-360;boundary=-180;}
    else{adjustedP1=p1+360;boundary=180;}
    const den=adjustedP1-p0;
    let t=den===0?0:(boundary-p0)/den;
    t=Math.max(0,Math.min(1,t));
    const x=xOf(f0)+(xOf(f1)-xOf(f0))*t;
    path+='M'+x.toFixed(2)+' 0 L'+x.toFixed(2)+' '+GRAPH_HEIGHT+' ';
  }
  return path.trim();
}

function uncertaintyMagnitudeRelief(magnitudeDb){
  if(!Number.isFinite(magnitudeDb)) return 1;
  const t=Math.max(0,Math.min(1,Math.abs(magnitudeDb)/UNCERTAINTY_MAG_RELIEF_DB));
  const smooth=t*t*(3-2*t);
  return UNCERTAINTY_CONFIDENCE_FLOOR+(1-UNCERTAINTY_CONFIDENCE_FLOOR)*smooth;
}

function uncertaintyNeedlePath(views,indices){
  const frequency=views.frequency_hz;
  const coherence=views.coherence;
  const magnitude=views.magnitude_db;
  if(!coherence) return '';
  let path='';
  for(const i of indices){
    const f=frequency[i],c0=coherence[i],mag=magnitude[i];
    if(!Number.isFinite(f)||!Number.isFinite(c0)) continue;
    const loss=1-Math.max(0,Math.min(1,c0));
    if(loss<=0) continue;
    const relief=uncertaintyMagnitudeRelief(mag);
    const x=xOf(f);
    const yTop=GRAPH_HEIGHT-loss*relief*UNCERTAINTY_NEEDLE_MAX_HEIGHT;
    path+='M'+x.toFixed(2)+' '+GRAPH_HEIGHT+' L'+x.toFixed(2)+' '+yTop.toFixed(2)+' ';
  }
  return path.trim();
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

function formatDelayMs(value){
  if(!Number.isFinite(value)) return '—';
  const abs=Math.abs(value);
  if(abs>=100) return value.toFixed(1)+' ms';
  if(abs>=10) return value.toFixed(2)+' ms';
  if(abs>=1) return value.toFixed(3)+' ms';
  return value.toFixed(4)+' ms';
}

function fitPhaseBranch(frequency,phase,start,end){
  const n=end-start+1;
  if(n<4) return null;

  let sumF=0,sumP=0;
  let valid=0;
  for(let i=start;i<=end;i++){
    const f=Number(frequency[i]),p=Number(phase[i]);
    if(!(Number.isFinite(f)&&Number.isFinite(p))) continue;
    sumF+=f;sumP+=p;valid+=1;
  }
  if(valid<4) return null;

  const meanF=sumF/valid;
  const meanP=sumP/valid;
  let sxx=0,sxy=0,sst=0;
  for(let i=start;i<=end;i++){
    const f=Number(frequency[i]),p=Number(phase[i]);
    if(!(Number.isFinite(f)&&Number.isFinite(p))) continue;
    const df=f-meanF;
    const dp=p-meanP;
    sxx+=df*df;
    sxy+=df*dp;
    sst+=dp*dp;
  }
  if(!(sxx>0)) return null;

  const slope=sxy/sxx; // deg / Hz
  const intercept=meanP-slope*meanF;
  let sse=0;
  for(let i=start;i<=end;i++){
    const f=Number(frequency[i]),p=Number(phase[i]);
    if(!(Number.isFinite(f)&&Number.isFinite(p))) continue;
    const residual=p-(slope*f+intercept);
    sse+=residual*residual;
  }

  const rmse=Math.sqrt(sse/valid);
  const r2=sst>1e-12?Math.max(0,1-sse/sst):(rmse<1e-6?1:0);
  const fStart=Number(frequency[start]);
  const fEnd=Number(frequency[end]);
  const spanHz=fEnd-fStart;
  const deltaPhase=slope*spanHz;
  const screenSpan=Math.abs(xOf(fEnd)-xOf(fStart));

  // Fail closed when the branch does not carry enough phase movement,
  // screen/frequency span, or linearity to support a useful delay estimate.
  const residualLimit=Math.max(7,Math.abs(deltaPhase)*.09);
  const readable=
    valid>=4 &&
    spanHz>0 &&
    screenSpan>=16 &&
    Math.abs(deltaPhase)>=12 &&
    r2>=.97 &&
    rmse<=residualLimit;

  return Object.freeze({
    start,
    end,
    points:valid,
    fStart,
    fEnd,
    slopeDegPerHz:slope,
    interceptDeg:intercept,
    deltaPhaseDeg:deltaPhase,
    delayMs:-slope/360*1000,
    rmseDeg:rmse,
    r2,
    readable
  });
}

function buildPhaseBranches(views){
  const frequency=views?.frequency_hz;
  const phase=views?.phase_deg;
  if(!frequency||!phase||frequency.length<2) return [];

  const branches=[];
  let start=null;
  let previous=null;

  const flush=end=>{
    if(start===null||end<start) return;
    const fit=fitPhaseBranch(frequency,phase,start,end);
    if(fit) branches.push(fit);
  };

  for(let i=0;i<frequency.length;i++){
    const f=Number(frequency[i]);
    const p=Number(phase[i]);
    const valid=Number.isFinite(f)&&Number.isFinite(p)&&f>=F0&&f<=F1;
    if(!valid){
      if(start!==null) flush(i-1);
      start=null;
      previous=null;
      continue;
    }

    if(start===null){
      start=i;
      previous=i;
      continue;
    }

    const previousPhase=Number(phase[previous]);
    if(!Number.isFinite(previousPhase)||Math.abs(p-previousPhase)>180){
      flush(previous);
      start=i;
    }
    previous=i;
  }

  if(start!==null&&previous!==null) flush(previous);
  return branches;
}

function phaseBranchPath(views,branch,useFit=false){
  const frequency=views?.frequency_hz;
  const phase=views?.phase_deg;
  if(!frequency||!phase||!branch) return '';
  let path='';
  for(let i=branch.start;i<=branch.end;i++){
    const f=Number(frequency[i]);
    const actual=Number(phase[i]);
    if(!(Number.isFinite(f)&&Number.isFinite(actual))) continue;
    const value=useFit
      ?branch.slopeDegPerHz*f+branch.interceptDeg
      :actual;
    const x=xOf(f),y=yPhase(value);
    path+=(path?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)+' ';
  }
  return path.trim();
}

function clearPhaseBranchInspect(win){
  const delayEl=win.querySelector('[data-phase-inspect-delay]');
  const phaseEl=win.querySelector('[data-phase-inspect-angle]');
  const highlight=win.querySelector('.mpgd-filter-svg--phase .phase-branch-highlight');
  const fitPath=win.querySelector('.mpgd-filter-svg--phase .phase-branch-fit');
  if(delayEl){
    delayEl.textContent='—';
    delayEl.classList.remove('is-unreadable');
  }
  if(phaseEl){
    phaseEl.textContent='—';
    phaseEl.classList.remove('is-unreadable');
  }
  if(highlight) highlight.setAttribute('d','');
  if(fitPath) fitPath.setAttribute('d','');
  win._phaseBranchInspect=null;
}

function showPhaseBranchInspect(win,views,branch){
  const delayEl=win.querySelector('[data-phase-inspect-delay]');
  const phaseEl=win.querySelector('[data-phase-inspect-angle]');
  const highlight=win.querySelector('.mpgd-filter-svg--phase .phase-branch-highlight');
  const fitPath=win.querySelector('.mpgd-filter-svg--phase .phase-branch-fit');

  win._phaseBranchInspect=branch;
  if(highlight) highlight.setAttribute('d',phaseBranchPath(views,branch,false));

  if(!branch.readable){
    if(delayEl){
      delayEl.textContent='Delay unreadable';
      delayEl.classList.add('is-unreadable');
    }
    if(phaseEl){
      phaseEl.textContent='ΔPhase —';
      phaseEl.classList.add('is-unreadable');
    }
    if(fitPath) fitPath.setAttribute('d','');
    return;
  }

  if(delayEl){
    delayEl.textContent='Delay '+formatDelayMs(branch.delayMs);
    delayEl.classList.remove('is-unreadable');
    delayEl.title='Linear branch fit · R² '+branch.r2.toFixed(4)+' · RMSE '+branch.rmseDeg.toFixed(2)+'°';
  }
  if(phaseEl){
    phaseEl.textContent='ΔPhase '+branch.deltaPhaseDeg.toFixed(1)+'°';
    phaseEl.classList.remove('is-unreadable');
    phaseEl.title=formatFrequency(branch.fStart)+' – '+formatFrequency(branch.fEnd);
  }
  if(fitPath) fitPath.setAttribute('d',phaseBranchPath(views,branch,true));
}

function inspectPhaseBranchAtPointer(win,plot,event,views){
  const branches=win._phaseBranches||[];
  if(!branches.length||!views?.frequency_hz||!views?.phase_deg){
    clearPhaseBranchInspect(win);
    return;
  }

  const rect=plot.getBoundingClientRect();
  const plotWidth=Math.max(1,rect.width-8);
  const plotHeight=Math.max(1,rect.height-8);
  const localX=Math.max(0,Math.min(plotWidth,event.clientX-rect.left-4));
  const ratio=localX/plotWidth;
  const targetFrequency=frequencyAtRatio(ratio);
  const pointerY=event.clientY-rect.top;

  let best=null;
  for(const branch of branches){
    if(targetFrequency<branch.fStart||targetFrequency>branch.fEnd) continue;
    let index=nearestIndex(views.frequency_hz,targetFrequency);
    index=Math.max(branch.start,Math.min(branch.end,index));
    const p=Number(views.phase_deg[index]);
    if(!Number.isFinite(p)) continue;
    const y=4+(yPhase(p)/GRAPH_HEIGHT)*plotHeight;
    const distance=Math.abs(pointerY-y);
    if(!best||distance<best.distance) best={branch,distance};
  }

  const hitRadius=Math.max(13,Math.min(20,rect.height*.065));
  if(!best||best.distance>hitRadius){
    clearPhaseBranchInspect(win);
    return;
  }
  showPhaseBranchInspect(win,views,best.branch);
}


function buildAxisLabels(container){
  container.replaceChildren();
  for(const f of FREQ_TICKS){
    const span=document.createElement('span');
    span.textContent=formatGridFrequency(f);
    const pct=xOf(f)/GRAPH_WIDTH*100;
    span.style.left=pct+'%';
    if(pct<1.5) span.style.transform='translateX(2px)';
    else if(pct>98.5) span.style.transform='translateX(calc(-100% - 2px))';
    container.appendChild(span);
  }
}

function buildFrequencyGrid(grid){
  grid.replaceChildren();
  for(const f of FREQ_TICKS){
    const line=document.createElement('span');
    line.className='mpgd-filter-grid-line';
    line.style.left=(xOf(f)/GRAPH_WIDTH*100)+'%';
    grid.appendChild(line);
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
  readout.textContent='—';

  const pointer=document.createElement('div');
  pointer.className='mpgd-filter-pointer-readout';
  pointer.dataset.kind=kind;
  pointer.textContent='—';

  const unit=document.createElement('span');
  unit.className='mpgd-filter-unit';
  unit.textContent=kind==='phase'?'deg':'dB';

  if(kind==='phase'){
    const delay=document.createElement('span');
    delay.className='mpgd-filter-value-pill mpgd-filter-value-pill--delay';
    delay.dataset.phaseInspectDelay='';
    delay.textContent='—';
    delay.title='Delay from a readable linear Phase-vs-Frequency branch fit';

    const angle=document.createElement('span');
    angle.className='mpgd-filter-value-pill mpgd-filter-value-pill--phase';
    angle.dataset.phaseInspectAngle='';
    angle.textContent='—';
    angle.title='Total fitted phase rotation across the selected readable branch';

    head.append(title,readout,pointer,delay,angle,unit);
  }else{
    head.append(title,readout,pointer,unit);
  }

  const plot=document.createElement('div');
  plot.className='mpgd-filter-plot';
  plot.dataset.kind=kind;

  const grid=document.createElement('div');
  grid.className='mpgd-filter-grid';
  buildFrequencyGrid(grid);

  const zeroLine=document.createElement('span');
  zeroLine.className='mpgd-filter-zero-line';
  zeroLine.dataset.zeroKind=kind;
  zeroLine.title=kind==='phase'?'0° reference':'0 dB reference';
  grid.appendChild(zeroLine);

  const svg=document.createElementNS(SVG_NS,'svg');
  svg.setAttribute('class','mpgd-filter-svg mpgd-filter-svg--'+(kind==='phase'?'phase':'mag'));
  svg.setAttribute('viewBox','0 0 '+GRAPH_WIDTH+' '+GRAPH_HEIGHT);
  svg.setAttribute('preserveAspectRatio','none');

  if(kind==='magnitude'){
    const gradientId='mpgd-mag-fill-'+(graphSequence++);
    const defs=document.createElementNS(SVG_NS,'defs');
    const gradient=document.createElementNS(SVG_NS,'linearGradient');
    gradient.setAttribute('id',gradientId);
    gradient.setAttribute('x1','0');
    gradient.setAttribute('x2','0');
    gradient.setAttribute('y1','0');
    gradient.setAttribute('y2','1');
    gradient.setAttribute('gradientUnits','objectBoundingBox');

    const stops=[
      ['0%','.34'],
      ['28%','.23'],
      ['62%','.10'],
      ['100%','0']
    ];
    for(const [offset,opacity] of stops){
      const stop=document.createElementNS(SVG_NS,'stop');
      stop.setAttribute('offset',offset);
      stop.setAttribute('stop-color','#8FA6B8');
      stop.setAttribute('stop-opacity',opacity);
      stop.setAttribute('class','mpgd-mag-lineage-stop');
      gradient.appendChild(stop);
    }
    defs.appendChild(gradient);
    svg.appendChild(defs);

    const fill=document.createElementNS(SVG_NS,'path');
    fill.setAttribute('class','mag-fill');
    fill.setAttribute('fill','url(#'+gradientId+')');
    svg.appendChild(fill);

    const uncertainty=document.createElementNS(SVG_NS,'path');
    uncertainty.setAttribute('class','uncertainty-needles');
    svg.appendChild(uncertainty);
  }

  if(kind==='phase'){
    const markers=document.createElementNS(SVG_NS,'path');
    markers.setAttribute('class','wrap-markers');
    svg.appendChild(markers);

    const highlight=document.createElementNS(SVG_NS,'path');
    highlight.setAttribute('class','phase-branch-highlight');
    svg.appendChild(highlight);

    const fitPath=document.createElementNS(SVG_NS,'path');
    fitPath.setAttribute('class','phase-branch-fit');
    svg.appendChild(fitPath);
  }

  const trace=document.createElementNS(SVG_NS,'path');
  trace.setAttribute('class','trace');
  svg.appendChild(trace);

  const y=document.createElement('div');
  y.className='mpgd-filter-ylabels';
  y.innerHTML=kind==='phase'
    ?'<span>180°</span><span>90°</span><span>0°</span><span>-90°</span><span>-180°</span>'
    :'<span>40</span><span>20</span><span>0</span><span>-20</span><span>-40</span>';

  const x=document.createElement('div');
  x.className='mpgd-filter-xlabels';
  buildAxisLabels(x);

  const bandMarkers=document.createElement('div');
  bandMarkers.className='mpgd-band-markers';
  bandMarkers.dataset.kind=kind;

  plot.append(grid,svg,y,x,bandMarkers);
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
  const visibleEdge=72;
  const headerVisible=38;
  const minX=Math.min(4,visibleEdge-width);
  const maxX=Math.max(4,window.innerWidth-visibleEdge);
  const minY=4;
  const maxY=Math.max(4,window.innerHeight-headerVisible);
  return {
    x:Math.max(minX,Math.min(maxX,x)),
    y:Math.max(minY,Math.min(maxY,y))
  };
}

function startWindowDrag(event,win,filter){
  if(event.button!==undefined&&event.button!==0) return;
  if(event.target.closest('button,input,label,select,textarea,a')) return;
  event.preventDefault();
  bringToFront(win);
  const pointerId=event.pointerId;
  const handle=event.currentTarget;
  const rect=win.getBoundingClientRect();
  const dx=event.clientX-rect.left;
  const dy=event.clientY-rect.top;
  try{handle.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    if(moveEvent.cancelable) moveEvent.preventDefault();
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
    try{if(handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)}catch{}
  };

  window.addEventListener('pointermove',move,{passive:false});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
}

function ensureBandContext(){
  if(bandContextMenu?.isConnected) return bandContextMenu;
  bandContextMenu=null;
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
    const filter=filterById(request.filterId);
    if(!filter||!sourceEntry(filter)) return;

    const fs=Number(filter.sampleRateHz??sourceEntry(filter)?.sampleRate??sourceEntry(filter)?.canonical?.sample_rate_hz);
    const maxFrequency=Number.isFinite(fs)&&fs>0?Math.min(F1,fs/2*.98):F1;
    const frequencyHz=Math.max(F0,Math.min(maxFrequency,request.frequencyHz));
    const band={
      id:'band-'+Date.now().toString(36)+'-'+(filter.bands.length+1),
      type:'peaking',
      frequencyHz,
      gainDb:0,
      q:1.41421356,
      graphKind:request.graphKind==='phase'?'phase':'magnitude'
    };
    filter.bands.push(band);

    const win=windows.get(filter.id);
    if(win&&!win.hidden){
      win._activeBandId=band.id;
      renderWindow(filter,win);
    }
    renderNodes();
    document.dispatchEvent(new CustomEvent('raptor:filteraddband',{
      detail:{filterId:filter.id,bandId:band.id,frequencyHz}
    }));
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
  menu.style.zIndex=String(Math.max(2600,windowZ+120));
  const add=menu.querySelector('button');
  if(add){
    add.disabled=!sourceEntry(filter);
    add.title=sourceEntry(filter)?'Add a new editable EQ band here':'Connect a Measurement input first';
  }
  menu.hidden=false;
  menu.style.left='0px';
  menu.style.top='0px';
  const mr=menu.getBoundingClientRect();
  menu.style.left=Math.max(5,Math.min(window.innerWidth-mr.width-5,event.clientX))+'px';
  menu.style.top=Math.max(5,Math.min(window.innerHeight-mr.height-5,event.clientY))+'px';
}

function ensureCursor(svg){
  let v=svg.querySelector('.cursor-v');
  let h=svg.querySelector('.cursor-h');
  let p=svg.querySelector('.cursor-point');
  if(!v){
    v=document.createElementNS(SVG_NS,'line');
    v.setAttribute('class','cursor cursor-v');
    v.setAttribute('y1','0');v.setAttribute('y2',String(GRAPH_HEIGHT));
    h=document.createElementNS(SVG_NS,'line');
    h.setAttribute('class','cursor cursor-h');
    h.setAttribute('x1','0');h.setAttribute('x2',String(GRAPH_WIDTH));
    p=document.createElementNS(SVG_NS,'circle');
    p.setAttribute('class','cursor-point');
    p.setAttribute('r','3');
    svg.append(v,h,p);
  }
  return {v,h,p};
}

function setCursor(cursor,x,y,visible){
  cursor.v.hidden=cursor.h.hidden=cursor.p.hidden=!visible;
  if(!visible) return;
  cursor.v.setAttribute('x1',x);cursor.v.setAttribute('x2',x);
  cursor.h.setAttribute('y1',y);cursor.h.setAttribute('y2',y);
  cursor.p.setAttribute('cx',x);cursor.p.setAttribute('cy',y);
}

function bindPlot(win,filter,plot){
  const kind=plot.dataset.kind;
  plot.addEventListener('pointermove',event=>{
    const views=win._mpgdDisplayViews||displayViewsForFilter(filter);
    if(!views?.frequency_hz) return;
    const rect=plot.getBoundingClientRect();
    const ratio=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)));
    const target=frequencyAtRatio(ratio);
    const i=nearestIndex(views.frequency_hz,target);
    const f=views.frequency_hz[i];
    const phase=views.phase_deg[i];
    const mag=views.magnitude_db[i];

    const lineReadout=win.querySelector('.mpgd-filter-readout[data-kind="'+kind+'"]');
    if(lineReadout){
      lineReadout.textContent=kind==='phase'
        ?formatFrequency(f)+' · '+phase.toFixed(1)+'°'
        :formatFrequency(f)+' · '+mag.toFixed(2)+' dB';
    }

    const yRatio=Math.max(0,Math.min(1,(event.clientY-rect.top)/Math.max(1,rect.height)));
    const rawValue=kind==='phase'?180-yRatio*360:40-yRatio*80;
    const pointer=win.querySelector('.mpgd-filter-pointer-readout[data-kind="'+kind+'"]');
    if(pointer){
      pointer.textContent=kind==='phase'
        ?formatFrequency(target)+' · '+rawValue.toFixed(1)+'°'
        :formatFrequency(target)+' · '+rawValue.toFixed(2)+' dB';
    }

    if(kind==='phase') inspectPhaseBranchAtPointer(win,plot,event,views);

    const x=xOf(f);
    const ui=filter.ui||{};
    for(const targetKind of ['phase','magnitude']){
      const targetPlot=win.querySelector('.mpgd-filter-plot[data-kind="'+targetKind+'"]');
      const svg=targetPlot?.querySelector('svg');
      if(!svg) continue;
      const cursor=ensureCursor(svg);
      const y=targetKind==='phase'?yPhase(phase):yMagnitude(mag);
      setCursor(cursor,x,y,ui.sync!==false||targetKind===kind);
    }
  });

  plot.addEventListener('pointerleave',()=>{
    const entry=sourceEntry(filter);
    const readout=win.querySelector('.mpgd-filter-readout[data-kind="'+kind+'"]');
    if(readout) readout.textContent=entry?.name||'No input';
    const pointer=win.querySelector('.mpgd-filter-pointer-readout[data-kind="'+kind+'"]');
    if(pointer) pointer.textContent='—';
    win.querySelectorAll('.cursor,.cursor-point').forEach(node=>node.hidden=true);
    if(kind==='phase') clearPhaseBranchInspect(win);
  });



  plot.addEventListener('contextmenu',event=>openBandContext(event,filter,kind));
}

function activeBand(filter,win){
  if(!filter.bands.length) return null;
  return filter.bands.find(b=>b.id===win._activeBandId)||filter.bands[filter.bands.length-1]||null;
}

function removeBandEditor(win){
  const panel=win?._bandEditor||null;
  if(panel?.isConnected) panel.remove();
  if(win) win._bandEditor=null;
}

function clampBandEditorPosition(x,y,panel){
  const width=panel.offsetWidth||300;
  const height=panel.offsetHeight||210;
  return {
    x:Math.max(5,Math.min(window.innerWidth-width-5,x)),
    y:Math.max(5,Math.min(window.innerHeight-height-5,y))
  };
}

function startBandEditorDrag(event,panel,win){
  if(event.button!==undefined&&event.button!==0) return;
  if(event.target.closest('button,input,label,select,textarea,a')) return;
  event.preventDefault();
  const pointerId=event.pointerId;
  const handle=event.currentTarget;
  const rect=panel.getBoundingClientRect();
  const dx=event.clientX-rect.left;
  const dy=event.clientY-rect.top;
  panel.style.zIndex=String(windowZ+30);
  try{handle.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    if(moveEvent.cancelable) moveEvent.preventDefault();
    const pos=clampBandEditorPosition(moveEvent.clientX-dx,moveEvent.clientY-dy,panel);
    panel.style.left=pos.x+'px';
    panel.style.top=pos.y+'px';
    win._bandEditorPosition=pos;
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

function openBandEditor(win,filter,bandId){
  const band=filter.bands.find(item=>item.id===bandId);
  if(!band) return;
  win._activeBandId=band.id;
  removeBandEditor(win);

  const bandIndex=filter.bands.findIndex(item=>item.id===band.id);
  const color=BAND_COLORS[Math.max(0,bandIndex)%BAND_COLORS.length];

  const panel=document.createElement('section');
  panel.className='mpgd-band-editor';
  panel.dataset.filterId=filter.id;
  panel.dataset.bandId=band.id;
  panel.style.setProperty('--band-color',color);
  panel.style.zIndex=String(windowZ+30);
  panel.innerHTML=
    '<header class="mpgd-band-editor-head">'+
      '<span class="mpgd-band-editor-dot"></span>'+
      '<strong>'+(band.graphKind==='phase'?'Phase':'Magnitude')+' Band '+(bandIndex+1)+'</strong>'+
      '<span data-band-id></span>'+
      '<button type="button" data-band-close aria-label="Close">×</button>'+
    '</header>'+
    '<div class="mpgd-band-editor-fields">'+
      '<label><span>Frequency</span><input type="number" step="1" min="20" max="20000" data-band-frequency><b>Hz</b></label>'+
      '<label><span>Gain</span><input type="number" step="0.1" min="-24" max="24" data-band-gain><b>dB</b></label>'+
      '<label><span>Q</span><input type="number" step="0.01" min="0.05" max="50" data-band-q><b>Q</b></label>'+
      '<button type="button" class="mpgd-band-delete" data-band-delete>Delete Band</button>'+
    '</div>';

  panel.querySelector('[data-band-id]').textContent=band.id;
  const fInput=panel.querySelector('[data-band-frequency]');
  const gInput=panel.querySelector('[data-band-gain]');
  const qInput=panel.querySelector('[data-band-q]');
  fInput.value=String(Math.round(band.frequencyHz*100)/100);
  gInput.value=String(Math.round(band.gainDb*100)/100);
  qInput.value=String(Math.round(band.q*10000)/10000);

  const apply=()=>{
    const fs=Number(filter.sampleRateHz??sourceEntry(filter)?.sampleRate??sourceEntry(filter)?.canonical?.sample_rate_hz);
    const maxF=Number.isFinite(fs)&&fs>0?Math.min(F1,fs/2*.98):F1;
    const frequencyHz=Math.max(F0,Math.min(maxF,Number(fInput.value)));
    const gainDb=Math.max(-24,Math.min(24,Number(gInput.value)));
    const q=Math.max(.05,Math.min(50,Number(qInput.value)));
    if(!(Number.isFinite(frequencyHz)&&Number.isFinite(gainDb)&&Number.isFinite(q))) return;
    band.frequencyHz=frequencyHz;
    band.gainDb=gainDb;
    band.q=q;
    renderWindow(filter,win);
    renderNodes();
  };

  for(const input of [fInput,gInput,qInput]){
    input.addEventListener('input',apply);
    input.addEventListener('change',apply);
  }

  const head=panel.querySelector('.mpgd-band-editor-head');
  head.addEventListener('pointerdown',event=>startBandEditorDrag(event,panel,win));
  panel.querySelector('[data-band-close]').addEventListener('click',()=>removeBandEditor(win));
  panel.querySelector('[data-band-delete]').addEventListener('click',()=>{
    const index=filter.bands.findIndex(item=>item.id===band.id);
    if(index>=0) filter.bands.splice(index,1);
    win._activeBandId=null;
    removeBandEditor(win);
    renderWindow(filter,win);
    renderNodes();
  });

  document.body.appendChild(panel);
  win._bandEditor=panel;

  requestAnimationFrame(()=>{
    const parentRect=win.getBoundingClientRect();
    const initial=win._bandEditorPosition||{
      x:Math.min(window.innerWidth-310,Math.max(8,parentRect.right-320)),
      y:Math.min(window.innerHeight-220,Math.max(8,parentRect.top+68))
    };
    const pos=clampBandEditorPosition(initial.x,initial.y,panel);
    panel.style.left=pos.x+'px';
    panel.style.top=pos.y+'px';
    win._bandEditorPosition=pos;
  });
}


function clampBandGain(value){
  return Math.max(-24,Math.min(24,Number(value)));
}

function clampBandQ(value){
  return Math.max(.05,Math.min(50,Number(value)));
}

function beginBandGainDrag(event,filter,win,band){
  if(event.button!==undefined&&event.button!==0) return;
  event.preventDefault();
  event.stopPropagation();

  const startY=event.clientY;
  const startGain=Number(band.gainDb)||0;
  const pointerId=event.pointerId;
  const marker=event.currentTarget;
  marker.classList.add('is-gain-dragging');

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    if(moveEvent.cancelable) moveEvent.preventDefault();

    // Vertical movement controls Gain only. Frequency is intentionally locked.
    const deltaY=moveEvent.clientY-startY;
    band.gainDb=clampBandGain(startGain-deltaY*.12);
    renderWindow(filter,win);
    renderNodes();
  };

  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    win.querySelector('.mpgd-band-marker[data-band-id="'+band.id+'"]')?.classList.remove('is-gain-dragging');
  };

  window.addEventListener('pointermove',move,{passive:false});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
}

function adjustBandQFromWheel(event,filter,win,band){
  event.preventDefault();
  event.stopPropagation();

  const raw=Number(event.deltaY)||0;
  if(raw===0) return;
  const normalized=Math.max(-3,Math.min(3,-raw/100));
  const factor=Math.exp(normalized*.10);
  band.q=clampBandQ((Number(band.q)||1.41421356)*factor);
  renderWindow(filter,win);
  renderNodes();
}

function renderBandMarkers(filter,win,views){
  for(const layer of win.querySelectorAll('.mpgd-band-markers')){
    layer.replaceChildren();
  }
  if(filter.ui?.bandPoints===false||!views?.frequency_hz||!filter.bands.length) return;

  filter.bands.forEach((band,index)=>{
    const kind=band.graphKind==='phase'?'phase':'magnitude';
    const layer=win.querySelector('.mpgd-band-markers[data-kind="'+kind+'"]');
    if(!layer) return;

    const i=nearestIndex(views.frequency_hz,band.frequencyHz);
    const f=views.frequency_hz[i];
    const value=kind==='phase'?views.phase_deg[i]:views.magnitude_db[i];
    if(!(Number.isFinite(f)&&Number.isFinite(value))) return;

    const marker=document.createElement('button');
    marker.type='button';
    marker.className='mpgd-band-marker';
    marker.dataset.bandId=band.id;
    marker.title='Band '+(index+1)+' · '+formatFrequency(band.frequencyHz)+' · Drag ↑↓ Gain · Wheel Q · Double-click Edit';
    marker.setAttribute('aria-label','Edit Band '+(index+1));
    marker.style.left=(xOf(f)/GRAPH_WIDTH*100)+'%';
    marker.style.top=((kind==='phase'?yPhase(value):yMagnitude(value))/GRAPH_HEIGHT*100)+'%';
    marker.style.setProperty('--band-color',BAND_COLORS[index%BAND_COLORS.length]);
    marker.dataset.bandNumber=String(index+1);
    marker.textContent='';
    marker.addEventListener('pointerdown',event=>{
      beginBandGainDrag(event,filter,win,band);
    });
    marker.addEventListener('wheel',event=>{
      adjustBandQFromWheel(event,filter,win,band);
    },{passive:false});
    marker.addEventListener('dblclick',event=>{
      event.preventDefault();
      event.stopPropagation();
      win._activeBandId=band.id;
      openBandEditor(win,filter,band.id);
    });
    layer.appendChild(marker);
  });
}

function buildBandRackSection(kind){
  const section=document.createElement('section');
  section.className='mpgd-band-rack-section mpgd-band-rack-section--'+kind;
  section.dataset.rackKind=kind;

  const head=document.createElement('header');
  head.className='mpgd-band-rack-head';
  const title=document.createElement('strong');
  title.textContent=kind==='phase'?'PHASE BANDS':'MAG BANDS';
  const count=document.createElement('span');
  count.dataset.rackCount=kind;
  count.textContent='0';
  head.append(title,count);

  const list=document.createElement('div');
  list.className='mpgd-band-rack-list';
  list.dataset.rackList=kind;

  section.append(head,list);
  return section;
}

function renderBandRack(filter,win){
  for(const kind of ['phase','magnitude']){
    const list=win.querySelector('[data-rack-list="'+kind+'"]');
    const count=win.querySelector('[data-rack-count="'+kind+'"]');
    if(!list) continue;
    list.replaceChildren();

    const entries=filter.bands
      .map((band,index)=>({band,index}))
      .filter(item=>(item.band.graphKind==='phase'?'phase':'magnitude')===kind);

    if(count) count.textContent=String(entries.length);

    if(!entries.length){
      const empty=document.createElement('div');
      empty.className='mpgd-band-rack-empty';
      empty.textContent='No '+(kind==='phase'?'phase':'magnitude')+' bands';
      list.appendChild(empty);
      continue;
    }

    for(const {band,index} of entries){
      const color=BAND_COLORS[index%BAND_COLORS.length];
      const row=document.createElement('div');
      row.className='mpgd-band-rack-row';
      row.style.setProperty('--band-color',color);

      const dot=document.createElement('span');
      dot.className='mpgd-band-rack-dot';

      const info=document.createElement('div');
      info.className='mpgd-band-rack-info';
      const name=document.createElement('strong');
      name.textContent='Band '+(index+1);
      const meta=document.createElement('span');
      meta.textContent=formatFrequency(band.frequencyHz)+' · G '+Number(band.gainDb).toFixed(1)+' · Q '+Number(band.q).toFixed(2);
      info.append(name,meta);

      const actions=document.createElement('div');
      actions.className='mpgd-band-rack-actions';

      const edit=document.createElement('button');
      edit.className='mpgd-band-rack-edit';
      edit.type='button';
      edit.textContent='Edit';
      edit.addEventListener('click',()=>{
        win._activeBandId=band.id;
        openBandEditor(win,filter,band.id);
      });

      const remove=document.createElement('button');
      remove.className='mpgd-band-rack-delete';
      remove.type='button';
      remove.textContent='Delete';
      remove.addEventListener('click',()=>{
        const removeIndex=filter.bands.findIndex(item=>item.id===band.id);
        if(removeIndex<0) return;
        filter.bands.splice(removeIndex,1);
        if(win._activeBandId===band.id){
          win._activeBandId=null;
          removeBandEditor(win);
        }
        renderWindow(filter,win);
        renderNodes();
      });

      actions.append(edit,remove);
      row.append(dot,info,actions);
      list.appendChild(row);
    }
  }
}

function applyMagnitudeLineageFill(win,filter){
  const color=sourceColor(filter);
  win.style.setProperty('--source-lineage-color',color);
  win.querySelectorAll('.mpgd-mag-lineage-stop').forEach(stop=>{
    stop.setAttribute('stop-color',color);
  });
}

function renderWindow(filter,win){
  const entry=sourceEntry(filter);
  const views=displayViewsForFilter(filter);
  win._mpgdDisplayViews=views;

  const phaseTrace=win.querySelector('.mpgd-filter-svg--phase .trace');
  const phaseMarkers=win.querySelector('.mpgd-filter-svg--phase .wrap-markers');
  const magTrace=win.querySelector('.mpgd-filter-svg--mag .trace');
  const magFill=win.querySelector('.mpgd-filter-svg--mag .mag-fill');
  const uncertainty=win.querySelector('.mpgd-filter-svg--mag .uncertainty-needles');

  applyMagnitudeLineageFill(win,filter);

  win._phaseBranches=views?.frequency_hz?buildPhaseBranches(views):[];
  clearPhaseBranchInspect(win);

  if(!views?.frequency_hz){
    phaseTrace?.setAttribute('d','');
    phaseMarkers?.setAttribute('d','');
    magTrace?.setAttribute('d','');
    magFill?.setAttribute('d','');
    uncertainty?.setAttribute('d','');
    win.querySelectorAll('.mpgd-filter-readout').forEach(el=>el.textContent='No input');
    win.querySelectorAll('.mpgd-filter-pointer-readout').forEach(el=>el.textContent='—');
  }else{
    const indices=pointsInDisplayRange(views.frequency_hz,views.phase_deg,views.coherence);
    const magPath=magnitudePathFromViews(views,indices);
    phaseTrace?.setAttribute('d',phasePathFromViews(views,indices));
    phaseMarkers?.setAttribute('d',filter.ui.wrap?wrapMarkerPath(views,indices):'');
    magTrace?.setAttribute('d',magPath);
    magFill?.setAttribute('d',magnitudeFillPath(magPath,views,indices));
    uncertainty?.setAttribute('d',uncertaintyNeedlePath(views,indices));

    const sourceName=entry?.name||'Measurement';
    win.querySelectorAll('.mpgd-filter-readout').forEach(el=>el.textContent=sourceName);
    win.querySelectorAll('.mpgd-filter-pointer-readout').forEach(el=>el.textContent='—');
  }

  const phaseCard=win.querySelector('.mpgd-filter-card[data-filter-card="phase"]');
  const magCard=win.querySelector('.mpgd-filter-card[data-filter-card="magnitude"]');
  if(phaseCard) phaseCard.style.opacity=filter.ui.phase?'1':'.20';
  if(magCard) magCard.style.opacity=filter.ui.magnitude?'1':'.20';

  const bandCount=win.querySelector('[data-filter-band-count]');
  if(bandCount) bandCount.textContent=filter.bands.length+' band'+(filter.bands.length===1?'':'s');

  const windowTitle=win.querySelector('.mpgd-filter-window-title strong');
  if(windowTitle){
    windowTitle.textContent=entry?.name
      ?'Mag-Phase-GD Filter · '+entry.name
      :'Mag-Phase-GD Filter';
  }

  const chip=win.querySelector('.mpgd-filter-idchip');
  if(chip){
    const mode=filter.bypass?'BYPASS':'FILTER';
    chip.textContent=filter.id+' · '+mode;
  }

  renderBandMarkers(filter,win,views);
  renderBandRack(filter,win);

  if(win._activeBandId&&!filter.bands.some(b=>b.id===win._activeBandId)){
    win._activeBandId=null;
    removeBandEditor(win);
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
  close.addEventListener('click',()=>{
    removeBandEditor(win);
    win.hidden=true;
    win.classList.remove('is-front');
  });

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
    ['sync','Sync cursor'],
    ['bandPoints','Band Points']
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

  const rack=document.createElement('aside');
  rack.className='mpgd-band-rack';
  rack.append(buildBandRackSection('phase'),buildBandRackSection('magnitude'));

  const workspace=document.createElement('section');
  workspace.className='mpgd-filter-workspace';
  workspace.append(graphs,rack);

  main.append(toolbar,workspace);

  body.append(main);
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
    q:Number(band.q??band.Q),
    graphKind:band.graphKind==='phase'?'phase':'magnitude'
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

document.addEventListener('raptor:pipelinedisconnectrequest',event=>{
  const wireId=String(event.detail?.wireId||'');
  if(!wireId.startsWith('mpgd-input:')) return;
  const filterId=wireId.slice('mpgd-input:'.length);
  const filter=filterById(filterId);
  if(!filter) return;
  if(event.detail?.sourceId&&String(event.detail.sourceId)!==String(filter.input?.id||'')) return;
  disconnectInput(filter);
});

document.addEventListener('pointerdown',event=>{
  if(bandContextMenu&&!bandContextMenu.hidden&&!bandContextMenu.contains(event.target)) closeBandContext();
});

document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    closeBandContext();
    const front=[...windows.values()].filter(win=>!win.hidden).sort((a,b)=>(Number(b.style.zIndex)||0)-(Number(a.style.zIndex)||0))[0];
    if(front?._bandEditor){
      removeBandEditor(front);
      return;
    }
    if(front) front.hidden=true;
  }
});

window.addEventListener('resize',()=>{
  closeBandContext();
  renderConnections();
  for(const [id,win] of windows){
    if(win.hidden) continue;
    const filter=filterById(id);
    if(!filter) continue;
    const rect=win.getBoundingClientRect();
    const pos=clampWindowPosition(rect.left,rect.top,win);
    win.style.left=pos.x+'px';
    win.style.top=pos.y+'px';
    filter.windowPosition=pos;

    const panel=win._bandEditor;
    if(panel?.isConnected){
      const panelRect=panel.getBoundingClientRect();
      const panelPos=clampBandEditorPosition(panelRect.left,panelRect.top,panel);
      panel.style.left=panelPos.x+'px';
      panel.style.top=panelPos.y+'px';
      win._bandEditorPosition=panelPos;
    }
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
      ensurePersistentWireGroup().replaceChildren();
    }
    baseDelete(card);
  };
}

new MutationObserver(()=>{
  if(!activeCard) return;
  for(const filter of activeFilters()){
    const node=canvas.querySelector('.mpgd-filter-node[data-filter-id="'+filter.id+'"]');
    if(node) applyNodeLineage(node,filter);

    const win=windows.get(filter.id);
    if(win?.isConnected&&!win.hidden) applyMagnitudeLineageFill(win,filter);
  }
  requestAnimationFrame(renderConnections);
}).observe(measurementList,{childList:true,subtree:false});

new MutationObserver(()=>requestAnimationFrame(renderConnections))
  .observe(measurementNode,{attributes:true,attributeFilter:['style']});

new ResizeObserver(()=>requestAnimationFrame(renderConnections)).observe(measurementNode);
canvas.addEventListener('scroll',()=>requestAnimationFrame(renderConnections),{passive:true});

window.RaptorMagPhaseGdFilter=Object.freeze({
  type:FILTER_TYPE,
  createAt:createFilterAt,
  open:openFilterWindow,
  list:listFilters,
  get:getFilter,
  setBands,
  delete:deleteFilter,
  disconnectInput(filterId){
    const filter=filterById(filterId);
    return filter?disconnectInput(filter):false;
  },
  setBypass(filterId,bypass){
    const filter=filterById(filterId);
    if(!filter) return false;
    filter.bypass=!!bypass;
    renderNodes();
    const win=windows.get(filterId);
    if(win&&!win.hidden) renderWindow(filter,win);
    return true;
  },
  getOutput(filterId,outputKind){
    const filter=filterById(filterId);
    if(!filter||!['phase','magnitude'].includes(outputKind)) return null;
    const entry=sourceEntry(filter);
    const views=displayViewsForFilter(filter);
    if(!entry||!views) return null;
    return {
      filterId,
      outputKind,
      bypass:filter.bypass===true,
      sourceMeasurementId:entry.id,
      color:entry.color||null,
      frequency_hz:views.frequency_hz,
      values:outputKind==='phase'?views.phase_deg:views.magnitude_db,
      coherence:views.coherence||null,
      sampleRateHz:filter.sampleRateHz||entry.sampleRate||entry.canonical?.sample_rate_hz||null,
      canonicalMutated:false
    };
  },
  refresh:renderNodes,
  refreshConnections:renderConnections
});
})();