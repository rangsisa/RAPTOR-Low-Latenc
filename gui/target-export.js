(()=>{
'use strict';

const api=window.RaptorPipeline;
const workspaceView=window.RaptorPipelineWorkspaceView;
const canonicalApi=window.RaptorMeasurementCanonicalV1;
const canvas=document.getElementById('pipelineNodeCanvas');
const wireSvg=document.querySelector('.pipeline-wire-layer');
const pipelineRow=document.getElementById('pipelineRow');
if(!api||!workspaceView||!canonicalApi||!canvas||!wireSvg) return;

const SVG_NS='http://www.w3.org/2000/svg';
const TYPE='target-export';
const LABEL='Target Export';
const INPUT_PREFIX='target-export:';
const WIRE_PREFIX='target-export-input:';
const BASE_COLOR='#8FA6B8';
let activeCard=null;
let sequence=1;
let wireGroup=null;

function ensureStyles(){
  let link=document.querySelector('link[data-raptor-target-export-style]');
  if(link){
    link.href='./target-export.css?v=target-export-isolated-20260906-1';
    return;
  }
  link=document.createElement('link');
  link.rel='stylesheet';
  link.href='./target-export.css?v=target-export-isolated-20260906-1';
  link.dataset.raptorTargetExportStyle='true';
  document.head.appendChild(link);
}

function makeId(){
  return 'target-export-'+Date.now().toString(36)+'-'+(sequence++);
}

function resolveLoadedCard(){
  return document.querySelector('.pipeline-card.is-loaded')||null;
}

function syncActiveCard(){
  const next=resolveLoadedCard();
  if(next===activeCard) return false;
  activeCard=next;
  if(activeCard) ensureNodes(activeCard);
  return true;
}

function defaultNode(position={x:520,y:180}){
  return {
    id:makeId(),
    type:TYPE,
    label:LABEL,
    position:{
      x:Number.isFinite(position.x)?position.x:520,
      y:Number.isFinite(position.y)?position.y:180
    },
    input:null
  };
}

function cloneNode(node){
  return {
    id:String(node?.id||makeId()),
    type:TYPE,
    label:LABEL,
    position:{
      x:Number(node?.position?.x)||520,
      y:Number(node?.position?.y)||180
    },
    input:node?.input?.id?{kind:'filter',id:String(node.input.id)}:null
  };
}

function normalizeNode(node){
  if(!node||typeof node!=='object') return defaultNode();
  Object.assign(node,cloneNode(node));
  return node;
}

function ensureNodes(card){
  if(!card) return [];
  if(!card._raptorLineState) card._raptorLineState=api.createState?.()||{version:1,nodes:{}};
  if(!card._raptorLineState.nodes) card._raptorLineState.nodes={};
  if(!Array.isArray(card._raptorLineState.nodes.targetExports)){
    card._raptorLineState.nodes.targetExports=[];
  }
  const nodes=card._raptorLineState.nodes.targetExports;
  for(let i=0;i<nodes.length;i++) nodes[i]=normalizeNode(nodes[i]);
  return nodes;
}

function activeNodes(){
  return activeCard?ensureNodes(activeCard):[];
}

function nodeById(id){
  return activeNodes().find(node=>node.id===String(id))||null;
}

function sourceRef(node){
  return node?.input?.id?{kind:'filter',id:String(node.input.id)}:null;
}

function sourceMeta(filterId){
  const id=String(filterId||'');
  if(!id) return null;

  const crossover=window.RaptorCrossoverFilter||null;
  const xo=crossover?.get?.(id)||null;
  if(xo){
    return {
      id,
      label:xo.label||'Filter',
      filterType:xo.type||null,
      lineage:crossover?.getLineage?.(id)||null
    };
  }

  const mpgd=window.RaptorMagPhaseGdFilter||null;
  const mag=mpgd?.get?.(id)||null;
  if(mag){
    return {
      id,
      label:mag.label||'Mag-Phase-GD Filter',
      filterType:mag.type||'mag-phase-gd',
      lineage:mpgd?.getLineage?.(id)||null
    };
  }

  return null;
}

function sourceFileName(node){
  const ref=sourceRef(node);
  if(!ref) return 'Not connected';
  const info=sourceMeta(ref.id);
  if(!info) return 'Source unavailable';
  const measurementId=info.lineage?.measurementId||null;
  const entry=measurementId?api.getMeasurement?.(measurementId):null;
  return entry?.name||info.label||ref.id;
}

function sourceColor(node){
  const ref=sourceRef(node);
  if(!ref) return BASE_COLOR;
  return sourceMeta(ref.id)?.lineage?.color||BASE_COLOR;
}

function currentCanonical(node){
  const ref=sourceRef(node);
  if(!ref) return null;
  const id=ref.id;
  let canonical=null;
  if(window.RaptorCrossoverFilter?.get?.(id)){
    canonical=window.RaptorCrossoverFilter.getOutput?.(id)||null;
  }else if(window.RaptorMagPhaseGdFilter?.get?.(id)){
    canonical=window.RaptorMagPhaseGdFilter.getOutput?.(id)||null;
  }
  if(!canonical) return null;
  try{
    canonicalApi.validate(canonical);
    return canonical;
  }catch{
    return null;
  }
}

function sourceIdFromWire(source){
  return String(source?.filterId??source?.id??'');
}

function canAccept(node,source){
  if(!node||node.input?.id||source?.kind!=='filter') return false;
  const sourceId=sourceIdFromWire(source);
  if(!sourceId) return false;

  // Sink accepts every filter output. Floating filters are intentionally allowed;
  // if data already exists, Canonical V1 must still validate fail-closed.
  const canonical=source.canonical||null;
  if(!canonical) return true;
  try{
    canonicalApi.validate(canonical);
    return true;
  }catch{
    return false;
  }
}

function connect(node,source,meta={}){
  if(!canAccept(node,source)) return false;
  const sourceId=String(meta.sourceId??source.filterId??source.id??'');
  if(!sourceId) return false;
  node.input={kind:'filter',id:sourceId};
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filterinputchange',{
    detail:{filterId:node.id,filterType:TYPE,sourceKind:'filter',sourceId,connected:true}
  }));
  return true;
}

