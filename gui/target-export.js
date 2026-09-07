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
let activeCard=null;
let sequence=1;
let wireGroup=null;

function makeId(){
  return 'target-export-'+Date.now().toString(36)+'-'+(sequence++).toString(36);
}

function loadedCard(){
  return pipelineRow.querySelector('.pipeline-card.is-loaded')||null;
}

function ensureExports(card){
  if(!card) return [];
  const state=card._raptorLineState;
  if(!state) return [];
  if(!state.nodes) state.nodes={};
  if(!Array.isArray(state.nodes.targetExports)) state.nodes.targetExports=[];
  return state.nodes.targetExports;
}

function activeExports(){
  return activeCard?ensureExports(activeCard):[];
}

function exportById(id){
  return activeExports().find(item=>String(item.id)===String(id))||null;
}

function filterSource(id){
  const sourceId=String(id||'');
  if(!sourceId) return null;

  const xo=window.RaptorCrossoverFilter;
  const xoFilter=xo?.get?.(sourceId)||null;
  if(xoFilter){
    return {
      kind:'crossover',
      filter:xoFilter,
      canonical:xo.getOutput?.(sourceId)||null,
      lineage:xo.getLineage?.(sourceId)||null
    };
  }

  const mpgd=window.RaptorMagPhaseGdFilter;
  const mpgdFilter=mpgd?.get?.(sourceId)||null;
  if(mpgdFilter){
    return {
      kind:'mag-phase-gd',
      filter:mpgdFilter,
      canonical:mpgd.getOutput?.(sourceId)||null,
      lineage:mpgd.getLineage?.(sourceId)||null
    };
  }

  return null;
}

function sourceExists(item){
  return !!(item?.input?.id&&filterSource(item.input.id));
}

function sourceCanonical(item){
  if(!item?.input?.id) return null;
  const canonical=filterSource(item.input.id)?.canonical||null;
  if(!canonical) return null;
  try{canonicalApi.validate(canonical)}catch{return null;}
  return canonical;
}

function sourceColor(item){
  const source=item?.input?.id?filterSource(item.input.id):null;
  return source?.lineage?.color||item?.input?.color||BASE_COLOR;
}

function sourceFileName(item){
  if(!item?.input?.id) return 'Not connected';
  const source=filterSource(item.input.id);
  const measurementId=source?.lineage?.measurementId||null;
  const measurement=measurementId?api.getMeasurement?.(measurementId):null;
  if(measurement?.name) return measurement.name;
  return source?.filter?.label||source?.filter?.type||'Filter connected';
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
  const width=node?.offsetWidth||176;
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

function applyLineage(node,item){
  const connected=sourceExists(item);
  const color=sourceColor(item);
  node.classList.toggle('has-lineage',connected);
  node.style.setProperty('--lineage-color',color);
  node.style.setProperty('--lineage-tint',hexTint(color,.10));

  const fileName=node.querySelector('[data-target-export-file]');
  if(fileName){
    fileName.textContent=sourceFileName(item);
    fileName.title=sourceFileName(item);
  }

  const input=node.querySelector('.target-export-input');
  if(input){
    input.classList.toggle('is-connected',connected);
    input.style.setProperty('--port-color',color);
  }

  const button=node.querySelector('.target-export-button');
  if(button){
    const ready=!!sourceCanonical(item);
    button.disabled=!ready;
    button.title=ready?'Download current filter target as TXT':'Connect a filter with valid Canonical data first';
  }
}

function connectInput(item,source,meta={}){
  if(!item||!canAcceptSource(source)) return false;
  const sourceId=String(meta.sourceId??source.filterId??source.id??'');
  if(!sourceId) return false;

  item.input={
    kind:'filter',
    id:sourceId,
    color:meta.color||source.color||BASE_COLOR
  };
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filterinputchange',{
    detail:{
      filterId:item.id,
      filterType:TYPE,
      sourceKind:'filter',
      sourceId,
      connected:true,
      color:sourceColor(item)
    }
  }));
  return true;
}

