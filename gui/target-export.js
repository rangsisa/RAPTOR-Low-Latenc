(()=>{
'use strict';

const api=window.RaptorPipeline;
const workspaceView=window.RaptorPipelineWorkspaceView;
const canonicalApi=window.RaptorMeasurementCanonicalV1;
const canvas=document.getElementById('pipelineNodeCanvas');
const wireSvg=document.querySelector('.pipeline-wire-layer');
const pipelineRow=document.getElementById('pipelineRow');
const measurementList=document.getElementById('measurementList');
if(!api||!workspaceView||!canonicalApi||!canvas||!wireSvg||!pipelineRow) return;

const SVG_NS='http://www.w3.org/2000/svg';
const TYPE='target-export';
const BASE_COLOR='#8FA6B8';
const ROLES=Object.freeze([
  Object.freeze({key:'phaseInput',role:'phase',label:'Phase'}),
  Object.freeze({key:'magnitudeInput',role:'magnitude',label:'Magnitude'})
]);
let activeCard=null;
let sequence=1;
let wireGroup=null;
let connectionsFrame=0;

function makeId(){
  return 'target-export-'+Date.now().toString(36)+'-'+(sequence++).toString(36);
}

function loadedCard(){
  return pipelineRow.querySelector('.pipeline-card.is-loaded')||null;
}

function normalizeItem(item){
  if(!item) return item;
  const hasDual=Object.prototype.hasOwnProperty.call(item,'phaseInput')||
    Object.prototype.hasOwnProperty.call(item,'magnitudeInput');
  if(!hasDual){
    const legacy=item.input?.id?{...item.input}:null;
    item.phaseInput=legacy?{...legacy}:null;
    item.magnitudeInput=legacy?{...legacy}:null;
  }else{
    if(!item.phaseInput?.id) item.phaseInput=null;
    if(!item.magnitudeInput?.id) item.magnitudeInput=null;
  }
  if(Object.prototype.hasOwnProperty.call(item,'input')) delete item.input;
  return item;
}

function ensureExports(card){
  if(!card) return [];
  const state=card._raptorLineState;
  if(!state) return [];
  if(!state.nodes) state.nodes={};
  if(!Array.isArray(state.nodes.targetExports)) state.nodes.targetExports=[];
  for(const item of state.nodes.targetExports) normalizeItem(item);
  return state.nodes.targetExports;
}

function activeExports(){
  return activeCard?ensureExports(activeCard):[];
}

function exportById(id){
  return activeExports().find(item=>String(item.id)===String(id))||null;
}

function roleSpec(role){
  return ROLES.find(item=>item.role===role)||null;
}

function inputRef(item,role){
  const spec=roleSpec(role);
  if(!spec) return null;
  normalizeItem(item);
  return item?.[spec.key]||null;
}

function setInputRef(item,role,value){
  const spec=roleSpec(role);
  if(!spec||!item) return false;
  normalizeItem(item);
  item[spec.key]=value?.id?value:null;
  return true;
}

function filterSource(id,includeCanonical=false){
  const sourceId=String(id||'');
  if(!sourceId) return null;

  const xo=window.RaptorCrossoverFilter;
  const xoFilter=xo?.get?.(sourceId)||null;
  if(xoFilter){
    return {
      kind:'crossover',
      filter:xoFilter,
      canonical:includeCanonical?(xo.getOutput?.(sourceId)||null):null,
      lineage:xo.getLineage?.(sourceId)||null
    };
  }

  const mpgd=window.RaptorMagPhaseGdFilter;
  const mpgdFilter=mpgd?.get?.(sourceId)||null;
  if(mpgdFilter){
    return {
      kind:'mag-phase-gd',
      filter:mpgdFilter,
      canonical:includeCanonical?(mpgd.getOutput?.(sourceId)||null):null,
      lineage:mpgd.getLineage?.(sourceId)||null
    };
  }

  return null;
}

function sourceForRole(item,role,includeCanonical=false){
  const ref=inputRef(item,role);
  return ref?.id?filterSource(ref.id,includeCanonical):null;
}

function sourceExists(item,role){
  return !!sourceForRole(item,role);
}

function sourceCanonical(item,role,source=undefined){
  const resolved=source===undefined?sourceForRole(item,role,true):source;
  const canonical=resolved?.canonical||null;
  if(!canonical) return null;
  try{canonicalApi.validate(canonical)}catch{return null;}
  return canonical;
}

function sourceColor(item,role,source=null){
  const ref=inputRef(item,role);
  const resolved=source||sourceForRole(item,role);
  return resolved?.lineage?.color||ref?.color||BASE_COLOR;
}

function sourceFileName(item,role,source=null){
  const ref=inputRef(item,role);
  if(!ref?.id) return 'Not connected';
  const resolved=source||sourceForRole(item,role);
  const measurementId=resolved?.lineage?.measurementId||null;
  const measurement=measurementId?api.getMeasurement?.(measurementId):null;
  if(measurement?.name) return measurement.name;
  return resolved?.filter?.label||resolved?.filter?.type||'Filter connected';
}

function canAcceptSource(source){
  if(!source||source.kind!=='filter') return false;
  const sourceId=String(source.filterId??source.id??'');
  if(!sourceId) return false;
  const canonical=source.canonical||null;
  if(canonical){
    try{canonicalApi.validate(canonical)}catch{return false;}
  }
  const format=source.format||canonical?.format||null;
  return !format||format===canonicalApi.FORMAT;
}

function clampPosition(position,node=null){
  const width=node?.offsetWidth||194;
  const maxX=Math.max(8,workspaceView.logicalScrollWidth()-width-12);
  return {
    x:Math.max(8,Math.min(maxX,Number(position?.x)||8)),
    y:Math.max(8,Number(position?.y)||8)
  };
}

function hexTint(hex,alpha=.10){
  const value=String(hex||'').replace('#','');
  const full=value.length===3?value.split('').map(char=>char+char).join(''):value;
  if(!/^[0-9a-f]{6}$/i.test(full)) return 'rgba(143,166,184,'+alpha+')';
  const n=parseInt(full,16);
  return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+alpha+')';
}

function compatibleFrequency(a,b){
  if(a.length!==b.length) return false;
  for(let index=0;index<a.length;index++){
    const av=Number(a[index]);
    const bv=Number(b[index]);
    const scale=Math.max(1,Math.abs(av),Math.abs(bv));
    if(Math.abs(av-bv)>scale*1e-9) return false;
  }
  return true;
}

function combinedTarget(item){
  // Canonical arrays are materialized only for an explicit export/readback.
  // Routine node and wire refreshes use metadata and never run filter DSP.
  const phaseSource=sourceForRole(item,'phase',true);
  const magnitudeSource=sourceForRole(item,'magnitude',true);
  const phaseCanonical=sourceCanonical(item,'phase',phaseSource);
  const magnitudeCanonical=sourceCanonical(item,'magnitude',magnitudeSource);
  if(!phaseCanonical||!magnitudeCanonical){
    return {ready:false,reason:'Connect valid Phase and Magnitude filter inputs first'};
  }
  if(phaseCanonical.points!==magnitudeCanonical.points){
    return {ready:false,reason:'Phase and Magnitude targets must use the same frequency grid'};
  }

  const phaseViews=canonicalApi.views(phaseCanonical);
  const magnitudeViews=canonicalApi.views(magnitudeCanonical);
  if(!compatibleFrequency(phaseViews.frequency_hz,magnitudeViews.frequency_hz)){
    return {ready:false,reason:'Phase and Magnitude targets must use the same frequency grid'};
  }

  const phaseSampleRate=Number(phaseCanonical.sample_rate_hz);
  const magnitudeSampleRate=Number(magnitudeCanonical.sample_rate_hz);
  const phaseHasRate=Number.isFinite(phaseSampleRate)&&phaseSampleRate>0;
  const magnitudeHasRate=Number.isFinite(magnitudeSampleRate)&&magnitudeSampleRate>0;
  if(phaseHasRate&&magnitudeHasRate){
    const scale=Math.max(1,Math.abs(phaseSampleRate),Math.abs(magnitudeSampleRate));
    if(Math.abs(phaseSampleRate-magnitudeSampleRate)>scale*1e-9){
      return {ready:false,reason:'Phase and Magnitude targets have different Sample Rates'};
    }
  }

  return {
    ready:true,
    reason:'',
    points:phaseCanonical.points,
    sampleRate:phaseHasRate?phaseSampleRate:(magnitudeHasRate?magnitudeSampleRate:null),
    frequency:phaseViews.frequency_hz,
    magnitude:magnitudeViews.magnitude_db,
    phase:phaseViews.phase_deg,
    phaseCoherence:phaseViews.coherence,
    magnitudeCoherence:magnitudeViews.coherence
  };
}

function applyLineage(node,item){
  normalizeItem(item);
  const sources={
    phase:sourceForRole(item,'phase'),
    magnitude:sourceForRole(item,'magnitude')
  };
  const phaseConnected=!!sources.phase;
  const magnitudeConnected=!!sources.magnitude;
  const phaseColor=sourceColor(item,'phase',sources.phase);
  const magnitudeColor=sourceColor(item,'magnitude',sources.magnitude);
  const anyConnected=phaseConnected||magnitudeConnected;
  const split=phaseConnected&&magnitudeConnected&&phaseColor!==magnitudeColor;
  const lineageColor=phaseConnected?phaseColor:(magnitudeConnected?magnitudeColor:BASE_COLOR);

  node.classList.toggle('has-lineage',anyConnected);
  node.classList.toggle('has-split-lineage',split);
  node.style.setProperty('--lineage-color',lineageColor);
  node.style.setProperty('--lineage-tint',hexTint(lineageColor,.10));

  for(const spec of ROLES){
    const source=sources[spec.role];
    const color=sourceColor(item,spec.role,source);
    const connected=!!source;
    const fileName=sourceFileName(item,spec.role,source);
    const file=node.querySelector('[data-target-export-file="'+spec.role+'"]');
    if(file){
      file.textContent=fileName;
      file.title=fileName;
      file.style.setProperty('--source-color',color);
    }
    const row=node.querySelector('.target-export-source-row[data-input-role="'+spec.role+'"]');
    row?.style.setProperty('--source-color',color);
    const input=node.querySelector('.target-export-input[data-input-role="'+spec.role+'"]');
    if(input){
      input.classList.toggle('is-connected',connected);
      input.style.setProperty('--port-color',color);
      input.style.setProperty('--port-tint',hexTint(color,.12));
    }
  }

  const button=node.querySelector('.target-export-button');
  if(button){
    const ready=phaseConnected&&magnitudeConnected&&
      sources.phase?.lineage?.active===true&&sources.magnitude?.lineage?.active===true;
    button.disabled=!ready;
    button.title=ready
      ?'Download combined Phase + Magnitude target as TXT'
      :'Connect valid Phase and Magnitude filter inputs first';
  }
}

function connectInput(item,role,source,meta={}){
  if(!item||!roleSpec(role)||!canAcceptSource(source)) return false;
  const sourceId=String(meta.sourceId??source.filterId??source.id??'');
  if(!sourceId) return false;

  setInputRef(item,role,{
    kind:'filter',
    id:sourceId,
    color:meta.color||source.color||BASE_COLOR
  });
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filterinputchange',{
    detail:{
      filterId:item.id,
      filterType:TYPE,
      inputRole:role,
      sourceKind:'filter',
      sourceId,
      connected:true,
      color:sourceColor(item,role)
    }
  }));
  return true;
}

