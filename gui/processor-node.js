(()=>{
'use strict';

const api=window.RaptorPipeline;
const canvas=document.getElementById('pipelineNodeCanvas');
const wireSvg=document.querySelector('.pipeline-wire-layer');
const previewPath=document.getElementById('pipelineWirePreview');
const measurementNode=document.getElementById('measurementNode');
const measurementList=document.getElementById('measurementList');
if(!api||!canvas||!wireSvg||!previewPath||!measurementNode||!measurementList) return;

const PORTS=[
  {id:'raptor',label:'RAPTOR Editor',exclusive:true},
  {id:'nga',label:'NGA Editor',exclusive:true},
  {id:'autoZero',label:'NGA Auto ZERO / GD Target',exclusive:true},
  {id:'bypass',label:'Bypass',exclusive:false}
];

let activeCard=null;
let processorNode=null;
let persistentGroup=null;
let previewEnd=null;
let dragSource=null;

function cloneValue(value){
  if(value instanceof ArrayBuffer) return value.slice(0);
  if(value instanceof Float64Array) return new Float64Array(value);
  if(value instanceof Float32Array) return new Float32Array(value);
  if(Array.isArray(value)) return value.map(cloneValue);
  if(value&&typeof value==='object'){
    const next={};
    for(const [key,item] of Object.entries(value)) next[key]=cloneValue(item);
    return next;
  }
  return value;
}

function blankProcessorState(){
  return {
    position:null,
    inputs:{raptor:null,nga:null,autoZero:null,bypass:[]},
    outputs:{raptor:[],nga:[],autoZero:[]}
  };
}

function ensureProcessorState(card){
  if(!card) return null;
  if(!card._raptorLineState) card._raptorLineState={version:1,nodes:{}};
  if(!card._raptorLineState.nodes) card._raptorLineState.nodes={};
  if(!card._raptorLineState.nodes.processor) card._raptorLineState.nodes.processor=blankProcessorState();
  const state=card._raptorLineState.nodes.processor;
  if(!state.inputs) state.inputs={raptor:null,nga:null,autoZero:null,bypass:[]};
  if(!Array.isArray(state.inputs.bypass)) state.inputs.bypass=[];
  if(!state.outputs) state.outputs={raptor:[],nga:[],autoZero:[]};
  for(const key of ['raptor','nga','autoZero']) if(!Array.isArray(state.outputs[key])) state.outputs[key]=[];
  if(state.position===undefined) state.position=null;
  return state;
}

function activeMeasurements(){
  return activeCard?activeCard._raptorLineState?.nodes?.measurement?.files||[]:[];
}

function measurementById(id){
  return activeMeasurements().find(file=>file.id===id)||null;
}

function makeInput(port){
  const button=document.createElement('button');
  button.className='processor-input'+(port.id==='bypass'?' processor-input-bypass':'');
  button.type='button';
  button.dataset.port=port.id;
  button.title=port.exclusive?port.label+' · 1 input max':port.label+' · unlimited inputs';
  button.setAttribute('aria-label',button.title);
  return button;
}

function makePane(port,kind){
  const pane=document.createElement('div');
  pane.className='processor-pane processor-pane-left '+kind;
  pane.dataset.portPane=port.id;
  pane.appendChild(makeInput(port));

  const label=document.createElement('div');
  label.className='processor-pane-label';

  if(port.id==='raptor'){
    label.innerHTML='<span class="processor-signal">Phase<br>Group Delay<br>Magnitude</span><strong>Editor by RAPTOR</strong>';
  }else if(port.id==='nga'){
    label.innerHTML='<span class="processor-signal">Phase<br>Group Delay<br>Magnitude</span><strong>Editor by NGA</strong>';
  }else{
    label.innerHTML='<strong>NGA</strong><span>Auto ZERO<br>GD Target</span>';
  }

  const count=document.createElement('span');
  count.className='processor-input-count';
  count.dataset.inputCount=port.id;
  pane.append(label,count);
  return pane;
}

function makeOutputPane(slot,top=false){
  const pane=document.createElement('div');
  pane.className='processor-pane processor-pane-output'+(top?' processor-output-top':'');
  pane.dataset.outputPane=slot;
  pane.innerHTML='<div class="processor-output-zone"><div class="processor-output-head"><span>OUTPUT FILES</span><span class="processor-output-count">0 files</span></div><div class="processor-output-list"><span class="processor-output-empty">No files yet</span></div></div>';
  return pane;
}

function buildNode(){
  const node=document.createElement('section');
  node.className='processor-node';
  node.id='processorNode';
  node.hidden=true;
  node.setAttribute('aria-label','RAPTOR processing node');

  node.append(
    makePane(PORTS[0],'processor-pane-raptor'),
    makeOutputPane('raptor',true),
    makePane(PORTS[1],'processor-pane-nga'),
    makeOutputPane('nga'),
    makePane(PORTS[2],'processor-pane-auto'),
    makeOutputPane('autoZero')
  );

  const bypass=document.createElement('div');
  bypass.className='processor-bypass';
  bypass.dataset.portPane='bypass';
  bypass.appendChild(makeInput(PORTS[3]));
  bypass.innerHTML+=
    '<strong class="processor-bypass-title">Bypass</strong>'+
    '<span class="processor-bypass-count" data-input-count="bypass">0 files</span>'+
    '<div class="processor-bypass-list"><span class="processor-bypass-empty">Drop any number of measurements here</span></div>';
  node.appendChild(bypass);

  canvas.appendChild(node);
  return node;
}

function ensureWireLayers(){
  persistentGroup=wireSvg.querySelector('.pipeline-persistent-wires');
  if(!persistentGroup){
    persistentGroup=document.createElementNS('http://www.w3.org/2000/svg','g');
    persistentGroup.setAttribute('class','pipeline-persistent-wires');
    wireSvg.insertBefore(persistentGroup,previewPath);
  }
  previewEnd=wireSvg.querySelector('.processor-wire-end');
  if(!previewEnd){
    previewEnd=document.createElementNS('http://www.w3.org/2000/svg','circle');
    previewEnd.setAttribute('class','pipeline-wire-end processor-wire-end');
    previewEnd.setAttribute('r','4');
    previewEnd.hidden=true;
    wireSvg.appendChild(previewEnd);
  }
}

function defaultPosition(){
  const canvasRect=canvas.getBoundingClientRect();
  const measurementRect=measurementNode.getBoundingClientRect();
  const measurementX=measurementRect.left-canvasRect.left+canvas.scrollLeft;
  const x=Math.max(330,measurementX+measurementNode.offsetWidth+92);
  const y=Math.max(14,(canvas.clientHeight-processorNode.offsetHeight)/2);
  return {x,y};
}

function applyPosition(){
  if(!activeCard||processorNode.hidden) return;
  const state=ensureProcessorState(activeCard);
  const pos=state.position&&Number.isFinite(state.position.x)&&Number.isFinite(state.position.y)
    ?state.position:defaultPosition();
  processorNode.style.left=Math.max(8,pos.x)+'px';
  processorNode.style.top=Math.max(8,pos.y)+'px';
}

function sourceColor(file){ return file?.color||'#5b6770'; }

function renderInputs(){
  if(!activeCard) return;
  const state=ensureProcessorState(activeCard);
  for(const port of PORTS){
    const button=processorNode.querySelector('.processor-input[data-port="'+port.id+'"]');
    const count=processorNode.querySelector('[data-input-count="'+port.id+'"]');
    if(port.exclusive){
      const file=measurementById(state.inputs[port.id]);
      if(state.inputs[port.id]&&!file) state.inputs[port.id]=null;
      const connected=!!file;
      button.classList.toggle('is-connected',connected);
      button.classList.toggle('is-full',connected);
      button.style.setProperty('--port-color',connected?sourceColor(file):'');
      if(count) count.textContent=connected?'1 / 1':'0 / 1';
    }else{
      const valid=[...new Set(state.inputs.bypass)].filter(id=>measurementById(id));
      state.inputs.bypass=valid;
      button.classList.toggle('is-connected',valid.length>0);
      if(count) count.textContent=valid.length+' file'+(valid.length===1?'':'s');
    }
  }
}

function renderOutputs(){
  if(!activeCard) return;
  const state=ensureProcessorState(activeCard);
  for(const slot of ['raptor','nga','autoZero']){
    const pane=processorNode.querySelector('[data-output-pane="'+slot+'"]');
    const list=pane.querySelector('.processor-output-list');
    const count=pane.querySelector('.processor-output-count');
    const outputs=state.outputs[slot];
    count.textContent=outputs.length+' file'+(outputs.length===1?'':'s');
    list.replaceChildren();
    if(!outputs.length){
      const empty=document.createElement('span');
      empty.className='processor-output-empty';
      empty.textContent='No files yet';
      list.appendChild(empty);
      continue;
    }
    for(const output of outputs){
      const row=document.createElement('div');
      row.className='processor-output-file';
      row.style.setProperty('--file-color',output.color||'#5b6770');
      row.dataset.outputId=output.id;
      const dot=document.createElement('span');
      dot.className='processor-output-dot';
      const name=document.createElement('span');
      name.className='processor-output-name';
      name.textContent=output.name||'RAPTOR output';
      const handle=document.createElement('button');
      handle.className='processor-file-output';
      handle.type='button';
      handle.style.setProperty('--file-color',output.color||'#5b6770');
      handle.setAttribute('aria-label','Connect '+name.textContent);
      handle.addEventListener('pointerdown',event=>beginWire(event,{
        kind:'processor-output',id:output.id,name:name.textContent,color:output.color||'#5b6770',slot
      },handle));
      row.append(dot,name,handle);
      list.appendChild(row);
    }
  }
}

function renderBypass(){
  if(!activeCard) return;
  const state=ensureProcessorState(activeCard);
  const list=processorNode.querySelector('.processor-bypass-list');
  list.replaceChildren();
  const files=state.inputs.bypass.map(measurementById).filter(Boolean);
  if(!files.length){
    const empty=document.createElement('span');
    empty.className='processor-bypass-empty';
    empty.textContent='Drop any number of measurements here';
    list.appendChild(empty);
    return;
  }
  for(const file of files){
    const chip=document.createElement('div');
    chip.className='processor-bypass-file';
    chip.style.setProperty('--file-color',sourceColor(file));
    const name=document.createElement('span');
    name.textContent=file.name;
    const handle=document.createElement('button');
    handle.className='processor-bypass-output';
    handle.type='button';
    handle.style.setProperty('--file-color',sourceColor(file));
    handle.setAttribute('aria-label','Bypass output '+file.name);
    handle.addEventListener('pointerdown',event=>beginWire(event,{
      kind:'bypass',id:file.id,name:file.name,color:sourceColor(file),fileId:file.id
    },handle));
    chip.append(name,handle);
    list.appendChild(chip);
  }
}

function syncOutputWidth(){
  if(!processorNode||processorNode.hidden) return;
  const referenceRow=measurementList.querySelector('.measurement-file');
  const referenceWidth=Math.max(
    180,
    Math.round(referenceRow?.getBoundingClientRect().width||measurementNode.getBoundingClientRect().width||300)
  );
  const names=[...processorNode.querySelectorAll('.processor-output-name')];
  let width=112;
  if(names.length){
    const longest=Math.max(...names.map(name=>Math.ceil(name.scrollWidth+52)));
    width=Math.max(142,Math.min(referenceWidth,longest));
  }
  processorNode.style.setProperty('--processor-output-width',width+'px');
}

function sync(){
  if(!activeCard||processorNode.hidden) return;
  renderInputs();
  renderOutputs();
  renderBypass();
  requestAnimationFrame(()=>{
    syncOutputWidth();
    applyPosition();
    renderConnections();
  });
}

function pointFor(element){
  const canvasRect=canvas.getBoundingClientRect();
  const rect=element.getBoundingClientRect();
  return {
    x:rect.left+rect.width/2-canvasRect.left+canvas.scrollLeft,
    y:rect.top+rect.height/2-canvasRect.top+canvas.scrollTop
  };
}

function measurementHandle(fileId){
  const files=activeMeasurements();
  const index=files.findIndex(file=>file.id===fileId);
  if(index<0) return null;
  const rows=[...measurementList.querySelectorAll('.measurement-file')];
  return rows[index]?.querySelector('.measurement-output')||null;
}

function curvePath(start,end){
  const dx=end.x-start.x;
  const bend=Math.max(52,Math.abs(dx)*.38);
  return 'M '+start.x+' '+start.y+' C '+(start.x+bend)+' '+start.y+', '+(end.x-bend)+' '+end.y+', '+end.x+' '+end.y;
}

function renderConnections(){
  if(!persistentGroup) return;
  persistentGroup.replaceChildren();
  if(!activeCard||processorNode.hidden) return;
  const state=ensureProcessorState(activeCard);
  const links=[];
  for(const port of ['raptor','nga','autoZero']){
    if(state.inputs[port]) links.push({fileId:state.inputs[port],port});
  }
  for(const fileId of state.inputs.bypass) links.push({fileId,port:'bypass'});

  for(const link of links){
    const file=measurementById(link.fileId);
    const source=measurementHandle(link.fileId);
    const target=processorNode.querySelector('.processor-input[data-port="'+link.port+'"]');
    if(!file||!source||!target) continue;
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('class','pipeline-persistent-wire');
    path.setAttribute('stroke',sourceColor(file));
    path.setAttribute('d',curvePath(pointFor(source),pointFor(target)));
    persistentGroup.appendChild(path);
  }
}

function canAccept(portId,source){
  if(source.kind!=='measurement'||!activeCard) return false;
  const state=ensureProcessorState(activeCard);
  if(portId==='bypass') return true;
  return !state.inputs[portId];
}

function clearPortHighlights(){
  processorNode.querySelectorAll('.processor-input').forEach(input=>{
    input.classList.remove('is-available','is-magnet');
  });
}

function eligibleInputs(source){
  return PORTS
    .filter(port=>canAccept(port.id,source))
    .map(port=>processorNode.querySelector('.processor-input[data-port="'+port.id+'"]'))
    .filter(Boolean);
}

function nearestInput(clientX,clientY,source){
  let best=null;
  for(const input of eligibleInputs(source)){
    const rect=input.getBoundingClientRect();
    const x=rect.left+rect.width/2;
    const y=rect.top+rect.height/2;
    const distance=Math.hypot(clientX-x,clientY-y);
    if(distance<=46&&(!best||distance<best.distance)) best={input,distance};
  }
  return best;
}

function connectMeasurement(source,input){
  const state=ensureProcessorState(activeCard);
  const port=input.dataset.port;
  if(!canAccept(port,source)) return false;
  if(port==='bypass'){
    if(!state.inputs.bypass.includes(source.fileId)) state.inputs.bypass.push(source.fileId);
  }else{
    state.inputs[port]=source.fileId;
  }
  sync();
  input.classList.add('is-magnet');
  setTimeout(()=>input.classList.remove('is-magnet'),110);
  return true;
}

function beginWire(event,source,handle){
  if(event.button!==undefined&&event.button!==0) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  ensureWireLayers();
  dragSource=source;
  const pointerId=event.pointerId;
  const start=pointFor(handle);
  previewPath.setAttribute('stroke',source.color||'#5b6770');
  previewEnd.setAttribute('fill',source.color||'#5b6770');
  previewEnd.hidden=false;

  clearPortHighlights();
  for(const input of eligibleInputs(source)) input.classList.add('is-available');
  try{handle.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    clearPortHighlights();
    for(const input of eligibleInputs(source)) input.classList.add('is-available');

    const magnet=nearestInput(moveEvent.clientX,moveEvent.clientY,source);
    let end={
      x:moveEvent.clientX-canvas.getBoundingClientRect().left+canvas.scrollLeft,
      y:moveEvent.clientY-canvas.getBoundingClientRect().top+canvas.scrollTop
    };
    if(magnet){
      magnet.input.classList.add('is-magnet');
      end=pointFor(magnet.input);
    }
    previewPath.setAttribute('d',curvePath(start,end));
    previewEnd.setAttribute('cx',end.x);
    previewEnd.setAttribute('cy',end.y);
  };

  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    const magnet=nearestInput(endEvent.clientX,endEvent.clientY,source);
    if(magnet) connectMeasurement(source,magnet.input);
    previewPath.removeAttribute('d');
    previewEnd.hidden=true;
    clearPortHighlights();
    dragSource=null;
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    try{if(handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)}catch{}
  };

  move(event);
  window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
}

function sourceFromMeasurementHandle(handle){
  const rows=[...measurementList.querySelectorAll('.measurement-file')];
  const row=handle.closest('.measurement-file');
  const index=rows.indexOf(row);
  const file=activeMeasurements()[index];
  if(!file||file.status!=='ready') return null;
  return {kind:'measurement',id:file.id,fileId:file.id,name:file.name,color:sourceColor(file)};
}

function startNodeDrag(event){
  if(!activeCard||processorNode.hidden) return;
  if(event.button!==undefined&&event.button!==0) return;
  if(event.target.closest('button,.processor-output-file,.processor-bypass-file')) return;
  event.preventDefault();

  const pointerId=event.pointerId;
  const canvasRect=canvas.getBoundingClientRect();
  const nodeRect=processorNode.getBoundingClientRect();
  const grabX=event.clientX-nodeRect.left;
  const grabY=event.clientY-nodeRect.top;
  processorNode.classList.add('is-dragging');
  try{processorNode.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    const x=Math.max(8,moveEvent.clientX-canvasRect.left+canvas.scrollLeft-grabX);
    const y=Math.max(8,moveEvent.clientY-canvasRect.top+canvas.scrollTop-grabY);
    processorNode.style.left=x+'px';
    processorNode.style.top=y+'px';
    ensureProcessorState(activeCard).position={x,y};
    renderConnections();
  };
  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    processorNode.classList.remove('is-dragging');
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    try{if(processorNode.hasPointerCapture(pointerId)) processorNode.releasePointerCapture(pointerId)}catch{}
  };

  window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
}