function sanitizeBaseName(value){
  const clean=String(value||'target')
    .replace(/\.[^.]+$/,'')
    .replace(/[^a-z0-9._-]+/gi,'_')
    .replace(/^_+|_+$/g,'');
  return clean||'target';
}

function numberText(value){
  const n=Number(value);
  if(!Number.isFinite(n)) return '0';
  return Number(n.toPrecision(12)).toString();
}

function exportTxt(node){
  const canonical=currentCanonical(node);
  if(!canonical) return false;
  try{canonicalApi.validate(canonical);}catch{return false;}
  const views=canonicalApi.views(canonical);
  const rows=new Array(canonical.points);
  for(let i=0;i<canonical.points;i++){
    rows[i]=numberText(views.frequency_hz[i])+'\t'+
      numberText(views.magnitude_db[i])+'\t'+
      numberText(views.phase_deg[i]);
  }
  const blob=new Blob([rows.join('\n')+'\n'],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=sanitizeBaseName(sourceFileName(node))+'_target.txt';
  anchor.style.display='none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
  return true;
}

function filterHandle(filterId){
  const id=String(filterId||'');
  const xo=[...canvas.querySelectorAll('.xo-filter-node')]
    .find(candidate=>candidate.dataset.filterId===id);
  if(xo) return xo.querySelector('.xo-filter-output')||null;
  const mag=[...canvas.querySelectorAll('.mpgd-filter-node')]
    .find(candidate=>candidate.dataset.filterId===id);
  return mag?.querySelector('.mpgd-filter-output')||null;
}

function canvasPointFor(element){
  if(!element) return null;
  const canvasRect=canvas.getBoundingClientRect();
  const rect=element.getBoundingClientRect();
  return {
    x:rect.left+rect.width/2-canvasRect.left+canvas.scrollLeft,
    y:rect.top+rect.height/2-canvasRect.top+canvas.scrollTop
  };
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

function renderConnections(){
  const group=ensureWireGroup();
  group.replaceChildren();
  if(!activeCard) return;

  for(const node of activeNodes()){
    const ref=sourceRef(node);
    if(!ref) continue;
    const source=filterHandle(ref.id);
    const targetNode=[...canvas.querySelectorAll('.target-export-node')]
      .find(candidate=>candidate.dataset.filterId===String(node.id));
    const target=targetNode?.querySelector('.target-export-input')||null;
    if(!source||!target) continue;
    const start=canvasPointFor(source);
    const end=canvasPointFor(target);
    if(!start||!end) continue;
    const d=api.routeWire?.(start,end,{sourceElement:source,targetElement:target})||'';
    if(!d) continue;
    const color=sourceColor(node);

    const hit=document.createElementNS(SVG_NS,'path');
    hit.setAttribute('class','pipeline-persistent-wire-hit');
    hit.setAttribute('d',d);
    hit.dataset.wireId=WIRE_PREFIX+node.id;
    hit.dataset.sourceKind='filter';
    hit.dataset.sourceId=ref.id;
    hit.dataset.targetId=node.id;

    const path=document.createElementNS(SVG_NS,'path');
    path.setAttribute('class','pipeline-persistent-wire');
    path.setAttribute('stroke',color);
    path.setAttribute('d',d);

    const flow=document.createElementNS(SVG_NS,'path');
    flow.setAttribute('class','pipeline-wire-flow');
    flow.setAttribute('stroke',color);
    flow.setAttribute('d',d);

    group.append(hit,path,flow);
  }
}

function deleteNode(nodeId){
  const nodes=activeNodes();
  const index=nodes.findIndex(node=>node.id===String(nodeId));
  if(index<0) return false;
  nodes.splice(index,1);
  api.unregisterInput?.(INPUT_PREFIX+nodeId+':input');
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filterdeleted',{
    detail:{filterId:String(nodeId),filterType:TYPE}
  }));
  return true;
}