function disconnectInput(item,role){
  const ref=inputRef(item,role);
  if(!ref?.id) return false;
  const sourceId=ref.id;
  setInputRef(item,role,null);
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filterinputchange',{
    detail:{filterId:item.id,filterType:TYPE,inputRole:role,sourceKind:'filter',sourceId,connected:false}
  }));
  return true;
}

function txtNumber(value){
  const number=Number(value);
  return Number.isFinite(number)?String(number):'0';
}

function safeStem(name){
  const raw=String(name||'target').replace(/\.[^.]+$/,'');
  const cleaned=raw.replace(/[\\/:*?"<>|]+/g,'_').trim();
  return cleaned||'target';
}

function exportFileStem(item){
  const phaseName=safeStem(sourceFileName(item,'phase'));
  const magnitudeName=safeStem(sourceFileName(item,'magnitude'));
  if(phaseName===magnitudeName) return phaseName;
  return phaseName+'__'+magnitudeName;
}

function exportTxt(item){
  const combined=combinedTarget(item);
  if(!combined.ready){
    window.alert?.(combined.reason);
    return false;
  }
  const lines=[];

  if(Number.isFinite(combined.sampleRate)&&combined.sampleRate>0){
    lines.push('Sample Rate: '+txtNumber(combined.sampleRate)+' Hz');
  }
  lines.push('Frequency_Hz\tMagnitude_dB\tPhase_deg\tCoherence');

  for(let index=0;index<combined.points;index++){
    const coherence=Math.min(
      Number(combined.phaseCoherence[index]),
      Number(combined.magnitudeCoherence[index])
    );
    lines.push(
      txtNumber(combined.frequency[index])+'\t'+
      txtNumber(combined.magnitude[index])+'\t'+
      txtNumber(combined.phase[index])+'\t'+
      txtNumber(coherence)
    );
  }
  const blob=new Blob([lines.join('\n')+'\n'],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=exportFileStem(item)+'_target.txt';
  anchor.style.display='none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
  return true;
}

function startNodeDrag(event,node,item){
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
    item.position=clampPosition({x:point.x-grab.x,y:point.y-grab.y},node);
    workspaceView.positionNode(node,item.position.x,item.position.y);
    scheduleConnections();
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

function buildInput(role,label){
  const input=document.createElement('button');
  input.type='button';
  input.className='target-export-input target-export-input--'+role;
  input.dataset.inputRole=role;
  input.title=label+' filter input';
  input.setAttribute('aria-label','Target Export '+label+' filter input');
  return input;
}

function buildSourceRow(role,label){
  const row=document.createElement('div');
  row.className='target-export-source-row';
  row.dataset.inputRole=role;
  const roleLabel=document.createElement('strong');
  roleLabel.textContent=label;
  const file=document.createElement('span');
  file.dataset.targetExportFile=role;
  row.append(roleLabel,file);
  return row;
}

function buildNode(item){
  normalizeItem(item);
  const node=document.createElement('section');
  node.className='target-export-node';
  node.dataset.filterId=item.id;
  node.dataset.filterType=TYPE;
  node.setAttribute('aria-label','Target Export');

  item.position=clampPosition(item.position||{x:8,y:8});
  workspaceView.positionNode(node,item.position.x,item.position.y);

  const phaseInput=buildInput('phase','Phase');
  const magnitudeInput=buildInput('magnitude','Magnitude');

  const head=document.createElement('header');
  head.className='target-export-head';
  const title=document.createElement('div');
  title.className='target-export-title';
  const strong=document.createElement('strong');
  strong.textContent='Target Export';
  const subtitle=document.createElement('span');
  subtitle.textContent='Phase + Magnitude';
  title.append(strong,subtitle);
  head.appendChild(title);

  const body=document.createElement('div');
  body.className='target-export-body';
  body.append(
    buildSourceRow('phase','Phase'),
    buildSourceRow('magnitude','Magnitude')
  );

  const foot=document.createElement('footer');
  foot.className='target-export-foot';
  const exportButton=document.createElement('button');
  exportButton.type='button';
  exportButton.className='target-export-button';
  exportButton.textContent='Export TXT';
  exportButton.addEventListener('click',event=>{
    event.stopPropagation();
    exportTxt(item);
  });
  const remove=document.createElement('button');
  remove.type='button';
  remove.className='target-export-delete';
  remove.textContent='Delete';
  remove.addEventListener('click',event=>{
    event.stopPropagation();
    deleteExport(item.id);
  });
  foot.append(exportButton,remove);

  node.append(phaseInput,magnitudeInput,head,body,foot);
  node.addEventListener('pointerdown',event=>startNodeDrag(event,node,item));
  node.addEventListener('contextmenu',event=>event.stopPropagation());
  applyLineage(node,item);
  return node;
}

function inputRegistryId(itemId,role){
  return 'target-export:'+itemId+':'+role;
}

function removeRenderedNodes(){
  canvas.querySelectorAll('.target-export-node').forEach(node=>{
    const id=node.dataset.filterId;
    if(id){
      for(const spec of ROLES) api.unregisterInput?.(inputRegistryId(id,spec.role));
    }
    node.remove();
  });
}

function renderNodes(){
  removeRenderedNodes();
  if(!activeCard){
    ensureWireGroup().replaceChildren();
    return;
  }

  for(const item of activeExports()){
    normalizeItem(item);
    for(const spec of ROLES){
      const ref=inputRef(item,spec.role);
      if(ref?.id&&!sourceExists(item,spec.role)) setInputRef(item,spec.role,null);
    }
    const node=buildNode(item);
    canvas.appendChild(node);

    for(const spec of ROLES){
      const input=node.querySelector('.target-export-input[data-input-role="'+spec.role+'"]');
      api.registerInput?.(inputRegistryId(item.id,spec.role),input,{
        radius:48,
        ownerFilterId:item.id,
        getCurrentSourceRef:()=>{
          const ref=inputRef(item,spec.role);
          return ref?.id?{kind:'filter',id:String(ref.id)}:null;
        },
        canAccept:source=>canAcceptSource(source),
        onConnect:(source,meta)=>connectInput(item,spec.role,source,meta)
      });
    }
  }
  scheduleConnections();
}

function createAt(x,y,{placement='center'}={}){
  syncActiveCard();
  if(!activeCard) return null;
  const position=placement==='input'
    ?{x:Number(x),y:Number(y)-56}
    :{x:Number(x)-97,y:Number(y)-71};
  const item={
    id:makeId(),
    type:TYPE,
    position:clampPosition(position),
    phaseInput:null,
    magnitudeInput:null
  };
  ensureExports(activeCard).push(item);
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filtercreated',{
    detail:{
      lineId:activeCard.dataset.lineId||null,
      filterId:item.id,
      filterType:TYPE,
      x:item.position.x,
      y:item.position.y
    }
  }));
  return item;
}

function deleteExport(id){
  if(!activeCard) return false;
  const items=ensureExports(activeCard);
  const index=items.findIndex(item=>String(item.id)===String(id));
  if(index<0) return false;
  items.splice(index,1);
  for(const spec of ROLES) api.unregisterInput?.(inputRegistryId(id,spec.role));
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filterdeleted',{
    detail:{filterId:String(id),filterType:TYPE}
  }));
  return true;
}