function loadCard(card){
  activeCard=card;
  ensureProcessorState(card);
  processorNode.hidden=false;
  requestAnimationFrame(sync);
}

function clearCard(card){
  if(card===activeCard){
    activeCard=null;
    processorNode.hidden=true;
    persistentGroup?.replaceChildren();
    clearPortHighlights();
  }
}

function addOutput(slot,file){
  if(!activeCard||!['raptor','nga','autoZero'].includes(slot)) return {ok:false,reason:'No active processor slot'};
  const state=ensureProcessorState(activeCard);
  const entry={
    id:file?.id||('processor-output-'+Date.now()+'-'+Math.random().toString(36).slice(2,7)),
    name:file?.name||'RAPTOR output',
    color:file?.color||'#5b6770',
    artifact:file?.artifact!==undefined?file.artifact:null
  };
  state.outputs[slot].push(entry);
  renderOutputs();
  requestAnimationFrame(()=>{
    syncOutputWidth();
    renderConnections();
  });
  return {ok:true,entry};
}

processorNode=buildNode();
ensureWireLayers();
processorNode.addEventListener('pointerdown',startNodeDrag);

const baseCreate=api.createState?.bind(api);
if(baseCreate){
  api.createState=()=>{
    const state=baseCreate();
    if(!state.nodes) state.nodes={};
    state.nodes.processor=blankProcessorState();
    return state;
  };
}

