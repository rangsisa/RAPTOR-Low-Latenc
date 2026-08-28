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
  {id:'raptor',label:'RAPTOR Editor',toolId:'raptor-editor',exclusive:true},
  {id:'nga',label:'NGA Editor',toolId:'nga-editor',exclusive:true},
  {id:'autoZero',label:'NGA Auto ZERO / GD Target',toolId:'nga-auto-zero',exclusive:true}
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
    inputs:{raptor:null,nga:null,autoZero:null},
    outputs:{raptor:[],nga:[],autoZero:[]}
  };
}

function ensureProcessorState(card){
  if(!card) return null;
  if(!card._raptorLineState) card._raptorLineState={version:1,nodes:{}};
  if(!card._raptorLineState.nodes) card._raptorLineState.nodes={};
  if(!card._raptorLineState.nodes.processor) card._raptorLineState.nodes.processor=blankProcessorState();
  const state=card._raptorLineState.nodes.processor;
  if(!state.inputs) state.inputs={raptor:null,nga:null,autoZero:null};
  // Bypass was removed from Node 2. Drop legacy bypass state without touching other slots.
  if(Object.prototype.hasOwnProperty.call(state.inputs,'bypass')) delete state.inputs.bypass;
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
  button.className='processor-input';
  button.type='button';
  button.dataset.port=port.id;
  button.title=port.label+' · 1 input max';
  button.setAttribute('aria-label',button.title);
  button.addEventListener('pointerdown',event=>beginInputDetach(event,button));
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

  const openTool=document.createElement('button');
  openTool.className='processor-open-tool';
  openTool.type='button';
  openTool.dataset.tool=port.toolId;
  openTool.title='Open '+port.label;
  openTool.setAttribute('aria-label','Open '+port.label);
  openTool.innerHTML='<span aria-hidden="true"></span>';
  openTool.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();

    const state=activeCard?ensureProcessorState(activeCard):null;
    const fileId=state?.inputs?.[port.id]||null;
    const file=fileId?measurementById(fileId):null;

    window.RaptorWorkspace?.openTool?.(port.toolId,{
      source:'processor-node',
      slot:port.id,
      lineId:activeCard?.dataset.lineId||null,
      lineName:activeCard?.dataset.lineName||'',
      fileId:file?.id||null,
      fileName:file?.name||''
    });
  });

  const count=document.createElement('span');
  count.className='processor-input-count';
  count.dataset.inputCount=port.id;
  pane.append(label,openTool,count);
  return pane;
}

function makeOutputPane(slot,top=false){
  const pane=document.createElement('div');
  pane.className='processor-pane processor-pane-output'+(top?' processor-output-top':'');
  pane.dataset.outputPane=slot;
  const heading=slot==='autoZero'?'MATCHING FILES':'TARGET FILE';
  pane.innerHTML='<div class="processor-output-zone"><div class="processor-output-head"><span>'+heading+'</span><span class="processor-output-count">0 files</span></div><div class="processor-output-list"><span class="processor-output-empty">No files yet</span></div></div>';
  return pane;
}