function ensureWireGroup(){
  if(wireGroup?.isConnected) return wireGroup;
  wireGroup=wireSvg.querySelector('.target-export-persistent-wires');
  if(!wireGroup){
    wireGroup=document.createElementNS(SVG_NS,'g');
    wireGroup.setAttribute('class','pipeline-persistent-wires target-export-persistent-wires');
    const preview=document.getElementById('pipelineWirePreview');
    if(preview) wireSvg.insertBefore(wireGroup,preview);
    else wireSvg.appendChild(wireGroup);
  }
  return wireGroup;
}

function filterHandle(id){
  const sourceId=String(id||'');
  const xo=canvas.querySelector('.xo-filter-node[data-filter-id="'+CSS.escape(sourceId)+'"] .xo-filter-output');
  if(xo) return xo;
  return canvas.querySelector('.mpgd-filter-node[data-filter-id="'+CSS.escape(sourceId)+'"] .mpgd-filter-output');
}

function canvasPointFor(element){
  const canvasRect=canvas.getBoundingClientRect();
  const rect=element.getBoundingClientRect();
  return {
    x:rect.left+rect.width/2-canvasRect.left+canvas.scrollLeft,
    y:rect.top+rect.height/2-canvasRect.top+canvas.scrollTop
  };
}

function appendConnection(group,item,role){
  const ref=inputRef(item,role);
  if(!ref?.id) return;
  const source=filterHandle(ref.id);
  const target=canvas.querySelector(
    '.target-export-node[data-filter-id="'+CSS.escape(String(item.id))+'"] .target-export-input[data-input-role="'+role+'"]'
  );
  if(!source||!target) return;

  const start=canvasPointFor(source);
  const end=canvasPointFor(target);
  const d=api.routeWire?.(start,end,{sourceElement:source,targetElement:target})||'';
  if(!d) return;

  const wireId='target-export-input:'+item.id+':'+role;
  const hit=document.createElementNS(SVG_NS,'path');
  hit.setAttribute('class','pipeline-persistent-wire-hit');
  hit.setAttribute('d',d);
  hit.dataset.wireId=wireId;
  hit.dataset.sourceKind='filter';
  hit.dataset.sourceId=String(ref.id);
  hit.dataset.targetId=String(item.id);
  hit.dataset.inputRole=role;

  const path=document.createElementNS(SVG_NS,'path');
  path.setAttribute('class','pipeline-persistent-wire');
  path.setAttribute('stroke',sourceColor(item,role));
  path.setAttribute('d',d);

  const flow=document.createElementNS(SVG_NS,'path');
  flow.setAttribute('class','pipeline-wire-flow');
  flow.setAttribute('d',d);
  group.append(hit,path,flow);
}