function startDrag(event,node,element){
  if(event.button!==undefined&&event.button!==0) return;
  if(event.target.closest('button')) return;
  event.preventDefault();
  event.stopPropagation();
  element.classList.add('is-dragging');
  const start=workspaceView.clientToLogical(event.clientX,event.clientY);
  const origin={x:node.position.x,y:node.position.y};

  const move=moveEvent=>{
    const point=workspaceView.clientToLogical(moveEvent.clientX,moveEvent.clientY);
    node.position.x=Math.max(8,origin.x+(point.x-start.x));
    node.position.y=Math.max(8,origin.y+(point.y-start.y));
    workspaceView.positionNode(element,node.position.x,node.position.y);
    requestAnimationFrame(renderConnections);
    document.dispatchEvent(new CustomEvent('raptor:pipelineobstacleschange'));
  };
  const end=()=>{
    element.classList.remove('is-dragging');
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    requestAnimationFrame(renderConnections);
  };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
}

function buildNode(node){
  const element=document.createElement('section');
  element.className='target-export-node';
  element.dataset.filterId=node.id;
  element.dataset.filterType=TYPE;
  element.setAttribute('aria-label',LABEL+' node');

  const color=sourceColor(node);
  element.style.setProperty('--lineage-color',color);
  element.classList.toggle('has-lineage',!!node.input?.id);

  const input=document.createElement('button');
  input.className='target-export-input';
  input.type='button';
  input.setAttribute('aria-label','Target Export input');
  input.title='Input from filter';
  input.style.setProperty('--port-color',color);
  input.classList.toggle('is-connected',!!node.input?.id);

  const head=document.createElement('header');
  head.className='target-export-head';
  const title=document.createElement('strong');
  title.textContent=LABEL;
  const file=document.createElement('span');
  file.className='target-export-file';
  file.textContent=sourceFileName(node);
  file.title=file.textContent;
  head.append(title,file);
  head.addEventListener('pointerdown',event=>startDrag(event,node,element));

  const body=document.createElement('div');
  body.className='target-export-body';
  const exportButton=document.createElement('button');
  exportButton.className='target-export-button';
  exportButton.type='button';
  exportButton.textContent='Export TXT';
  exportButton.disabled=!currentCanonical(node);
  exportButton.title=exportButton.disabled?'Connect a filter with available data first':'Download adjusted target as TXT';
  exportButton.addEventListener('click',event=>{
    event.stopPropagation();
    exportTxt(node);
  });
  body.appendChild(exportButton);

  const foot=document.createElement('footer');
  foot.className='target-export-foot';
  const remove=document.createElement('button');
  remove.className='target-export-delete';
  remove.type='button';
  remove.textContent='Delete';
  remove.addEventListener('click',event=>{
    event.stopPropagation();
    deleteNode(node.id);
  });
  foot.appendChild(remove);

  element.append(input,head,body,foot);
  workspaceView.positionNode(element,node.position.x,node.position.y);
  return element;
}