function buildNode(){
  const node=document.createElement('section');
  node.className='processor-node';
  node.id='processorNode';
  node.hidden=true;
  node.setAttribute('aria-label','Target Editor node');

  const head=document.createElement('header');
  head.className='processor-node-head';
  head.innerHTML='<strong>Target Editor</strong><span>Signal target workspace</span>';

  node.append(
    head,
    makePane(PORTS[0],'processor-pane-raptor'),
    makeOutputPane('raptor',true),
    makePane(PORTS[1],'processor-pane-nga'),
    makeOutputPane('nga'),
    makePane(PORTS[2],'processor-pane-auto'),
    makeOutputPane('autoZero')
  );

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

function sourceColor(file){ return file?.color||'#8FA6B8'; }

function hexTint(hex,alpha=.12){
  const value=String(hex||'').replace('#','');
  const full=value.length===3?value.split('').map(c=>c+c).join(''):value;
  if(!/^[0-9a-f]{6}$/i.test(full)) return 'rgba(143,166,184,'+alpha+')';
  const n=parseInt(full,16);
  return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+alpha+')';
}

function hexInk(hex,factor=.58){
  const value=String(hex||'').replace('#','');
  const full=value.length===3?value.split('').map(c=>c+c).join(''):value;
  if(!/^[0-9a-f]{6}$/i.test(full)) return '#465863';
  const n=parseInt(full,16);
  const r=Math.round(((n>>16)&255)*factor);
  const g=Math.round(((n>>8)&255)*factor);
  const b=Math.round((n&255)*factor);
  return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}

function lineageForSlot(state,slot){
  const file=measurementById(state.inputs[slot]);
  return file?{
    file,
    color:sourceColor(file),
    ink:hexInk(sourceColor(file)),
    tint:hexTint(sourceColor(file),.13),
    tintSoft:hexTint(sourceColor(file),.07)
  }:null;
}

function applyLineageStyle(state,slot){
  const lineage=lineageForSlot(state,slot);
  const inputPane=processorNode.querySelector('[data-port-pane="'+slot+'"]');
  const outputPane=processorNode.querySelector('[data-output-pane="'+slot+'"]');

  for(const pane of [inputPane,outputPane]){
    if(!pane) continue;
    pane.classList.toggle('has-lineage',!!lineage);
    if(lineage){
      pane.style.setProperty('--lineage-color',lineage.color);
      pane.style.setProperty('--lineage-ink',lineage.ink);
      pane.style.setProperty('--lineage-tint',lineage.tint);
      pane.style.setProperty('--lineage-tint-soft',lineage.tintSoft);
    }else{
      pane.style.removeProperty('--lineage-color');
      pane.style.removeProperty('--lineage-ink');
      pane.style.removeProperty('--lineage-tint');
      pane.style.removeProperty('--lineage-tint-soft');
    }
  }
}

function renderInputs(){
  if(!activeCard) return;
  const state=ensureProcessorState(activeCard);
  for(const port of PORTS){
    const button=processorNode.querySelector('.processor-input[data-port="'+port.id+'"]');
    const count=processorNode.querySelector('[data-input-count="'+port.id+'"]');
    const file=measurementById(state.inputs[port.id]);
    if(state.inputs[port.id]&&!file) state.inputs[port.id]=null;
    const connected=!!file;
    button.classList.toggle('is-connected',connected);
    button.classList.toggle('is-full',connected);
    button.style.setProperty('--port-color',connected?sourceColor(file):'');
    if(count) count.textContent=connected?'1 / 1':'0 / 1';
    applyLineageStyle(state,port.id);
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
    const lineage=lineageForSlot(state,slot);
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
      const rowColor=lineage?.color||output.color||'#8FA6B8';
      if(lineage) output.color=rowColor;
      row.style.setProperty('--file-color',rowColor);
      row.style.setProperty('--file-tint',hexTint(rowColor,.10));
      row.dataset.outputId=output.id;
      const dot=document.createElement('span');
      dot.className='processor-output-dot';
      const name=document.createElement('span');
      name.className='processor-output-name';
      name.textContent=output.name||'RAPTOR output';
      const handle=document.createElement('button');
      handle.className='processor-file-output';
      handle.type='button';
      handle.style.setProperty('--file-color',rowColor);
      handle.setAttribute('aria-label','Connect '+name.textContent);
      handle.addEventListener('pointerdown',event=>beginWire(event,{
        kind:'processor-output',id:output.id,name:name.textContent,color:rowColor,slot
      },handle));
      row.append(dot,name,handle);
      list.appendChild(row);
    }
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

  for(const link of links){
    const file=measurementById(link.fileId);
    const source=measurementHandle(link.fileId);
    const target=processorNode.querySelector('.processor-input[data-port="'+link.port+'"]');
    if(!file||!source||!target) continue;
    const d=curvePath(pointFor(source),pointFor(target));
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('class','pipeline-persistent-wire');
    path.setAttribute('stroke',sourceColor(file));
    path.setAttribute('d',d);

    const flow=document.createElementNS('http://www.w3.org/2000/svg','path');
    flow.setAttribute('class','pipeline-wire-flow');
    flow.setAttribute('d',d);

    persistentGroup.append(path,flow);
  }
}

function canAccept(portId,source){
  if(source.kind!=='measurement'||!activeCard) return false;
  const state=ensureProcessorState(activeCard);
  return PORTS.some(port=>port.id===portId)&&!state.inputs[portId];
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
  state.inputs[port]=source.fileId;
  sync();
  input.classList.add('is-magnet');
  setTimeout(()=>input.classList.remove('is-magnet'),110);
  return true;
}

function connectedSourceForInput(input){
  if(!activeCard||!input) return null;
  const state=ensureProcessorState(activeCard);
  const port=input.dataset.port;
  const fileId=state.inputs[port]||null;
  const file=measurementById(fileId);
  if(!file) return null;
  return {
    kind:'measurement',
    id:file.id,
    fileId:file.id,
    name:file.name,
    color:sourceColor(file),
    fromPort:port
  };
}

function detachSourceFromPort(port,fileId){
  if(!activeCard) return false;
  const state=ensureProcessorState(activeCard);

  if(state.inputs[port]!==fileId) return false;
  state.inputs[port]=null;
  return true;
}

function restoreSourceToPort(port,fileId){
  if(!activeCard) return;
  const state=ensureProcessorState(activeCard);
  if(!state.inputs[port]) state.inputs[port]=fileId;
}

function beginInputDetach(event,input){
  if(event.button!==undefined&&event.button!==0) return;
  const source=connectedSourceForInput(input);
  if(!source) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  ensureWireLayers();
  const originalPort=source.fromPort;
  const pointerId=event.pointerId;
  const sourceHandle=measurementHandle(source.fileId);
  if(!sourceHandle) return;

  if(!detachSourceFromPort(originalPort,source.fileId)) return;
  input.classList.add('is-detaching');
  sync();

  const start=pointFor(sourceHandle);
  previewPath.setAttribute('stroke',source.color||'#5b6770');
  previewEnd.setAttribute('fill',source.color||'#5b6770');
  previewEnd.hidden=false;

  clearPortHighlights();
  for(const target of eligibleInputs(source)) target.classList.add('is-available');

  try{input.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;

    clearPortHighlights();
    for(const target of eligibleInputs(source)) target.classList.add('is-available');

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

  const finish=(endEvent,cancelled=false)=>{
    if(endEvent.pointerId!==pointerId) return;

    if(cancelled){
      restoreSourceToPort(originalPort,source.fileId);
      sync();
    }else{
      const magnet=nearestInput(endEvent.clientX,endEvent.clientY,source);
      if(magnet){
        connectMeasurement(source,magnet.input);
      }else{
        sync();
      }
    }

    previewPath.removeAttribute('d');
    previewEnd.hidden=true;
    input.classList.remove('is-detaching');
    clearPortHighlights();

    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',up);
    window.removeEventListener('pointercancel',cancel);

    try{
      if(input.hasPointerCapture(pointerId)) input.releasePointerCapture(pointerId);
    }catch{}
  };

  const up=endEvent=>finish(endEvent,false);
  const cancel=endEvent=>finish(endEvent,true);

  move(event);
  window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerup',up);
  window.addEventListener('pointercancel',cancel);
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
  if(event.target.closest('button,.processor-output-file')) return;
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
  const lineage=lineageForSlot(state,slot);
  const entry={
    id:file?.id||('processor-output-'+Date.now()+'-'+Math.random().toString(36).slice(2,7)),
    name:file?.name||'RAPTOR output',
    color:lineage?.color||file?.color||'#8FA6B8',
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