const baseClone=api.cloneState?.bind(api);
if(baseClone){
  api.cloneState=state=>{
    const clone=baseClone(state);
    if(!clone.nodes) clone.nodes={};
    clone.nodes.processor=state?.nodes?.processor?cloneValue(state.nodes.processor):blankProcessorState();
    return clone;
  };
}

const baseLoad=api.load?.bind(api);
if(baseLoad){
  api.load=card=>{
    baseLoad(card);
    loadCard(card);
  };
}

const baseDelete=api.onDelete?.bind(api);
if(baseDelete){
  api.onDelete=card=>{
    clearCard(card);
    baseDelete(card);
  };
}

document.addEventListener('pointerdown',event=>{
  const handle=event.target.closest('.measurement-output');
  if(!handle||!activeCard||processorNode.hidden) return;
  const source=sourceFromMeasurementHandle(handle);
  if(source) beginWire(event,source,handle);
},true);

new MutationObserver(()=>sync()).observe(measurementList,{childList:true,subtree:false});
new MutationObserver(()=>requestAnimationFrame(renderConnections)).observe(measurementNode,{attributes:true,attributeFilter:['style']});
new ResizeObserver(()=>requestAnimationFrame(()=>{
  syncOutputWidth();
  renderConnections();
})).observe(measurementNode);
new ResizeObserver(()=>requestAnimationFrame(renderConnections)).observe(processorNode);
canvas.addEventListener('scroll',()=>requestAnimationFrame(renderConnections),{passive:true});

window.RaptorProcessorNode={
  addOutput,
  refresh:sync,
  refreshConnections:renderConnections,
  getActiveState:()=>activeCard?ensureProcessorState(activeCard):null,
  resetPosition(){
    if(!activeCard) return;
    ensureProcessorState(activeCard).position=null;
    applyPosition();
    renderConnections();
  }
};
})();