function removeRenderedNodes(){
  canvas.querySelectorAll('.target-export-node').forEach(element=>{
    const id=element.dataset.filterId;
    if(id) api.unregisterInput?.(INPUT_PREFIX+id+':input');
    element.remove();
  });
}

function renderNodes(){
  syncActiveCard();
  removeRenderedNodes();
  if(!activeCard){
    ensureWireGroup().replaceChildren();
    return;
  }

  for(const node of activeNodes()){
    const element=buildNode(node);
    canvas.appendChild(element);
    const input=element.querySelector('.target-export-input');
    api.registerInput?.(INPUT_PREFIX+node.id+':input',input,{
      radius:58,
      ownerFilterId:node.id,
      getCurrentSourceRef:()=>sourceRef(node),
      canAccept:source=>canAccept(node,source),
      onConnect:(source,meta)=>connect(node,source,meta)
    });
  }

  requestAnimationFrame(renderConnections);
  document.dispatchEvent(new CustomEvent('raptor:pipelineobstacleschange'));
}

function createAt(x,y){
  syncActiveCard();
  if(!activeCard) return null;
  const node=defaultNode({
    x:Number.isFinite(Number(x))?Number(x):520,
    y:Number.isFinite(Number(y))?Number(y):180
  });
  ensureNodes(activeCard).push(node);
  renderNodes();
  return cloneNode(node);
}

function refreshFromSourceEvent(event){
  syncActiveCard();
  if(!activeCard) return;
  const directId=String(event?.detail?.filterId||'');
  const sourceId=String(event?.detail?.sourceId||'');

  if(directId&&event?.type==='raptor:filterdeleted'){
    let changed=false;
    for(const node of activeNodes()){
      if(node.input?.id===directId){
        node.input=null;
        changed=true;
      }
    }
    if(changed){renderNodes();return;}
  }

  const affected=new Set();
  if(directId) affected.add(directId);
  if(sourceId) affected.add(sourceId);
  for(const id of event?.detail?.affectedFilterIds||[]){
    if(id!==undefined&&id!==null) affected.add(String(id));
  }

  if(!affected.size||activeNodes().some(node=>node.input?.id&&affected.has(String(node.input.id)))){
    renderNodes();
  }
}

ensureStyles();
syncActiveCard();
renderNodes();

if(pipelineRow){
  new MutationObserver(()=>{
    const changed=syncActiveCard();
    if(changed) renderNodes();
    else requestAnimationFrame(renderConnections);
  }).observe(pipelineRow,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
}

document.addEventListener('raptor:pipelinefilterrequest',event=>{
  if(event.detail?.filterType!==TYPE) return;
  createAt(Number(event.detail.x)||520,Number(event.detail.y)||180);
});

document.addEventListener('raptor:pipelinedisconnectrequest',event=>{
  const wireId=String(event.detail?.wireId||'');
  if(!wireId.startsWith(WIRE_PREFIX)) return;
  const id=wireId.slice(WIRE_PREFIX.length);
  const node=nodeById(id);
  if(!node) return;
  node.input=null;
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:filterinputchange',{
    detail:{filterId:id,filterType:TYPE,sourceKind:null,sourceId:null,connected:false}
  }));
});

for(const eventName of [
  'raptor:crossoverfilterchange',
  'raptor:crossoveroutputchange',
  'raptor:filteroutputchange',
  'raptor:filterbypasschange',
  'raptor:filterinputchange',
  'raptor:filterdeleted'
]){
  document.addEventListener(eventName,refreshFromSourceEvent);
}

canvas.addEventListener('scroll',()=>requestAnimationFrame(renderConnections),{passive:true});
document.addEventListener('raptor:pipelinezoomchange',()=>requestAnimationFrame(renderConnections));
document.addEventListener('raptor:pipelineobstacleschange',()=>requestAnimationFrame(renderConnections));
window.addEventListener('resize',()=>requestAnimationFrame(renderConnections));

window.RaptorTargetExport=Object.freeze({
  type:TYPE,
  createAt,
  list:()=>activeNodes().map(node=>cloneNode(node)),
  get:id=>{
    const node=nodeById(id);
    return node?cloneNode(node):null;
  },
  export:id=>{
    const node=nodeById(id);
    return node?exportTxt(node):false;
  },
  delete:deleteNode,
  refresh:renderNodes
});
})();