function renderConnections(){
  const group=ensureWireGroup();
  group.replaceChildren();
  if(!activeCard) return;
  for(const item of activeExports()){
    appendConnection(group,item,'phase');
    appendConnection(group,item,'magnitude');
  }
}

function scheduleConnections(){
  if(connectionsFrame) return;
  connectionsFrame=requestAnimationFrame(()=>{
    connectionsFrame=0;
    renderConnections();
  });
}

function syncActiveCard(){
  const next=loadedCard();
  if(next===activeCard) return;
  activeCard=next;
  if(activeCard) ensureExports(activeCard);
  renderNodes();
}

new MutationObserver(()=>syncActiveCard()).observe(pipelineRow,{
  childList:true,
  subtree:true,
  attributes:true,
  attributeFilter:['class']
});

new MutationObserver(scheduleConnections).observe(canvas,{
  attributes:true,
  subtree:true,
  attributeFilter:['style']
});

if(measurementList){
  new MutationObserver(()=>{
    if(!activeCard) return;
    for(const item of activeExports()){
      const node=canvas.querySelector('.target-export-node[data-filter-id="'+CSS.escape(String(item.id))+'"]');
      if(node) applyLineage(node,item);
    }
    scheduleConnections();
  }).observe(measurementList,{childList:true,subtree:false});
}

