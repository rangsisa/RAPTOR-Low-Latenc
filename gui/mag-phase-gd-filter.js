(()=>{
'use strict';

const api=window.RaptorPipeline;
const workspaceView=window.RaptorPipelineWorkspaceView;
const canvas=document.getElementById('pipelineNodeCanvas');
const wireSvg=document.querySelector('.pipeline-wire-layer');
const measurementNode=document.getElementById('measurementNode');
const measurementList=document.getElementById('measurementList');
const rbj=window.RaptorEqGeometryRBJ||null;
const responseHost=window.RaptorResponseHostV1||null;
if(!api||!workspaceView||!canvas||!wireSvg||!measurementNode||!measurementList) return;

const SVG_NS='http://www.w3.org/2000/svg';
const F0=20;
const F1=20000;
const GRAPH_WIDTH=1000;
const GRAPH_HEIGHT=220;
const MAX_DISPLAY_POINTS=1800;
const UNCERTAINTY_NEEDLE_MAX_HEIGHT=GRAPH_HEIGHT*.30;
const UNCERTAINTY_NEEDLE_MIN_SPACING=10;
const UNCERTAINTY_MAG_RELIEF_DB=6;
const UNCERTAINTY_CONFIDENCE_FLOOR=.25;
const PHASE_LIFT_GAIN_MIN_DEG=-180;
const PHASE_LIFT_GAIN_MAX_DEG=180;
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
let hostSequence=1;
const hostCache=new Map();

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
    ui:{phase:true,magnitude:true,wrap:false,sync:true,bandPoints:true,magToPhase:false}
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
    input:filter.input?.id?{
      kind:filter.input.kind==='filter'?'filter':'measurement',
      id:String(filter.input.id)
    }:null,
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
      bandPoints:filter.ui?.bandPoints!==false,
      magToPhase:filter.ui?.magToPhase===true
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
  filter.input=filter.input?.id?{
    kind:filter.input.kind==='filter'?'filter':'measurement',
    id:String(filter.input.id)
  }:null;
  filter.bypass=filter.bypass===true;
  filter.sampleRateHz=Number.isFinite(Number(filter.sampleRateHz))&&Number(filter.sampleRateHz)>0?Number(filter.sampleRateHz):null;
  if(!Array.isArray(filter.bands)) filter.bands=[];
  for(const band of filter.bands){
    band.graphKind=band.graphKind==='phase'?'phase':'magnitude';
    if(band.graphKind==='phase'){
      band.gainDb=clampPhaseLiftGainDeg(band.gainDb);
      band.q=Math.max(.05,Math.min(50,Number(band.q)||1.41421356));
    }
  }
  if(!filter.ui) filter.ui={phase:true,magnitude:true,wrap:false,sync:true,bandPoints:true,magToPhase:false};
  if(filter.ui.phase===undefined) filter.ui.phase=true;
  if(filter.ui.magnitude===undefined) filter.ui.magnitude=true;
  if(filter.ui.wrap===undefined) filter.ui.wrap=false;
  if(filter.ui.sync===undefined) filter.ui.sync=true;
  if(filter.ui.bandPoints===undefined) filter.ui.bandPoints=true;
  if(filter.ui.magToPhase===undefined) filter.ui.magToPhase=false;
  filter.ui.magToPhase=filter.ui.magToPhase===true;
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
    win._phaseTurnInspector?.destroy?.();
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

function sourceRef(filter){
  if(!filter?.input?.id) return null;
  return {
    kind:filter.input.kind==='filter'?'filter':'measurement',
    id:String(filter.input.id)
  };
}

function sourceEntry(filter){
  const ref=sourceRef(filter);
  if(!ref) return null;

  if(ref.kind==='measurement'){
    const entry=api.getMeasurement?.(ref.id)||null;
    return entry?{...entry,sourceKind:'measurement',lineageActive:true}:null;
  }

  const canonicalApi=window.RaptorMeasurementCanonicalV1||null;
  const crossover=window.RaptorCrossoverFilter||null;
  const crossoverUpstream=crossover?.get?.(ref.id)||null;

  if(crossoverUpstream){
    let canonical=crossover?.getOutput?.(ref.id)||null;
    if(canonical){
      try{canonicalApi?.validate(canonical);}catch{canonical=null;}
    }

    const lineage=crossover?.getLineage?.(ref.id)||{
      active:!!canonical,
      color:'#8FA6B8',
      measurementId:null
    };

    return {
      id:ref.id,
      name:crossoverUpstream.label?crossoverUpstream.label+' · '+ref.id:(canonical?.source_name||ref.id),
      color:lineage.color||'#8FA6B8',
      lineageActive:lineage.active===true,
      sampleRate:canonical?.sample_rate_hz||crossoverUpstream.sampleRateHz||null,
      canonical,
      format:canonical?.format||canonicalApi?.FORMAT||'raptor.measurement.canonical.v1',
      sourceKind:'filter',
      filterType:crossoverUpstream.type||null,
      hasData:!!canonical
    };
  }

  const magUpstream=filterById(ref.id);
  if(!magUpstream) return null;

  let canonical=canonicalOutputForFilter(magUpstream);
  if(canonical){
    try{canonicalApi?.validate(canonical);}catch{canonical=null;}
  }
  const lineage=magLineageInfo(magUpstream);

  return {
    id:ref.id,
    name:magUpstream.label?magUpstream.label+' · '+ref.id:(canonical?.source_name||ref.id),
    color:lineage.color||'#8FA6B8',
    lineageActive:lineage.active===true,
    sampleRate:canonical?.sample_rate_hz||magUpstream.sampleRateHz||null,
    canonical,
    format:canonical?.format||canonicalApi?.FORMAT||'raptor.measurement.canonical.v1',
    sourceKind:'filter',
    filterType:FILTER_TYPE,
    hasData:!!canonical
  };
}

function sourceColor(filter){
  return sourceEntry(filter)?.color||'#8FA6B8';
}

function lineageMeasurementName(filter){
  const lineage=magLineageInfo(filter);
  if(!lineage?.active||!lineage.measurementId) return null;
  return api.getMeasurement?.(lineage.measurementId)?.name||null;
}

function hostSignature(filter,entry){
  const bands=filter.bands.map(band=>[
    band.id,
    band.graphKind,
    Number(band.frequencyHz),
    Number(band.gainDb),
    Number(band.q)
  ]);
  return JSON.stringify([
    entry?.id||null,
    filter.bypass===true,
    filter.ui?.magToPhase===true,
    Number(filter.sampleRateHz)||null,
    bands
  ]);
}

function downstreamMagOutputIds(filterId){
  const rootId=String(filterId||'');
  if(!rootId) return [];
  const affected=new Set([rootId]);

  // Dependency traversal only: this does not reject or restrict topology.
  let expanded=true;
  while(expanded){
    expanded=false;
    for(const candidate of activeFilters()){
      const candidateId=String(candidate.id||'');
      if(!candidateId||affected.has(candidateId)) continue;
      const ref=sourceRef(candidate);
      if(ref?.kind==='filter'&&affected.has(String(ref.id))){
        affected.add(candidateId);
        expanded=true;
      }
    }
  }
  return [...affected];
}

function invalidateResponseHost(filter,reason='processing-change'){
  if(!filter) return;
  const affectedFilterIds=downstreamMagOutputIds(filter.id);
  for(const filterId of affectedFilterIds){
    hostCache.delete(filterId);
    clearPhaseTurnInspector(filterId,reason);
  }

  document.dispatchEvent(new CustomEvent('raptor:filteroutputchange',{
    detail:{
      filterId:filter.id,
      filterType:FILTER_TYPE,
      reason,
      outputs:['canonical'],
      affectedFilterIds
    }
  }));
}

function responseHostForFilter(filter){
  if(!filter||!responseHost) return null;
  const entry=sourceEntry(filter);
  if(!entry) return null;
  const views=displayViewsForFilter(filter);
  if(!views?.frequency_hz) return null;

  const signature=hostSignature(filter,entry);
  const cached=hostCache.get(filter.id);
  if(cached?.signature===signature) return cached.host;

  const line=api.getActiveLine?.()||null;
  const host=responseHost.create({
    id:filter.id+':response:'+(hostSequence++),
    name:(entry.name||'Measurement')+' → '+filter.label,
    views,
    sampleRateHz:filter.sampleRateHz||entry.sampleRate||entry.canonical?.sample_rate_hz||null,
    color:entry.color||null,
    source:{
      kind:entry.sourceKind||'measurement',
      measurementId:entry.sourceKind==='measurement'?entry.id:null,
      measurementName:entry.sourceKind==='measurement'?(entry.name||null):null,
      filterId:entry.sourceKind==='filter'?entry.id:null,
      filterType:entry.sourceKind==='filter'?(entry.filterType||null):null,
      filterName:entry.sourceKind==='filter'?(entry.name||null):null,
      canonicalFormat:entry.canonical?.format||null,
      lineId:line?.id||null,
      lineName:line?.name||null
    },
    processing:{
      filterId:filter.id,
      filterType:FILTER_TYPE,
      bypass:filter.bypass===true,
      frequencyDomainApplied:filter.bypass!==true,
      phaseBandRule:'ADDITIVE_PHASE_LIFT_BELL_UNIT_MAGNITUDE',
      magnitudeBandRule:filter.ui?.magToPhase===true
        ?'RBJ_MAGNITUDE_PLUS_COUPLED_PHASE'
        :'RBJ_MAGNITUDE_ONLY_PHASE_DECOUPLED',
      magnitudePhaseCoupled:filter.ui?.magToPhase===true,
      bands:filter.bands.map(band=>({
        id:band.id,
        type:band.graphKind==='phase'?'phase-lift-bell':'peaking',
        graphKind:band.graphKind,
        frequencyHz:Number(band.frequencyHz),
        gainDb:band.graphKind==='phase'?null:Number(band.gainDb),
        gainDeg:band.graphKind==='phase'?clampPhaseLiftGainDeg(band.gainDb):null,
        q:Number(band.q)
      }))
    },
    provenance:{
      canonicalMutated:false,
      resampled:false,
      interpolated:false,
      fftGrid:false,
      sourceFrequencyCoordinatesPreserved:true
    }
  });

  // Crossover chains now publish raptor:crossoveroutputchange with downstream
  // affected IDs, so filter-source snapshots can be cached safely and are
  // invalidated whenever their upstream response changes.
  hostCache.set(filter.id,{signature,host});
  return host;
}

function outputProjection(filter,kind){
  const host=responseHostForFilter(filter);
  return host?responseHost.project(host,kind):null;
}

function canonicalOutputForFilter(filter){
  if(!filter) return null;
  const canonicalApi=window.RaptorMeasurementCanonicalV1||null;
  const entry=sourceEntry(filter);
  const source=entry?.canonical||null;
  if(!canonicalApi||!source) return null;

  try{canonicalApi.validate(source);}catch{return null;}
  const processed=displayViewsForFilter(filter);
  if(!processed?.magnitude_db||!processed?.phase_deg) return null;

  const output=canonicalApi.clone(source);
  const outputViews=canonicalApi.views(output);
  if(outputViews.magnitude_db.length!==processed.magnitude_db.length||
     outputViews.phase_deg.length!==processed.phase_deg.length){
    return null;
  }

  outputViews.magnitude_db.set(processed.magnitude_db);
  outputViews.phase_deg.set(processed.phase_deg);
  output.payload_sha256=null;
  output.measurement_id=filter.id;
  output.source_name=(source.source_name||entry.name||'Canonical V1')+' -> '+filter.label;
  canonicalApi.validate(output);
  return output;
}

function magLineageInfo(filter,seen=new Set()){
  if(!filter) return {active:false,color:'#8FA6B8',measurementId:null};
  const filterId=String(filter.id||'');
  if(filterId&&seen.has(filterId)){
    return {active:false,color:'#8FA6B8',measurementId:null};
  }
  const nextSeen=new Set(seen);
  if(filterId) nextSeen.add(filterId);

  const ref=sourceRef(filter);
  if(!ref) return {active:false,color:'#8FA6B8',measurementId:null};

  if(ref.kind==='measurement'){
    const entry=api.getMeasurement?.(ref.id)||null;
    return {
      active:!!entry,
      color:entry?.color||'#8FA6B8',
      measurementId:entry?ref.id:null
    };
  }

  const crossover=window.RaptorCrossoverFilter||null;
  if(crossover?.get?.(ref.id)){
    const lineage=crossover.getLineage?.(ref.id)||null;
    return lineage
      ?{active:lineage.active===true,color:lineage.color||'#8FA6B8',measurementId:lineage.measurementId||null}
      :{active:false,color:'#8FA6B8',measurementId:null};
  }

  const upstreamMag=filterById(ref.id);
  return upstreamMag
    ?magLineageInfo(upstreamMag,nextSeen)
    :{active:false,color:'#8FA6B8',measurementId:null};
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

function crossoverHandle(filterId){
  const node=[...canvas.querySelectorAll('.xo-filter-node')]
    .find(candidate=>candidate.dataset.filterId===String(filterId));
  return node?.querySelector('.xo-filter-output')||null;
}

function magHandle(filterId){
  const node=[...canvas.querySelectorAll('.mpgd-filter-node')]
    .find(candidate=>candidate.dataset.filterId===String(filterId));
  return node?.querySelector('.mpgd-filter-output')||null;
}

function sourceHandle(filter){
  const ref=sourceRef(filter);
  if(!ref) return null;
  if(ref.kind==='measurement') return measurementHandle(ref.id);
  return crossoverHandle(ref.id)||magHandle(ref.id);
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
  const group=ensurePersistentWireGroup();
  group.replaceChildren();
  if(!activeCard) return;

  for(const filter of activeFilters()){
    const entry=sourceEntry(filter);
    const ref=sourceRef(filter);
    const source=sourceHandle(filter);
    const target=canvas.querySelector('.mpgd-filter-node[data-filter-id="'+filter.id+'"] .mpgd-filter-input');
    if(!entry||!ref||!source||!target) continue;

    const d=wireCurve(canvasPointFor(source),canvasPointFor(target),source,target);
    if(!d) continue;
    const hit=document.createElementNS(SVG_NS,'path');
    hit.setAttribute('class','pipeline-persistent-wire-hit');
    hit.setAttribute('d',d);
    hit.dataset.wireId='mpgd-input:'+filter.id;
    hit.dataset.sourceKind=ref.kind;
    hit.dataset.sourceId=ref.id;
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
  node.classList.toggle('has-lineage',entry?.lineageActive===true);
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

function canConnectInput(filter,source){
  if(!filter||!source||filter.input?.id) return false;
  if(api.wouldCreateFilterCycle?.(source,filter.id)) return false;
  const canonicalApi=window.RaptorMeasurementCanonicalV1||null;
  const canonical=source.canonical||null;
  const expectedFormat=canonicalApi?.FORMAT||'raptor.measurement.canonical.v1';
  const format=source.format||canonical?.format||null;

  if(format!==expectedFormat) return false;
  if(!canonical) return true;

  try{
    canonicalApi?.validate(canonical);
    return true;
  }catch{
    return false;
  }
}

function connectInput(filter,source,meta={}){
  if(!canConnectInput(filter,source)) return false;
  const kind=meta.sourceKind==='filter'||source.kind==='filter'?'filter':'measurement';
  const sourceId=String(meta.sourceId??source.id??'');
  if(!sourceId) return false;

  filter.input={kind,id:sourceId};
  filter.sampleRateHz=Number(source.sampleRate??source.canonical?.sample_rate_hz)||null;
  invalidateResponseHost(filter,'input-connect');
  renderNodes();
  const win=windows.get(filter.id);
  if(win&&!win.hidden) renderWindow(filter,win);
  document.dispatchEvent(new CustomEvent('raptor:filterinputchange',{
    detail:{
      filterId:filter.id,
      sourceKind:kind,
      sourceId,
      connected:true,
      color:source.color||null
    }
  }));
  return true;
}

function disconnectInput(filter){
  if(!filter?.input?.id) return false;
  const sourceId=filter.input.id;
  filter.input=null;
  filter.sampleRateHz=null;
  invalidateResponseHost(filter,'input-disconnect');
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
    win._phaseTurnInspector?.destroy?.();
    win.remove();
  }
  windows.delete(filterId);
  hostCache.delete(filterId);
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filterdeleted',{
    detail:{filterId,filterType:FILTER_TYPE}
  }));
  return true;
}

function clampNodePosition(position,node=null){
  const width=node?.offsetWidth||222;
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

function buildNode(filter,index){
  const node=document.createElement('section');
  node.className='mpgd-filter-node';
  node.dataset.filterId=filter.id;
  node.setAttribute('aria-label','Mag Phase GD Filter '+(index+1));

  const requestedX=Math.max(8,Number(filter.position?.x)||8);
  const requestedY=Math.max(8,Number(filter.position?.y)||8);
  const pos={x:requestedX,y:requestedY};
  filter.position=pos;
  workspaceView.positionNode(node,pos.x,pos.y);

  const head=document.createElement('header');
  head.className='mpgd-filter-node-head';

  const title=document.createElement('div');
  title.className='mpgd-filter-node-title';
  const sourceFileName=lineageMeasurementName(filter);
  const headerText='Mag-Phase-GD Filter'+(sourceFileName?' · '+sourceFileName:'');
  title.innerHTML='<strong></strong>';
  title.querySelector('strong').textContent=headerText;
  title.title=headerText;

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

  const row=document.createElement('div');
  row.className='mpgd-filter-output-row';
  row.dataset.outputKind='canonical';

  const copy=document.createElement('div');
  copy.className='mpgd-filter-output-copy';
  copy.innerHTML='<strong>OUTPUT</strong>';

  const handle=document.createElement('button');
  handle.className='mpgd-filter-output';
  handle.type='button';
  handle.dataset.filterId=filter.id;
  handle.dataset.outputKind='canonical';
  handle.title='Output';
  handle.setAttribute('aria-label','Output from '+filter.id);
  handle.addEventListener('pointerdown',event=>{
    event.stopPropagation();
    const canonical=canonicalOutputForFilter(filter);
    const canonicalApi=window.RaptorMeasurementCanonicalV1||null;
    const color=sourceColor(filter);

    api.startCanonicalWire?.(event,{
      kind:'filter',
      id:filter.id,
      filterId:filter.id,
      name:filter.label,
      outputKind:'canonical',
      color,
      sampleRate:canonical?.sample_rate_hz||null,
      format:canonical?.format||canonicalApi?.FORMAT||'raptor.measurement.canonical.v1',
      canonical,
      hasData:!!canonical
    },handle);

    document.dispatchEvent(new CustomEvent('raptor:filteroutputwirestart',{
      detail:{
        filterId:filter.id,
        filterType:FILTER_TYPE,
        outputKind:'canonical',
        bypass:filter.bypass===true,
        sourceKind:'filter',
        sourceId:filter.id,
        color,
        format:canonical?.format||canonicalApi?.FORMAT||'raptor.measurement.canonical.v1',
        canonical,
        hasData:!!canonical
      }
    }));
  });

  row.append(copy,handle);
  outputs.appendChild(row);
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
    invalidateResponseHost(filter,'bypass-change');
    applyNodeLineage(node,filter);
    const win=windows.get(filter.id);
    if(win&&!win.hidden) renderWindow(filter,win);
    document.dispatchEvent(new CustomEvent('raptor:filterbypasschange',{
      detail:{filterId:filter.id,filterType:FILTER_TYPE,bypass:filter.bypass}
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
    if(filter.input?.id&&!sourceEntry(filter)){
      filter.input=null;
      filter.sampleRateHz=null;
      invalidateResponseHost(filter,'input-missing');
    }
    const node=buildNode(filter,index);
    canvas.appendChild(node);
    const input=node.querySelector('.mpgd-filter-input');
    api.registerInput?.('mpgd:'+filter.id+':input',input,{
      radius:50,
      ownerFilterId:filter.id,
      getCurrentSourceRef:()=>sourceRef(filter),
      canAccept:source=>canConnectInput(filter,source),
      onConnect:(source,meta)=>connectInput(filter,source,meta)
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

// Trace geometry must preserve the real magnitude even outside the visible
// ±40 dB viewport. The parent plot clips it naturally at the graph boundary,
// so a response below -40 dB dives out of view instead of riding the bottom edge.
function yMagnitudeTrace(value){
  return GRAPH_HEIGHT-((Number(value)+40)/80)*GRAPH_HEIGHT;
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

function clampPhaseLiftGainDeg(value){
  const number=Number(value);
  if(!Number.isFinite(number)) return 0;
  return Math.max(PHASE_LIFT_GAIN_MIN_DEG,Math.min(PHASE_LIFT_GAIN_MAX_DEG,number));
}

function phaseLiftBellWeight(frequencyHz,centerHz,q){
  const f=Number(frequencyHz);
  const f0=Number(centerHz);
  const quality=Math.max(.05,Math.min(50,Number(q)));
  if(!(Number.isFinite(f)&&Number.isFinite(f0)&&Number.isFinite(quality)&&f>0&&f0>0)) return 0;

  // Symmetric in log-frequency because r -> 1/r only flips the sign.
  // This is target-shaping geometry, not an all-pass/IIR transfer function.
  const ratio=f/f0;
  const detune=ratio-1/ratio;
  const x=quality*detune;
  return 1/Math.sqrt(1+x*x);
}

function phaseLiftDeltaDeg(frequencyHz,band){
  if(!band||band.graphKind!=='phase') return 0;
  return clampPhaseLiftGainDeg(band.gainDb)*phaseLiftBellWeight(
    frequencyHz,
    band.frequencyHz,
    band.q
  );
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
    // Phase bands are no longer RBJ/AP-like responses. They are direct
    // additive phase-target lift bells. Only Magnitude bands enter RBJ.
    const operations=filter.bands.map(band=>
      band.graphKind==='phase'?null:rbj.normalizeOperation(band,fs)
    );
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
      const sourceMagnitude=Number(magnitude[i]);
      const sourcePhaseDeg=Number(phase[i]);
      if(!(Number.isFinite(f)&&f>0&&f<=fs/2&&Number.isFinite(sourceMagnitude)&&Number.isFinite(sourcePhaseDeg))) return base;

      let totalReal=1;
      let totalImag=0;
      let deltaMagnitudeDb=0;
      let deltaPhaseLiftDeg=0;

      for(let n=0;n<operations.length;n++){
        const band=filter.bands[n];

        if(band.graphKind==='phase'){
          deltaPhaseLiftDeg+=phaseLiftDeltaDeg(f,band);
          continue;
        }

        const h=rbj.responseAt(f,operations[n],fs);
        const hMagnitude=Math.hypot(h.real,h.imag);
        if(!(hMagnitude>0)) continue;

        // Magnitude is always applied. Coupled RBJ phase is opt-in because
        // RAPTOR keeps Magnitude and Phase targets independent by default.
        if(filter.ui?.magToPhase===true){
          const ur=h.real/hMagnitude;
          const ui=h.imag/hMagnitude;
          const nr=totalReal*ur-totalImag*ui;
          const ni=totalReal*ui+totalImag*ur;
          totalReal=nr;
          totalImag=ni;
        }
        deltaMagnitudeDb+=h.magnitudeDb;
      }

      const coupledMagnitudePhaseDeg=Math.atan2(totalImag,totalReal)*180/Math.PI;
      outMagnitude[i]=sourceMagnitude+deltaMagnitudeDb;
      const outputPhaseRad=(sourcePhaseDeg+deltaPhaseLiftDeg+coupledMagnitudePhaseDeg)*Math.PI/180;
      outPhase[i]=Math.atan2(Math.sin(outputPhaseRad),Math.cos(outputPhaseRad))*180/Math.PI;
    }

    return Object.freeze({
      ...base,
      magnitude_db:outMagnitude,
      phase_deg:outPhase,
      filter_geometry:Object.freeze({
        model:'RAPTOR_MAG_PHASE_GD_SPLIT_GEOMETRY_V2',
        phase_band_rule:'ADDITIVE_PHASE_LIFT_BELL_UNIT_MAGNITUDE',
        magnitude_band_rule:filter.ui?.magToPhase===true
          ?'RBJ_MAGNITUDE_PLUS_COUPLED_PHASE'
          :'RBJ_MAGNITUDE_ONLY_PHASE_DECOUPLED',
        magnitude_phase_coupled:filter.ui?.magToPhase===true,
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
    const x=xOf(f),y=yMagnitudeTrace(value);
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

  // Display-only density guard:
  // dense measurement bins can overlap into a solid red block. Bucket only
  // the uncertainty needles in graph-X space and keep the worst uncertainty
  // in each bucket. Canonical/coherence/DSP arrays remain untouched.
  const buckets=new Map();
  for(const i of indices){
    const f=frequency[i],c0=coherence[i],mag=magnitude[i];
    if(!Number.isFinite(f)||!Number.isFinite(c0)) continue;
    const loss=1-Math.max(0,Math.min(1,c0));
    if(loss<=0) continue;
    const relief=uncertaintyMagnitudeRelief(mag);
    const height=loss*relief*UNCERTAINTY_NEEDLE_MAX_HEIGHT;
    if(!(height>0)) continue;
    const x=xOf(f);
    const bucket=Math.floor(x/UNCERTAINTY_NEEDLE_MIN_SPACING);
    const current=buckets.get(bucket);
    if(!current||height>current.height) buckets.set(bucket,{x,height});
  }

  let path='';
  const needles=[...buckets.values()].sort((a,b)=>a.x-b.x);
  for(const needle of needles){
    const yTop=GRAPH_HEIGHT-needle.height;
    path+='M'+needle.x.toFixed(2)+' '+GRAPH_HEIGHT+' L'+needle.x.toFixed(2)+' '+yTop.toFixed(2)+' ';
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

  head.append(title,readout,pointer,unit);

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
  }

  const trace=document.createElementNS(SVG_NS,'path');
  trace.setAttribute('class','trace');
  svg.appendChild(trace);

  if(kind==='phase'){
    const selection=document.createElementNS(SVG_NS,'path');
    selection.setAttribute('class','phase-turn-selection');
    svg.appendChild(selection);

    for(const key of ['start','reference','end']){
      const marker=document.createElementNS(SVG_NS,'circle');
      marker.setAttribute('class','phase-turn-marker phase-turn-marker--'+key);
      marker.setAttribute('r',key==='reference'?'4':'3.5');
      marker.setAttribute('visibility','hidden');
      svg.appendChild(marker);
    }
  }

  const y=document.createElement('div');
  y.className='mpgd-filter-ylabels';
  y.innerHTML=kind==='phase'
    ?'<span>180°</span><span>90°</span><span>0°</span><span>-90°</span><span>-180°</span>'
    :'<span>40</span><span>20</span><span>0</span><span>-20</span><span>-40</span>';

  const x=document.createElement('div');
  x.className='mpgd-filter-xlabels';
  buildAxisLabels(x);

  const bandMarkersBack=document.createElement('div');
  bandMarkersBack.className='mpgd-band-markers mpgd-band-markers--back';
  bandMarkersBack.dataset.kind=kind;

  const bandMarkersFront=document.createElement('div');
  bandMarkersFront.className='mpgd-band-markers mpgd-band-markers--front';
  bandMarkersFront.dataset.kind=kind;

  const bandMarkersHit=document.createElement('div');
  bandMarkersHit.className='mpgd-band-markers mpgd-band-markers--hit';
  bandMarkersHit.dataset.kind=kind;

  if(kind==='phase'){
    const panel=document.createElement('section');
    panel.className='mpgd-phase-turn-panel';
    panel.hidden=true;
    panel.innerHTML=
      '<header><strong>PHASE TURN INSPECTOR</strong><span data-inspector="status">—</span><button type="button" data-phase-turn-clear>Clear</button></header>'+
      '<div class="mpgd-phase-turn-points">'+
        '<b>START</b><span data-inspector="start">—</span>'+
        '<b>REF</b><span data-inspector="reference">—</span>'+
        '<b>END</b><span data-inspector="end">—</span>'+
      '</div>'+
      '<div class="mpgd-phase-turn-summary">'+
        '<span data-inspector="travel">—</span>'+
        '<span data-inspector="delay">—</span>'+
        '<span data-inspector="fit">—</span>'+
        '<span data-inspector="quality">—</span>'+
        '<span data-inspector="reason">—</span>'+
      '</div>';
    plot.append(grid,bandMarkersBack,svg,y,x,bandMarkersFront,bandMarkersHit,panel);
  }else{
    plot.append(grid,bandMarkersBack,svg,y,x,bandMarkersFront,bandMarkersHit);
  }
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
    invalidateResponseHost(filter,'band-add');

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

function clearPhaseTurnInspector(filterId,reason='response-change'){
  const win=windows.get(String(filterId));
  win?._phaseTurnInspector?.invalidate?.(reason);
}
function inspectorNumber(value,digits=2){
  return Number.isFinite(Number(value))?Number(value).toFixed(digits):'—';
}
function inspectorFrequency(value){
  return Number.isFinite(Number(value))
    ?Number(value).toFixed(Number(value)>=1000?1:2)+' Hz'
    :'—';
}
function clippedInspectorSegment(segment){
  let [x1,y1,x2,y2]=segment;
  if((x1<0&&x2<0)||(x1>GRAPH_WIDTH&&x2>GRAPH_WIDTH)) return null;
  if(x1<0){
    const t=(0-x1)/(x2-x1);y1=y1+(y2-y1)*t;x1=0;
  }else if(x1>GRAPH_WIDTH){
    const t=(GRAPH_WIDTH-x1)/(x2-x1);y1=y1+(y2-y1)*t;x1=GRAPH_WIDTH;
  }
  if(x2<0){
    const t=(0-x1)/(x2-x1);y2=y1+(y2-y1)*t;x2=0;
  }else if(x2>GRAPH_WIDTH){
    const t=(GRAPH_WIDTH-x1)/(x2-x1);y2=y1+(y2-y1)*t;x2=GRAPH_WIDTH;
  }
  return [x1,y1,x2,y2];
}
function renderPhaseTurnInspector(win,result){
  win._phaseTurnResult=result||null;
  const panel=win.querySelector('.mpgd-phase-turn-panel');
  const svg=win.querySelector('.mpgd-filter-svg--phase');
  const path=svg?.querySelector('.phase-turn-selection');
  const marks={
    start:svg?.querySelector('.phase-turn-marker--start'),
    reference:svg?.querySelector('.phase-turn-marker--reference'),
    end:svg?.querySelector('.phase-turn-marker--end')
  };
  if(!result){
    if(panel) panel.hidden=true;
    if(path) path.setAttribute('d','');
    Object.values(marks).forEach(mark=>mark?.setAttribute('visibility','hidden'));
    return;
  }

  if(panel){
    panel.hidden=false;
    const set=(key,value)=>{
      const el=panel.querySelector('[data-inspector="'+key+'"]');
      if(el) el.textContent=value;
    };
    const pointText=item=>item
      ?inspectorFrequency(item.frequencyHz)+' · '+inspectorNumber(item.wrappedPhaseDeg,1)+'° · U '+inspectorNumber(item.unwrappedPhaseDeg,1)+'°'
      :'—';
    set('status',result.status+(result.delayInterpretation?.includes('TIME_ADVANCE')?' · TIME ADVANCE':''));
    set('start',pointText(result.start));
    set('reference',pointText(result.reference));
    set('end',pointText(result.end));
    set('travel',inspectorNumber(result.phaseTravelDeg,2)+'° · '+inspectorNumber(result.rotations,3)+' turn');
    set('delay','fit '+inspectorNumber(result.fittedDelayMs,4)+' ms · avg '+inspectorNumber(result.equivalentDelayMs,4)+' ms');
    set('fit','slope '+inspectorNumber(result.slopeDegPerHz,6)+' °/Hz · R² '+inspectorNumber(result.r2,5)+' · RMSE '+inspectorNumber(result.rmse,3)+'°');
    set('quality','coh '+inspectorNumber(result.coherenceMedian,3)+' · pts '+String(result.pointsUsed??'—')+'/'+String(result.pointsAvailable??'—')+' · reject '+String(result.pointsRejected??'—'));
    set('reason',result.reason||'—');
  }

  const geometry=result.geometry;
  if(path){
    const d=(geometry?.segments||[])
      .map(clippedInspectorSegment)
      .filter(Boolean)
      .map(seg=>'M'+seg[0].toFixed(2)+' '+seg[1].toFixed(2)+' L'+seg[2].toFixed(2)+' '+seg[3].toFixed(2))
      .join(' ');
    path.setAttribute('d',d);
  }
  for(const key of ['start','reference','end']){
    const mark=marks[key],point=geometry?.[key];
    if(!mark) continue;
    if(point&&point.x>=0&&point.x<=GRAPH_WIDTH){
      mark.setAttribute('cx',point.x.toFixed(2));
      mark.setAttribute('cy',point.y.toFixed(2));
      mark.setAttribute('visibility','visible');
    }else{
      mark.setAttribute('visibility','hidden');
    }
  }
}
function ensurePhaseTurnInspector(win,filter,plot){
  if(win._phaseTurnInspector||!window.RaptorPhaseTurnInspector) return;
  const clearButton=plot.querySelector('[data-phase-turn-clear]');
  clearButton?.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    win._phaseTurnInspector?.clear?.('clear-button');
  });
  win._phaseTurnInspector=window.RaptorPhaseTurnInspector.create({
    plot,
    getViews:()=>win._mpgdDisplayViews||displayViewsForFilter(filter),
    getDisplayIndices:views=>pointsInDisplayRange(views.frequency_hz,views.phase_deg,views.coherence),
    frequencyAtRatio,
    xOf,
    yPhase,
    options:{graphWidth:GRAPH_WIDTH,graphHeight:GRAPH_HEIGHT,hitRadiusPx:12},
    shouldIgnoreEvent:event=>!!event.target?.closest?.('.mpgd-band-marker,.mpgd-phase-turn-panel'),
    onResult:result=>renderPhaseTurnInspector(win,result)
  });
}

function restoreIdleGraphReadout(win,filter,kind){
  const entry=sourceEntry(filter);
  const readout=win.querySelector('.mpgd-filter-readout[data-kind="'+kind+'"]');
  const pointer=win.querySelector('.mpgd-filter-pointer-readout[data-kind="'+kind+'"]');

  // Keep Measurement filenames visible at idle, but never expose internal
  // filter labels / generated filter IDs in the graph readout. Filter-backed
  // graphs show only live cursor values while the pointer is over the plot.
  if(readout){
    readout.textContent=entry?.sourceKind==='filter'
      ?'—'
      :(entry?.name||'No input');
  }
  if(pointer) pointer.textContent='—';
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
    restoreIdleGraphReadout(win,filter,kind);
    win.querySelectorAll('.cursor,.cursor-point').forEach(node=>node.hidden=true);
  });

  plot.addEventListener('contextmenu',event=>openBandContext(event,filter,kind));
  if(kind==='phase') ensurePhaseTurnInspector(win,filter,plot);
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
      (band.graphKind==='phase'
        ?'<label><span>G</span><input type="number" step="1" min="-180" max="180" data-band-gain><b>deg</b></label>'
        :'<label><span>Gain</span><input type="number" step="0.1" min="-24" max="24" data-band-gain><b>dB</b></label>')+
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
    const gain=clampBandGain(band,Number(gInput.value));
    const q=Math.max(.05,Math.min(50,Number(qInput.value)));
    if(!(Number.isFinite(frequencyHz)&&Number.isFinite(gain)&&Number.isFinite(q))) return;
    band.frequencyHz=frequencyHz;
    band.gainDb=gain;
    band.q=q;
    invalidateResponseHost(filter,'band-edit');
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
    invalidateResponseHost(filter,'band-delete');
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


function clampBandGain(band,value){
  if(band?.graphKind==='phase') return clampPhaseLiftGainDeg(value);
  return Math.max(-24,Math.min(24,Number(value)));
}

function clampBandQ(value){
  return Math.max(.05,Math.min(50,Number(value)));
}

function setBandMarkerVisualState(win,bandId,className,enabled){
  const selector='.mpgd-band-marker-visual[data-band-id="'+String(bandId)+'"]';
  win.querySelectorAll(selector).forEach(marker=>marker.classList.toggle(className,enabled===true));
}

function beginBandGainDrag(event,filter,win,band){
  if(event.button!==undefined&&event.button!==0) return;
  event.preventDefault();
  event.stopPropagation();

  const startY=event.clientY;
  const startGain=Number(band.gainDb)||0;
  const pointerId=event.pointerId;
  const marker=event.currentTarget;
  win._draggingBandId=band.id;
  marker.classList.add('is-gain-dragging');
  setBandMarkerVisualState(win,band.id,'is-gain-dragging',true);

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    if(moveEvent.cancelable) moveEvent.preventDefault();

    // Vertical movement controls G only. Frequency is intentionally locked.
    // Phase uses the graph's degree-per-pixel scale so the marker follows the
    // pointer naturally; Magnitude keeps its established dB sensitivity.
    const deltaY=moveEvent.clientY-startY;
    const sensitivity=band.graphKind==='phase'?(360/GRAPH_HEIGHT):.12;
    band.gainDb=clampBandGain(band,startGain-deltaY*sensitivity);
    invalidateResponseHost(filter,'band-gain');
    renderWindow(filter,win);
    renderNodes();
  };

  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    if(win._draggingBandId===band.id) win._draggingBandId=null;
    win.querySelector('.mpgd-band-marker[data-band-id="'+band.id+'"]')?.classList.remove('is-gain-dragging');
    setBandMarkerVisualState(win,band.id,'is-gain-dragging',false);
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
  invalidateResponseHost(filter,'band-q');
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
    const backLayer=win.querySelector('.mpgd-band-markers--back[data-kind="'+kind+'"]');
    const frontLayer=win.querySelector('.mpgd-band-markers--front[data-kind="'+kind+'"]');
    const hitLayer=win.querySelector('.mpgd-band-markers--hit[data-kind="'+kind+'"]');
    if(!(backLayer&&frontLayer&&hitLayer)) return;

    const i=nearestIndex(views.frequency_hz,band.frequencyHz);
    const f=views.frequency_hz[i];
    const value=kind==='phase'?views.phase_deg[i]:views.magnitude_db[i];
    if(!(Number.isFinite(f)&&Number.isFinite(value))) return;

    const left=(xOf(f)/GRAPH_WIDTH*100)+'%';
    const top=((kind==='phase'?yPhase(value):yMagnitude(value))/GRAPH_HEIGHT*100)+'%';
    const color=BAND_COLORS[index%BAND_COLORS.length];

    const makeVisual=role=>{
      const visual=document.createElement('span');
      visual.className='mpgd-band-marker-visual mpgd-band-marker-visual--'+role;
      visual.dataset.bandId=band.id;
      visual.style.left=left;
      visual.style.top=top;
      visual.style.setProperty('--band-color',color);
      if(win._draggingBandId===band.id) visual.classList.add('is-gain-dragging');
      if(role==='front'){
        const number=document.createElement('span');
        number.className='mpgd-band-marker-number';
        number.textContent=String(index+1);
        visual.appendChild(number);
      }
      return visual;
    };

    backLayer.appendChild(makeVisual('back'));
    frontLayer.appendChild(makeVisual('front'));

    const marker=document.createElement('button');
    marker.type='button';
    marker.className='mpgd-band-marker';
    marker.dataset.bandId=band.id;
    marker.title='Band '+(index+1)+' · '+formatFrequency(band.frequencyHz)+' · Drag ↑↓ '+(kind==='phase'?'G°':'Gain')+' · Wheel Q · Double-click Edit';
    marker.setAttribute('aria-label','Edit Band '+(index+1));
    marker.style.left=left;
    marker.style.top=top;
    marker.style.setProperty('--band-color',color);
    marker.dataset.bandNumber=String(index+1);
    marker.textContent='';

    const setHover=enabled=>setBandMarkerVisualState(win,band.id,'is-hovered',enabled);
    marker.addEventListener('pointerenter',()=>setHover(true));
    marker.addEventListener('pointerleave',()=>setHover(false));
    marker.addEventListener('focus',()=>setHover(true));
    marker.addEventListener('blur',()=>setHover(false));
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
    hitLayer.appendChild(marker);
  });
}

function buildBandRackSection(kind){
  const section=document.createElement('section');
  section.className='mpgd-band-rack-section mpgd-band-rack-section--'+kind;
  section.dataset.rackKind=kind;

  const head=document.createElement('header');
  head.className='mpgd-band-rack-head';
  const title=document.createElement('strong');
  title.textContent=kind==='phase'?'PHASE LIFT BANDS':'MAG BANDS';
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
      meta.textContent=formatFrequency(band.frequencyHz)+' · G '+Number(band.gainDb).toFixed(1)+(kind==='phase'?'°':' dB')+' · Q '+Number(band.q).toFixed(2);
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
        invalidateResponseHost(filter,'band-delete');
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

    restoreIdleGraphReadout(win,filter,'phase');
    restoreIdleGraphReadout(win,filter,'magnitude');
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

  const windowBypass=win.querySelector('[data-filter-window-bypass]');
  if(windowBypass) windowBypass.checked=filter.bypass===true;
  win.classList.toggle('is-bypassed',filter.bypass===true);

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
  title.innerHTML='<strong>Mag-Phase-GD Filter</strong>';

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
    ['phase','Show Phase'],
    ['magnitude','Show Magnitude'],
    ['wrap','Wrap phase'],
    ['sync','Sync cursor'],
    ['bandPoints','Band Points'],
    ['magToPhase','Mag → Phase']
  ];
  for(const [key,label] of controls){
    const item=document.createElement('label');
    item.className='mpgd-filter-check';
    const input=document.createElement('input');
    input.type='checkbox';
    input.checked=!!filter.ui[key];
    input.addEventListener('change',()=>{
      filter.ui[key]=input.checked;
      if(key==='magToPhase'){
        invalidateResponseHost(filter,'mag-phase-coupling');
        renderNodes();
      }
      renderWindow(filter,win);
    });
    const text=document.createElement('span');
    text.textContent=label;
    item.append(input,text);
    toolbar.appendChild(item);
  }
  const windowBypass=document.createElement('label');
  windowBypass.className='mpgd-filter-window-bypass mpgd-filter-toolbar-bypass';
  const windowBypassInput=document.createElement('input');
  windowBypassInput.type='checkbox';
  windowBypassInput.checked=filter.bypass===true;
  windowBypassInput.dataset.filterWindowBypass='';
  windowBypassInput.setAttribute('aria-label','Bypass '+filter.id);
  const windowBypassText=document.createElement('span');
  windowBypassText.textContent='Bypass';
  windowBypass.append(windowBypassInput,windowBypassText);

  windowBypassInput.addEventListener('change',event=>{
    event.stopPropagation();
    filter.bypass=windowBypassInput.checked;
    invalidateResponseHost(filter,'bypass-change');
    renderNodes();
    renderWindow(filter,win);
    document.dispatchEvent(new CustomEvent('raptor:filterbypasschange',{
      detail:{filterId:filter.id,filterType:FILTER_TYPE,bypass:filter.bypass}
    }));
  });
  toolbar.appendChild(windowBypass);

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
    next.forEach(band=>{
      if(band.graphKind==='phase'){
        if(!(band.frequencyHz>0&&band.frequencyHz<fs/2)) throw new RangeError('Phase Lift frequencyHz must satisfy 0 < f0 < Fs/2');
        band.gainDb=clampPhaseLiftGainDeg(band.gainDb);
        band.q=Math.max(.05,Math.min(50,Number(band.q)));
        if(!Number.isFinite(band.q)) throw new RangeError('Phase Lift Q must be finite');
      }else{
        rbj.normalizeOperation(band,fs);
      }
    });
  }

  filter.bands=next;
  filter.sampleRateHz=fs||null;
  invalidateResponseHost(filter,'set-bands');
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
    if(front?._phaseTurnInspector?.getResult?.()){
      front._phaseTurnInspector.clear('escape');
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
    if(filter.input?.id&&!sourceEntry(filter)){
      filter.input=null;
      filter.sampleRateHz=null;
      invalidateResponseHost(filter,'input-missing');
    }

    const node=canvas.querySelector('.mpgd-filter-node[data-filter-id="'+filter.id+'"]');
    if(node) applyNodeLineage(node,filter);

    const win=windows.get(filter.id);
    if(win?.isConnected&&!win.hidden) applyMagnitudeLineageFill(win,filter);
  }
  requestAnimationFrame(renderConnections);
}).observe(measurementList,{childList:true,subtree:false});

function refreshCrossoverLineages(){
  if(!activeCard) return;

  let affected=false;
  for(const filter of activeFilters()){
    if(filter.input?.kind!=='filter') continue;
    affected=true;

    const entry=sourceEntry(filter);
    filter.sampleRateHz=Number(entry?.sampleRate??entry?.canonical?.sample_rate_hz)||null;
    invalidateResponseHost(filter,'crossover-lineage-change');

    const win=windows.get(filter.id);
    if(win?.isConnected&&!win.hidden) renderWindow(filter,win);
  }

  if(affected){
    renderNodes();
    requestAnimationFrame(renderConnections);
  }
}

function refreshFilterSources(event){
  if(!activeCard) return;
  const sourceId=String(event.detail?.filterId||'');
  if(!sourceId) return;
  const propagatedIds=Array.isArray(event.detail?.affectedFilterIds)
    ?new Set(event.detail.affectedFilterIds.map(id=>String(id)))
    :new Set([sourceId]);

  let affected=false;
  for(const filter of activeFilters()){
    if(filter.input?.kind!=='filter'||!propagatedIds.has(String(filter.input.id))) continue;
    affected=true;

    const entry=sourceEntry(filter);
    if(!entry){
      filter.input=null;
      filter.sampleRateHz=null;
      invalidateResponseHost(filter,'upstream-filter-missing');
      continue;
    }

    filter.sampleRateHz=Number(entry.sampleRate??entry.canonical?.sample_rate_hz)||null;
    invalidateResponseHost(filter,'upstream-filter-change');
    const win=windows.get(filter.id);
    if(win?.isConnected&&!win.hidden) renderWindow(filter,win);
  }

  if(affected){
    renderNodes();
    requestAnimationFrame(renderConnections);
  }
}

for(const eventName of [
  'raptor:crossoverfilterchange',
  'raptor:filterbypasschange',
  'raptor:filterinputchange',
  'raptor:filterdeleted',
  'raptor:crossoveroutputchange'
]){
  document.addEventListener(eventName,refreshFilterSources);
}

function refreshMagOutputSources(event){
  if(!activeCard||event.detail?.filterType!==FILTER_TYPE) return;
  const sourceId=String(event.detail?.filterId||'');
  if(!sourceId) return;

  const affectedIds=Array.isArray(event.detail?.affectedFilterIds)
    ?new Set(event.detail.affectedFilterIds.map(id=>String(id)))
    :new Set([sourceId]);

  let affected=false;
  for(const filter of activeFilters()){
    if(String(filter.id)===sourceId||!affectedIds.has(String(filter.id))) continue;
    const ref=sourceRef(filter);
    if(ref?.kind!=='filter') continue;

    const entry=sourceEntry(filter);
    filter.sampleRateHz=Number(entry?.sampleRate??entry?.canonical?.sample_rate_hz)||null;

    const node=canvas.querySelector('.mpgd-filter-node[data-filter-id="'+filter.id+'"]');
    if(node) applyNodeLineage(node,filter);

    const win=windows.get(filter.id);
    if(win?.isConnected&&!win.hidden) renderWindow(filter,win);
    affected=true;
  }

  if(affected) requestAnimationFrame(renderConnections);
}

document.addEventListener('raptor:filteroutputchange',refreshMagOutputSources);
document.addEventListener('raptor:crossoverlineagechange',refreshCrossoverLineages);

new MutationObserver(()=>requestAnimationFrame(renderConnections))
  .observe(canvas,{attributes:true,subtree:true,attributeFilter:['style']});

new MutationObserver(()=>requestAnimationFrame(renderConnections))
  .observe(measurementNode,{attributes:true,attributeFilter:['style']});

new ResizeObserver(()=>requestAnimationFrame(renderConnections)).observe(measurementNode);
canvas.addEventListener('scroll',()=>requestAnimationFrame(renderConnections),{passive:true});
document.addEventListener('raptor:pipelineobstacleschange',()=>requestAnimationFrame(renderConnections));
document.addEventListener('raptor:pipelinezoomchange',()=>requestAnimationFrame(renderConnections));

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
    invalidateResponseHost(filter,'bypass-change');
    renderNodes();
    const win=windows.get(filterId);
    if(win&&!win.hidden) renderWindow(filter,win);
    return true;
  },
  getHost(filterId){
    const filter=filterById(filterId);
    return filter?responseHostForFilter(filter):null;
  },
  getOutput(filterId){
    const filter=filterById(filterId);
    return filter?canonicalOutputForFilter(filter):null;
  },
  getLineage(filterId){
    const filter=filterById(filterId);
    return Object.freeze(filter?magLineageInfo(filter):{active:false,color:'#8FA6B8',measurementId:null});
  },
  refresh:renderNodes,
  refreshConnections:renderConnections
});
})();