function disconnectInput(item){
  if(!item?.input?.id) return false;
  const sourceId=item.input.id;
  item.input=null;
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filterinputchange',{
    detail:{filterId:item.id,filterType:TYPE,sourceKind:'filter',sourceId,connected:false}
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

function exportTxt(item){
  const canonical=sourceCanonical(item);
  if(!canonical) return false;
  const views=canonicalApi.views(canonical);
  const frequency=views.frequency_hz;
  const magnitude=views.magnitude_db;
  const phase=views.phase_deg;
  const coherence=views.coherence;
  const lines=[];

  const sampleRate=Number(canonical.sample_rate_hz);
  if(Number.isFinite(sampleRate)&&sampleRate>0){
    lines.push('Sample Rate: '+txtNumber(sampleRate)+' Hz');
  }
  lines.push('Frequency_Hz\tMagnitude_dB\tPhase_deg\tCoherence');

  for(let index=0;index<canonical.points;index++){
    lines.push(
      txtNumber(frequency[index])+'\t'+
      txtNumber(magnitude[index])+'\t'+
      txtNumber(phase[index])+'\t'+
      txtNumber(coherence[index])
    );
  }
  const blob=new Blob([lines.join('\n')+'\n'],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=safeStem(sourceFileName(item))+'_target.txt';
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
    requestAnimationFrame(renderConnections);
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

function buildNode(item){
  const node=document.createElement('section');
  node.className='target-export-node';
  node.dataset.filterId=item.id;
  node.dataset.filterType=TYPE;
  node.setAttribute('aria-label','Target Export');

  item.position=clampPosition(item.position||{x:8,y:8});
  workspaceView.positionNode(node,item.position.x,item.position.y);

  const input=document.createElement('button');
  input.type='button';
  input.className='target-export-input';
  input.dataset.filterInput=item.id;
  input.title='Filter input';
  input.setAttribute('aria-label','Target Export filter input');

  const head=document.createElement('header');
  head.className='target-export-head';
  const title=document.createElement('div');
  title.className='target-export-title';
  const strong=document.createElement('strong');
  strong.textContent='Target Export';
  const file=document.createElement('span');
  file.dataset.targetExportFile='';
  title.append(strong,file);
  head.appendChild(title);

  const body=document.createElement('div');
  body.className='target-export-body';
  const exportButton=document.createElement('button');
  exportButton.type='button';
  exportButton.className='target-export-button';
  exportButton.textContent='Export TXT';
  exportButton.addEventListener('click',event=>{
    event.stopPropagation();
    exportTxt(item);
  });
  body.appendChild(exportButton);

  const foot=document.createElement('footer');
  foot.className='target-export-foot';
  const remove=document.createElement('button');
  remove.type='button';
  remove.className='target-export-delete';
  remove.textContent='Delete';
  remove.addEventListener('click',event=>{
    event.stopPropagation();
    deleteExport(item.id);
  });
  foot.appendChild(remove);

  node.append(input,head,body,foot);
  node.addEventListener('pointerdown',event=>startNodeDrag(event,node,item));
  node.addEventListener('contextmenu',event=>event.stopPropagation());
  applyLineage(node,item);
  return node;
}

function removeRenderedNodes(){
  canvas.querySelectorAll('.target-export-node').forEach(node=>{
    const id=node.dataset.filterId;
    if(id) api.unregisterInput?.('target-export:'+id+':input');
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
    if(item.input?.id&&!sourceExists(item)) item.input=null;
    const node=buildNode(item);
    canvas.appendChild(node);
    const input=node.querySelector('.target-export-input');
    api.registerInput?.('target-export:'+item.id+':input',input,{
      radius:52,
      ownerFilterId:item.id,
      getCurrentSourceRef:()=>item.input?.id?{kind:'filter',id:String(item.input.id)}:null,
      canAccept:source=>canAcceptSource(source),
      onConnect:(source,meta)=>connectInput(item,source,meta)
    });
  }
  requestAnimationFrame(renderConnections);
}

function createAt(x,y){
  syncActiveCard();
  if(!activeCard) return null;
  const item={
    id:makeId(),
    type:TYPE,
    position:clampPosition({x:Number(x)-88,y:Number(y)-56}),
    input:null
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
  api.unregisterInput?.('target-export:'+id+':input');
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

function renderConnections(){
  const group=ensureWireGroup();
  group.replaceChildren();
  if(!activeCard) return;

  for(const item of activeExports()){
    if(!item.input?.id) continue;
    const source=filterHandle(item.input.id);
    const target=canvas.querySelector('.target-export-node[data-filter-id="'+CSS.escape(String(item.id))+'"] .target-export-input');
    if(!source||!target) continue;
    const start=canvasPointFor(source);
    const end=canvasPointFor(target);
    const d=api.routeWire?.(start,end,{sourceElement:source,targetElement:target})||'';
    if(!d) continue;

    const hit=document.createElementNS(SVG_NS,'path');
    hit.setAttribute('class','pipeline-persistent-wire-hit');
    hit.setAttribute('d',d);
    hit.dataset.wireId='target-export-input:'+item.id;
    hit.dataset.sourceKind='filter';
    hit.dataset.sourceId=String(item.input.id);
    hit.dataset.targetId=String(item.id);

    const path=document.createElementNS(SVG_NS,'path');
    path.setAttribute('class','pipeline-persistent-wire');
    path.setAttribute('stroke',sourceColor(item));
    path.setAttribute('d',d);

    const flow=document.createElementNS(SVG_NS,'path');
    flow.setAttribute('class','pipeline-wire-flow');
    flow.setAttribute('d',d);
    group.append(hit,path,flow);
  }
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

new MutationObserver(()=>requestAnimationFrame(renderConnections)).observe(canvas,{
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
    requestAnimationFrame(renderConnections);
  }).observe(measurementList,{childList:true,subtree:false});
}

document.addEventListener('raptor:pipelinedisconnectrequest',event=>{
  const wireId=String(event.detail?.wireId||'');
  if(!wireId.startsWith('target-export-input:')) return;
  const id=wireId.slice('target-export-input:'.length);
  const item=exportById(id);
  if(!item) return;
  if(event.detail?.sourceId&&String(event.detail.sourceId)!==String(item.input?.id||'')) return;
  disconnectInput(item);
});

document.addEventListener('raptor:filterdeleted',event=>{
  if(event.detail?.filterType===TYPE||!activeCard) return;
  const sourceId=String(event.detail?.filterId||'');
  if(!sourceId) return;
  let changed=false;
  for(const item of activeExports()){
    if(String(item.input?.id||'')!==sourceId) continue;
    item.input=null;
    changed=true;
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
    requestAnimationFrame(renderConnections);
  });
}

canvas.addEventListener('scroll',()=>requestAnimationFrame(renderConnections),{passive:true});
document.addEventListener('raptor:pipelineobstacleschange',()=>requestAnimationFrame(renderConnections));
document.addEventListener('raptor:pipelinezoomchange',()=>requestAnimationFrame(renderConnections));

syncActiveCard();

window.RaptorTargetExport=Object.freeze({
  type:TYPE,
  createAt,
  list:()=>activeExports().map(item=>({
    ...item,
    position:item.position?{...item.position}:null,
    input:item.input?{...item.input}:null
  })),
  delete:deleteExport,
  disconnectInput(id){
    const item=exportById(id);
    return item?disconnectInput(item):false;
  },
  export(id){
    const item=exportById(id);
    return item?exportTxt(item):false;
  },
  refresh:renderNodes,
  refreshConnections:renderConnections
});
})();