document.addEventListener('raptor:pipelinedisconnectrequest',event=>{
  const wireId=String(event.detail?.wireId||'');
  const prefix='target-export-input:';
  if(!wireId.startsWith(prefix)) return;
  const rest=wireId.slice(prefix.length);
  const separator=rest.lastIndexOf(':');
  if(separator<=0) return;
  const id=rest.slice(0,separator);
  const role=rest.slice(separator+1);
  if(!roleSpec(role)) return;
  const item=exportById(id);
  if(!item) return;
  const ref=inputRef(item,role);
  if(event.detail?.sourceId&&String(event.detail.sourceId)!==String(ref?.id||'')) return;
  disconnectInput(item,role);
});

document.addEventListener('raptor:filterdeleted',event=>{
  if(event.detail?.filterType===TYPE||!activeCard) return;
  const sourceId=String(event.detail?.filterId||'');
  if(!sourceId) return;
  let changed=false;
  for(const item of activeExports()){
    for(const spec of ROLES){
      const ref=inputRef(item,spec.role);
      if(String(ref?.id||'')!==sourceId) continue;
      setInputRef(item,spec.role,null);
      changed=true;
    }
  }
  if(changed) renderNodes();
});

for(const eventName of [
  'raptor:filteroutputchange',
  'raptor:crossoveroutputchange',
  'raptor:filterinputchange',
  'raptor:filterbypasschange',
  'raptor:crossoverlineagechange'
]){
  document.addEventListener(eventName,()=>{
    if(!activeCard) return;
    for(const item of activeExports()){
      const node=canvas.querySelector('.target-export-node[data-filter-id="'+CSS.escape(String(item.id))+'"]');
      if(node) applyLineage(node,item);
    }
    scheduleConnections();
  });
}

canvas.addEventListener('scroll',scheduleConnections,{passive:true});
document.addEventListener('raptor:pipelineobstacleschange',scheduleConnections);
document.addEventListener('raptor:pipelinezoomchange',scheduleConnections);

syncActiveCard();

window.RaptorTargetExport=Object.freeze({
  type:TYPE,
  createAt,
  list:()=>activeExports().map(item=>({
    ...item,
    position:item.position?{...item.position}:null,
    phaseInput:item.phaseInput?{...item.phaseInput}:null,
    magnitudeInput:item.magnitudeInput?{...item.magnitudeInput}:null
  })),
  delete:deleteExport,
  disconnectInput(id,role){
    const item=exportById(id);
    return item?disconnectInput(item,role):false;
  },
  export(id){
    const item=exportById(id);
    return item?exportTxt(item):false;
  },
  getCombinedTarget(id){
    const item=exportById(id);
    return item?combinedTarget(item):{ready:false,reason:'Target Export node not found'};
  },
  refresh:renderNodes,
  refreshConnections:renderConnections
});
})();
