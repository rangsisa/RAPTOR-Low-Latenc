(()=>{
'use strict';

const api=window.RaptorPipeline;
const sumEngine=window.RaptorMonitorComplexSum;
const canonicalApi=window.RaptorMeasurementCanonicalV1;
const canvas=document.getElementById('pipelineNodeCanvas');
const wireSvg=document.querySelector('.pipeline-wire-layer');
const wirePreview=document.getElementById('pipelineWirePreview');
const measurementList=document.getElementById('measurementList');
const measurementNode=document.getElementById('measurementNode');
if(!api||!sumEngine||!canonicalApi||!canvas||!wireSvg||!wirePreview||!measurementList||!measurementNode) return;

const SVG_NS='http://www.w3.org/2000/svg';
const TYPE='monitor';
const F0=20;
const F1=20000;
const GRAPH_WIDTH=1000;
const GRAPH_HEIGHT=220;
const MAX_GRAPH_POINTS=1400;

let activeCard=null;
let sequence=1;
let inputSequence=1;
let windowZ=3300;
let persistentWireGroup=null;
const windows=new Map();

function makeId(){return 'monitor-'+Date.now().toString(36)+'-'+(sequence++);}
function makeInputId(){return 'monitor-input-'+Date.now().toString(36)+'-'+(inputSequence++);}

function defaultMonitor(position={x:680,y:140}){
  return {
    id:makeId(),
    type:TYPE,
    label:'Monitor',
    position:{
      x:Number.isFinite(position.x)?position.x:680,
      y:Number.isFinite(position.y)?position.y:140
    },
    windowPosition:null,
    inputs:[],
    ui:{overlay:true,sum:true,phase:true,magnitude:true}
  };
}

function cloneInput(input){
  return {
    id:String(input?.id||makeInputId()),
    sourceKind:String(input?.sourceKind||'measurement'),
    sourceId:String(input?.sourceId||''),
    outputKind:String(input?.outputKind||'response'),
    color:input?.color||'#8FA6B8',
    label:String(input?.label||'Response')
  };
}

function cloneMonitor(monitor,rekey=false){
  return {
    id:rekey?makeId():String(monitor?.id||makeId()),
    type:TYPE,
    label:'Monitor',
    position:{
      x:Number(monitor?.position?.x)||680,
      y:Number(monitor?.position?.y)||140
    },
    windowPosition:monitor?.windowPosition&&Number.isFinite(Number(monitor.windowPosition.x))&&Number.isFinite(Number(monitor.windowPosition.y))
      ?{x:Number(monitor.windowPosition.x),y:Number(monitor.windowPosition.y)}
      :null,
    // Duplicated Lines re-key processor IDs in sibling modules. Drop Monitor
    // bindings rather than silently pointing the duplicate at stale source IDs.
    inputs:rekey?[]:(Array.isArray(monitor?.inputs)?monitor.inputs.map(cloneInput):[]),
    ui:{
      overlay:monitor?.ui?.overlay!==false,
      sum:monitor?.ui?.sum!==false,
      phase:monitor?.ui?.phase!==false,
      magnitude:monitor?.ui?.magnitude!==false
    }
  };
}

function normalizeMonitor(monitor){
  if(!monitor||typeof monitor!=='object') return defaultMonitor();
  const normalized=cloneMonitor(monitor,false);
  Object.assign(monitor,normalized);
  return monitor;
}

function ensureMonitors(card){
  if(!card) return [];
  if(!card._raptorLineState) card._raptorLineState={version:1,nodes:{}};
  if(!card._raptorLineState.nodes) card._raptorLineState.nodes={};
  if(!Array.isArray(card._raptorLineState.nodes.monitors)) card._raptorLineState.nodes.monitors=[];
  const monitors=card._raptorLineState.nodes.monitors;
  for(let i=0;i<monitors.length;i++) monitors[i]=normalizeMonitor(monitors[i]);
  return monitors;
}

function activeMonitors(){return activeCard?ensureMonitors(activeCard):[];}
function monitorById(id){return activeMonitors().find(monitor=>monitor.id===id)||null;}

function inputIdentity(sourceKind,sourceId){
  return String(sourceKind)+':'+String(sourceId);
}

function hasInput(monitor,sourceKind,sourceId){
  const identity=inputIdentity(sourceKind,sourceId);
  return monitor.inputs.some(input=>inputIdentity(input.sourceKind,input.sourceId)===identity);
}

function measurementResponse(entry){
  if(!entry?.canonical) return null;
  try{
    canonicalApi.validate(entry.canonical);
    const views=canonicalApi.views(entry.canonical);
    return Object.freeze({
      id:'measurement:'+entry.id,
      pairId:'measurement:'+entry.id,
      name:entry.name||'Measurement',
      color:entry.color||'#8FA6B8',
      sampleRateHz:Number(entry.sampleRate??entry.canonical?.sample_rate_hz)||null,
      sourceMeasurementId:entry.id,
      frequency_hz:views.frequency_hz,
      magnitude_db:views.magnitude_db,
      phase_deg:views.phase_deg,
      coherence:views.coherence||null
    });
  }catch{
    return null;
  }
}

function resolveInput(input){
  if(!input) return null;
  if(input.sourceKind==='measurement'){
    return measurementResponse(api.getMeasurement?.(input.sourceId)||null);
  }
  if(input.sourceKind==='mag-phase-gd'){
    const module=window.RaptorMagPhaseGdFilter;
    if(!module) return null;
    return module.getOutput?.(input.sourceId,input.outputKind==='magnitude'?'magnitude':'phase')||null;
  }
  if(input.sourceKind==='crossover'){
    const module=window.RaptorCrossoverFilter;
    if(!module) return null;
    const response=module.getOutput?.(input.sourceId)||null;
    if(!response) return null;
    return Object.freeze({
      ...response,
      id:'crossover:'+input.sourceId,
      pairId:'crossover:'+input.sourceId
    });
  }
  return null;
}

function monitorEvaluation(monitor){
  const resolved=[];
  let missing=0;
  for(const input of monitor.inputs){
    const response=resolveInput(input);
    if(response) resolved.push({input,response});
    else missing+=1;
  }

  if(missing){
    return {
      resolved,
      responses:resolved.map(item=>item.response),
      missing,
      compatibility:Object.freeze({
        ready:false,
        reason:'MISSING_SOURCE',
        sourceCount:resolved.length,
        message:missing+' source'+(missing===1?' is':'s are')+' unavailable'
      }),
      sum:null
    };
  }

  const responses=resolved.map(item=>item.response);
  const compatibility=sumEngine.inspectCompatibility(responses);
  let sum=null;
  if(compatibility.ready&&responses.length){
    try{sum=sumEngine.sum(responses);}catch{}
  }
  return {resolved,responses,missing:0,compatibility,sum};
}

function statusText(evaluation){
  const count=evaluation.responses.length;
  if(!count) return 'No inputs';
  if(evaluation.compatibility.ready){
    return count+' path'+(count===1?'':'s')+' · COMPLEX SUM READY';
  }
  if(evaluation.compatibility.reason==='GRID_MISMATCH'){
    return count+' paths · GRID MISMATCH';
  }
  if(evaluation.compatibility.reason==='MISSING_SOURCE'){
    return count+' live · SOURCE MISSING';
  }
  return count+' path'+(count===1?'':'s')+' · NOT READY';
}

function clampNodePosition(position,node=null){
  const width=node?.offsetWidth||276;
  const height=node?.offsetHeight||150;
  const maxX=Math.max(8,canvas.scrollWidth-width-12);
  const maxY=Math.max(8,canvas.scrollHeight-height-12);
  return {
    x:Math.max(8,Math.min(maxX,Number(position.x)||8)),
    y:Math.max(8,Math.min(maxY,Number(position.y)||8))
  };
}

function startNodeDrag(event,node,monitor){
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
    monitor.position=next;
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

function addInput(monitor,source){
  if(!monitor||!source?.sourceId||hasInput(monitor,source.sourceKind,source.sourceId)) return false;
  monitor.inputs.push({
    id:makeInputId(),
    sourceKind:source.sourceKind,
    sourceId:String(source.sourceId),
    outputKind:String(source.outputKind||'response'),
    color:source.color||'#8FA6B8',
    label:String(source.label||'Response')
  });
  renderNodes();
  const win=windows.get(monitor.id);
  if(win&&!win.hidden) renderWindow(monitor,win);
  document.dispatchEvent(new CustomEvent('raptor:monitorinputchange',{
    detail:{monitorId:monitor.id,sourceKind:source.sourceKind,sourceId:String(source.sourceId),connected:true}
  }));
  return true;
}

function removeInput(monitor,inputId){
  const index=monitor?.inputs?.findIndex(input=>input.id===inputId)??-1;
  if(index<0) return false;
  const [removed]=monitor.inputs.splice(index,1);
  renderNodes();
  const win=windows.get(monitor.id);
  if(win&&!win.hidden) renderWindow(monitor,win);
  document.dispatchEvent(new CustomEvent('raptor:monitorinputchange',{
    detail:{monitorId:monitor.id,sourceKind:removed.sourceKind,sourceId:removed.sourceId,connected:false}
  }));
  return true;
}

function buildNode(monitor,index){
  const node=document.createElement('section');
  node.className='monitor-node';
  node.dataset.monitorId=monitor.id;
  node.setAttribute('aria-label','Monitor '+(index+1));

  const pos=clampNodePosition(monitor.position,node);
  monitor.position=pos;
  node.style.left=pos.x+'px';
  node.style.top=pos.y+'px';

  const head=document.createElement('header');
  head.className='monitor-node-head';

  const title=document.createElement('div');
  title.className='monitor-node-title';
  title.innerHTML='<strong>Monitor</strong><span>'+monitor.id+'</span>';

  const play=document.createElement('button');
  play.type='button';
  play.className='monitor-play';
  play.textContent='▶';
  play.title='Open Monitor workspace';
  play.addEventListener('click',event=>{
    event.stopPropagation();
    openWindow(monitor.id);
  });
  head.append(title,play);

  const body=document.createElement('div');
  body.className='monitor-node-body';

  const inputPane=document.createElement('div');
  inputPane.className='monitor-input-pane';
  const input=document.createElement('button');
  input.type='button';
  input.className='monitor-input';
  input.dataset.monitorId=monitor.id;
  input.title='Multi-input response sink';
  input.setAttribute('aria-label','Connect response to '+monitor.id);
  const inputCopy=document.createElement('div');
  inputCopy.className='monitor-input-copy';
  inputCopy.innerHTML='<span>MULTI</span><strong>INPUT</strong>';
  inputPane.append(input,inputCopy);

  const list=document.createElement('div');
  list.className='monitor-input-list';
  if(!monitor.inputs.length){
    const empty=document.createElement('div');
    empty.className='monitor-input-empty';
    empty.textContent='Connect Measurement or processor response';
    list.appendChild(empty);
  }else{
    for(const entry of monitor.inputs){
      const row=document.createElement('div');
      row.className='monitor-input-row';
      row.style.setProperty('--input-color',entry.color||'#8FA6B8');
      const dot=document.createElement('span');
      dot.className='monitor-input-dot';
      const label=document.createElement('span');
      label.className='monitor-input-label';
      label.textContent=entry.label;
      const remove=document.createElement('button');
      remove.type='button';
      remove.className='monitor-input-remove';
      remove.textContent='×';
      remove.title='Disconnect '+entry.label;
      remove.addEventListener('click',event=>{
        event.stopPropagation();
        removeInput(monitor,entry.id);
      });
      row.append(dot,label,remove);
      list.appendChild(row);
    }
  }

  body.append(inputPane,list);

  const foot=document.createElement('footer');
  foot.className='monitor-node-foot';
  const evaluation=monitorEvaluation(monitor);
  const status=document.createElement('span');
  status.className='monitor-status';
  status.textContent=statusText(evaluation);
  status.classList.toggle('is-ready',evaluation.compatibility.ready&&evaluation.responses.length>0);
  status.classList.toggle('is-warning',monitor.inputs.length>0&&!evaluation.compatibility.ready);

  const remove=document.createElement('button');
  remove.type='button';
  remove.className='monitor-delete';
  remove.textContent='Delete';
  remove.addEventListener('click',event=>{
    event.stopPropagation();
    const ok=window.confirm('Delete Monitor '+monitor.id+'?');
    if(ok) deleteMonitor(monitor.id);
  });
  foot.append(status,remove);

  node.append(head,body,foot);
  node.classList.toggle('has-inputs',monitor.inputs.length>0);
  node.addEventListener('pointerdown',event=>startNodeDrag(event,node,monitor));
  node.addEventListener('contextmenu',event=>event.stopPropagation());
  return node;
}

function removeRenderedNodes(){
  canvas.querySelectorAll('.monitor-node').forEach(node=>{
    const monitorId=node.dataset.monitorId;
    if(monitorId) api.unregisterInput?.('monitor:'+monitorId+':input');
    node.remove();
  });
}

function renderNodes(){
  removeRenderedNodes();
  if(!activeCard){
    ensureWireGroup().replaceChildren();
    return;
  }

  activeMonitors().forEach((monitor,index)=>{
    const node=buildNode(monitor,index);
    canvas.appendChild(node);
    const input=node.querySelector('.monitor-input');
    api.registerInput?.('monitor:'+monitor.id+':input',input,{
      radius:56,
      canAccept:entry=>!!entry&&!hasInput(monitor,'measurement',entry.id),
      onConnect:entry=>addInput(monitor,{
        sourceKind:'measurement',
        sourceId:entry.id,
        outputKind:'response',
        color:entry.color||'#8FA6B8',
        label:entry.name||'Measurement'
      })
    });
  });

  requestAnimationFrame(renderConnections);
}

function createMonitor(x,y){
  if(!activeCard) return null;
  const monitor=defaultMonitor(clampNodePosition({x:x-138,y:y-75}));
  ensureMonitors(activeCard).push(monitor);
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:monitorcreated',{
    detail:{lineId:activeCard.dataset.lineId||null,monitorId:monitor.id,x:monitor.position.x,y:monitor.position.y}
  }));
  return monitor;
}

function deleteMonitor(monitorId){
  if(!activeCard) return false;
  const monitors=ensureMonitors(activeCard);
  const index=monitors.findIndex(monitor=>monitor.id===monitorId);
  if(index<0) return false;
  monitors.splice(index,1);
  api.unregisterInput?.('monitor:'+monitorId+':input');
  const win=windows.get(monitorId);
  if(win) win.remove();
  windows.delete(monitorId);
  renderNodes();
  document.dispatchEvent(new CustomEvent('raptor:monitordeleted',{detail:{monitorId}}));
  return true;
}

function ensureWireGroup(){
  if(persistentWireGroup?.isConnected) return persistentWireGroup;
  persistentWireGroup=wireSvg.querySelector('.monitor-persistent-wires');
  if(!persistentWireGroup){
    persistentWireGroup=document.createElementNS(SVG_NS,'g');
    persistentWireGroup.setAttribute('class','pipeline-persistent-wires monitor-persistent-wires');
    if(wirePreview) wireSvg.insertBefore(persistentWireGroup,wirePreview);
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

function sourceHandle(input){
  if(input.sourceKind==='measurement') return measurementHandle(input.sourceId);
  if(input.sourceKind==='mag-phase-gd'){
    return canvas.querySelector(
      '.mpgd-filter-output[data-filter-id="'+CSS.escape(input.sourceId)+'"][data-output-kind="'+
      (input.outputKind==='magnitude'?'magnitude':'phase')+'"]'
    );
  }
  if(input.sourceKind==='crossover'){
    return canvas.querySelector('.xo-filter-output[data-filter-id="'+CSS.escape(input.sourceId)+'"]');
  }
  return null;
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

  for(const monitor of activeMonitors()){
    const target=canvas.querySelector('.monitor-node[data-monitor-id="'+CSS.escape(monitor.id)+'"] .monitor-input');
    if(!target) continue;

    for(const input of monitor.inputs){
      const source=sourceHandle(input);
      if(!source) continue;
      const d=wireCurve(canvasPointFor(source),canvasPointFor(target));

      const hit=document.createElementNS(SVG_NS,'path');
      hit.setAttribute('class','pipeline-persistent-wire-hit');
      hit.setAttribute('d',d);
      hit.dataset.wireId='monitor-input:'+monitor.id+':'+input.id;
      hit.dataset.sourceId=inputIdentity(input.sourceKind,input.sourceId);
      hit.dataset.targetId=monitor.id;

      const path=document.createElementNS(SVG_NS,'path');
      path.setAttribute('class','pipeline-persistent-wire');
      path.setAttribute('stroke',input.color||'#8FA6B8');
      path.setAttribute('d',d);

      const flow=document.createElementNS(SVG_NS,'path');
      flow.setAttribute('class','pipeline-wire-flow');
      flow.setAttribute('d',d);
      group.append(hit,path,flow);
    }
  }
}

function clearMonitorWireHighlights(){
  canvas.querySelectorAll('.monitor-input').forEach(input=>{
    input.classList.remove('is-wire-available','is-wire-magnet');
  });
}

function sourceFromProcessorHandle(handle){
  if(handle.classList.contains('mpgd-filter-output')){
    const filterId=handle.dataset.filterId;
    const outputKind=handle.dataset.outputKind==='magnitude'?'magnitude':'phase';
    const response=window.RaptorMagPhaseGdFilter?.getOutput?.(filterId,outputKind)||null;
    if(!response) return null;
    return {
      sourceKind:'mag-phase-gd',
      sourceId:filterId,
      outputKind,
      color:response.color||'#8FA6B8',
      label:(outputKind==='phase'?'Phase':'Magnitude')+' · '+filterId,
      response
    };
  }

  if(handle.classList.contains('xo-filter-output')){
    const filterId=handle.dataset.filterId;
    const response=window.RaptorCrossoverFilter?.getOutput?.(filterId)||null;
    if(!response) return null;
    const kind=response.filterType==='lowpass'?'Lowpass':'Highpass';
    return {
      sourceKind:'crossover',
      sourceId:filterId,
      outputKind:'response',
      color:response.color||'#8FA6B8',
      label:kind+' · '+filterId,
      response
    };
  }
  return null;
}

function eligibleMonitorTargets(source){
  const targets=[];
  for(const node of canvas.querySelectorAll('.monitor-node')){
    const monitor=monitorById(node.dataset.monitorId);
    const input=node.querySelector('.monitor-input');
    if(!monitor||!input||hasInput(monitor,source.sourceKind,source.sourceId)) continue;
    targets.push({monitor,input});
  }
  return targets;
}

function nearestMonitorTarget(clientX,clientY,source){
  let best=null;
  for(const target of eligibleMonitorTargets(source)){
    const rect=target.input.getBoundingClientRect();
    const x=rect.left+rect.width/2;
    const y=rect.top+rect.height/2;
    const distance=Math.hypot(clientX-x,clientY-y);
    if(distance<=58&&(!best||distance<best.distance)) best={...target,distance,x,y};
  }
  return best;
}

function startProcessorWire(event,handle){
  if(event.button!==undefined&&event.button!==0) return;
  if(!activeCard||!activeMonitors().length) return;
  const source=sourceFromProcessorHandle(handle);
  if(!source) return;

  const pointerId=event.pointerId;
  const canvasRect=canvas.getBoundingClientRect();
  const handleRect=handle.getBoundingClientRect();
  const startX=handleRect.left+handleRect.width/2-canvasRect.left+canvas.scrollLeft;
  const startY=handleRect.top+handleRect.height/2-canvasRect.top+canvas.scrollTop;
  wirePreview.setAttribute('stroke',source.color||'#8FA6B8');

  clearMonitorWireHighlights();
  eligibleMonitorTargets(source).forEach(target=>target.input.classList.add('is-wire-available'));
  try{handle.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    clearMonitorWireHighlights();
    eligibleMonitorTargets(source).forEach(target=>target.input.classList.add('is-wire-available'));

    const magnet=nearestMonitorTarget(moveEvent.clientX,moveEvent.clientY,source);
    let endX=moveEvent.clientX-canvasRect.left+canvas.scrollLeft;
    let endY=moveEvent.clientY-canvasRect.top+canvas.scrollTop;
    if(magnet){
      magnet.input.classList.add('is-wire-magnet');
      const point=canvasPointFor(magnet.input);
      endX=point.x;
      endY=point.y;
    }
    const bend=Math.max(48,Math.abs(endX-startX)*.38);
    wirePreview.setAttribute('d','M '+startX+' '+startY+' C '+(startX+bend)+' '+startY+', '+(endX-bend)+' '+endY+', '+endX+' '+endY);
  };

  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    const magnet=nearestMonitorTarget(endEvent.clientX,endEvent.clientY,source);
    if(magnet) addInput(magnet.monitor,source);

    wirePreview.removeAttribute('d');
    clearMonitorWireHighlights();
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

function graphX(frequency){
  const t=(Math.log10(frequency)-Math.log10(F0))/(Math.log10(F1)-Math.log10(F0));
  return Math.max(0,Math.min(GRAPH_WIDTH,t*GRAPH_WIDTH));
}
function phaseY(value){return (180-Math.max(-180,Math.min(180,value)))/360*GRAPH_HEIGHT;}
function magnitudeY(value,min,max){return (max-value)/(max-min)*GRAPH_HEIGHT;}

function graphIndices(frequency){
  const indices=[];
  for(let i=0;i<frequency.length;i++){
    const f=Number(frequency[i]);
    if(Number.isFinite(f)&&f>=F0&&f<=F1) indices.push(i);
  }
  if(indices.length<=MAX_GRAPH_POINTS) return indices;
  const out=[];
  const stride=(indices.length-1)/(MAX_GRAPH_POINTS-1);
  for(let n=0;n<MAX_GRAPH_POINTS;n++) out.push(indices[Math.min(indices.length-1,Math.round(n*stride))]);
  return [...new Set(out)];
}

function phasePath(response){
  const frequency=response.frequency_hz;
  const phase=response.phase_deg;
  const validMask=response.phase_valid||null;
  const indices=graphIndices(frequency);
  let path='';
  let previous=null;

  for(const i of indices){
    const f1=Number(frequency[i]),p1=Number(phase[i]);
    const valid=Number.isFinite(f1)&&Number.isFinite(p1)&&(!validMask||validMask[i]!==0);
    if(!valid){previous=null;continue;}

    const x1=graphX(f1),y1=phaseY(p1);
    if(previous===null){
      path+='M'+x1.toFixed(2)+' '+y1.toFixed(2)+' ';
      previous=i;
      continue;
    }

    const f0=Number(frequency[previous]),p0=Number(phase[previous]);
    const x0=graphX(f0);
    const delta=p1-p0;
    if(Number.isFinite(f0)&&Number.isFinite(p0)&&Math.abs(delta)>180){
      let adjustedP1=p1,boundary=180,opposite=-180;
      if(delta>180){adjustedP1=p1-360;boundary=-180;opposite=180;}
      else{adjustedP1=p1+360;boundary=180;opposite=-180;}
      const den=adjustedP1-p0;
      let t=den===0?0:(boundary-p0)/den;
      t=Math.max(0,Math.min(1,t));
      const xCross=x0+(x1-x0)*t;
      path+='L'+xCross.toFixed(2)+' '+phaseY(boundary).toFixed(2)+' ';
      path+='M'+xCross.toFixed(2)+' '+phaseY(opposite).toFixed(2)+' ';
      path+='L'+x1.toFixed(2)+' '+y1.toFixed(2)+' ';
    }else{
      path+='L'+x1.toFixed(2)+' '+y1.toFixed(2)+' ';
    }
    previous=i;
  }
  return path.trim();
}

function magnitudePath(response,min,max){
  const frequency=response.frequency_hz;
  const magnitude=response.magnitude_db;
  const indices=graphIndices(frequency);
  let path='';
  for(const i of indices){
    const f=Number(frequency[i]),value=Number(magnitude[i]);
    if(!(Number.isFinite(f)&&Number.isFinite(value))){path='';continue;}
    const x=graphX(f),y=magnitudeY(value,min,max);
    path+=(path?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)+' ';
  }
  return path.trim();
}

function magnitudeRange(evaluation){
  let min=Infinity,max=-Infinity;
  const responses=[...evaluation.responses];
  if(evaluation.sum) responses.push(evaluation.sum);
  for(const response of responses){
    const values=response.magnitude_db||[];
    for(let i=0;i<values.length;i++){
      const f=Number(response.frequency_hz?.[i]);
      const v=Number(values[i]);
      if(Number.isFinite(f)&&f>=F0&&f<=F1&&Number.isFinite(v)){
        min=Math.min(min,v);
        max=Math.max(max,v);
      }
    }
  }
  if(!(min<Infinity&&max>-Infinity)) return {min:-40,max:40};
  const center=(min+max)/2;
  const span=Math.max(24,max-min+8);
  return {min:center-span/2,max:center+span/2};
}

function appendGrid(svg,kind,magRange){
  svg.replaceChildren();
  for(let i=0;i<=4;i++){
    const y=GRAPH_HEIGHT*i/4;
    const line=document.createElementNS(SVG_NS,'line');
    line.setAttribute('x1','0');
    line.setAttribute('x2',String(GRAPH_WIDTH));
    line.setAttribute('y1',String(y));
    line.setAttribute('y2',String(y));
    line.setAttribute('class','monitor-grid-line'+(i===2?' is-zero':''));
    svg.appendChild(line);
  }
  for(const f of [20,50,100,200,500,1000,2000,5000,10000,20000]){
    const x=graphX(f);
    const line=document.createElementNS(SVG_NS,'line');
    line.setAttribute('x1',String(x));
    line.setAttribute('x2',String(x));
    line.setAttribute('y1','0');
    line.setAttribute('y2',String(GRAPH_HEIGHT));
    line.setAttribute('class','monitor-grid-line');
    svg.appendChild(line);
  }
  if(kind==='magnitude'&&magRange){
    svg.dataset.magMin=String(magRange.min);
    svg.dataset.magMax=String(magRange.max);
  }
}

function addTrace(svg,path,color,isSum=false){
  if(!path) return;
  const trace=document.createElementNS(SVG_NS,'path');
  trace.setAttribute('d',path);
  trace.setAttribute('class',isSum?'monitor-sum-trace':'monitor-overlay-trace');
  if(!isSum) trace.style.setProperty('--trace-color',color||'#8FA6B8');
  svg.appendChild(trace);
}

function renderInputPanel(monitor,win,evaluation){
  const list=win.querySelector('.monitor-window-input-list');
  const count=win.querySelector('[data-monitor-window-count]');
  if(count) count.textContent=monitor.inputs.length+' input'+(monitor.inputs.length===1?'':'s');
  if(!list) return;
  list.replaceChildren();

  if(!monitor.inputs.length){
    const empty=document.createElement('div');
    empty.className='monitor-input-empty';
    empty.textContent='No response inputs connected';
    list.appendChild(empty);
    return;
  }

  for(const input of monitor.inputs){
    const response=resolveInput(input);
    const row=document.createElement('div');
    row.className='monitor-window-input';
    row.style.setProperty('--input-color',input.color||'#8FA6B8');
    const dot=document.createElement('span');
    dot.className='monitor-input-dot';
    const copy=document.createElement('div');
    copy.className='monitor-window-input-copy';
    const name=document.createElement('strong');
    name.textContent=input.label;
    const meta=document.createElement('span');
    meta.textContent=response
      ?((response.pairId||response.hostId||response.id||'paired response')+' · '+response.frequency_hz.length+' pts')
      :'Source unavailable';
    copy.append(name,meta);
    row.append(dot,copy);
    list.appendChild(row);
  }
}

function renderWindow(monitor,win){
  const evaluation=monitorEvaluation(monitor);
  const status=win.querySelector('.monitor-workspace-status');
  if(status){
    status.textContent=statusText(evaluation);
    status.classList.toggle('is-ready',evaluation.compatibility.ready&&evaluation.responses.length>0);
    status.classList.toggle('is-warning',monitor.inputs.length>0&&!evaluation.compatibility.ready);
    status.title=evaluation.compatibility.message||'';
  }

  const phaseSvg=win.querySelector('[data-monitor-svg="phase"]');
  const magSvg=win.querySelector('[data-monitor-svg="magnitude"]');
  const magRange=magnitudeRange(evaluation);
  if(phaseSvg) appendGrid(phaseSvg,'phase',null);
  if(magSvg) appendGrid(magSvg,'magnitude',magRange);

  if(monitor.ui.overlay){
    for(const item of evaluation.resolved){
      const color=item.response.color||item.input.color||'#8FA6B8';
      if(phaseSvg&&monitor.ui.phase) addTrace(phaseSvg,phasePath(item.response),color,false);
      if(magSvg&&monitor.ui.magnitude) addTrace(magSvg,magnitudePath(item.response,magRange.min,magRange.max),color,false);
    }
  }

  if(monitor.ui.sum&&evaluation.sum){
    if(phaseSvg&&monitor.ui.phase) addTrace(phaseSvg,phasePath(evaluation.sum),null,true);
    if(magSvg&&monitor.ui.magnitude) addTrace(magSvg,magnitudePath(evaluation.sum,magRange.min,magRange.max),null,true);
  }

  const phaseCard=win.querySelector('[data-monitor-card="phase"]');
  const magCard=win.querySelector('[data-monitor-card="magnitude"]');
  if(phaseCard) phaseCard.style.opacity=monitor.ui.phase?'1':'.22';
  if(magCard) magCard.style.opacity=monitor.ui.magnitude?'1':'.22';

  const magTop=win.querySelector('[data-monitor-mag-top]');
  const magMid=win.querySelector('[data-monitor-mag-mid]');
  const magBottom=win.querySelector('[data-monitor-mag-bottom]');
  if(magTop) magTop.textContent=magRange.max.toFixed(1)+' dB';
  if(magMid) magMid.textContent=((magRange.min+magRange.max)/2).toFixed(1)+' dB';
  if(magBottom) magBottom.textContent=magRange.min.toFixed(1)+' dB';

  const range=win.querySelector('[data-monitor-mag-range]');
  if(range) range.textContent=magRange.min.toFixed(1)+' … '+magRange.max.toFixed(1)+' dB';

  renderInputPanel(monitor,win,evaluation);
}

function clampWindowPosition(x,y,win){
  const margin=6;
  const width=win.offsetWidth||Math.min(1120,window.innerWidth-20);
  const height=win.offsetHeight||Math.min(720,window.innerHeight-20);
  return {
    x:Math.max(margin,Math.min(window.innerWidth-Math.min(width,window.innerWidth-margin)-margin,Number(x)||margin)),
    y:Math.max(margin,Math.min(window.innerHeight-Math.min(height,window.innerHeight-margin)-margin,Number(y)||margin))
  };
}

function bringToFront(win){
  windowZ+=1;
  win.style.zIndex=String(windowZ);
  windows.forEach(other=>other.classList.toggle('is-front',other===win));
}

function startWindowDrag(event,win,monitor){
  if(event.button!==undefined&&event.button!==0) return;
  if(event.target.closest('button,input,label')) return;
  event.preventDefault();
  bringToFront(win);
  const pointerId=event.pointerId;
  const rect=win.getBoundingClientRect();
  const dx=event.clientX-rect.left;
  const dy=event.clientY-rect.top;
  try{win.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    const pos=clampWindowPosition(moveEvent.clientX-dx,moveEvent.clientY-dy,win);
    win.style.left=pos.x+'px';
    win.style.top=pos.y+'px';
    monitor.windowPosition=pos;
  };
  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    try{if(win.hasPointerCapture(pointerId)) win.releasePointerCapture(pointerId)}catch{}
  };
  window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
}

function buildGraphCard(kind){
  const card=document.createElement('article');
  card.className='monitor-card';
  card.dataset.monitorCard=kind;
  const head=document.createElement('header');
  head.className='monitor-card-head';
  const title=document.createElement('strong');
  title.textContent=kind==='phase'?'Phase':'Magnitude';
  const range=document.createElement('span');
  range.className='monitor-card-range';
  if(kind==='phase') range.textContent='-180° … +180°';
  else range.dataset.monitorMagRange='';
  head.append(title,range);

  const plot=document.createElement('div');
  plot.className='monitor-plot';
  const svg=document.createElementNS(SVG_NS,'svg');
  svg.setAttribute('viewBox','0 0 '+GRAPH_WIDTH+' '+GRAPH_HEIGHT);
  svg.setAttribute('preserveAspectRatio','none');
  svg.dataset.monitorSvg=kind;
  plot.appendChild(svg);

  for(const [position,text] of kind==='phase'
    ?[['top','180°'],['mid','0°'],['bottom','-180°']]
    :[['top',''],['mid',''],['bottom','']]){
    const label=document.createElement('span');
    label.className='monitor-axis-label monitor-axis-label--'+position;
    if(kind==='magnitude'){
      if(position==='top') label.dataset.monitorMagTop='';
      if(position==='mid') label.dataset.monitorMagMid='';
      if(position==='bottom') label.dataset.monitorMagBottom='';
    }
    label.textContent=text;
    plot.appendChild(label);
  }

  card.append(head,plot);
  return card;
}

function buildWindow(monitor){
  const win=document.createElement('section');
  win.className='monitor-window';
  win.dataset.monitorId=monitor.id;
  win.setAttribute('role','dialog');
  win.setAttribute('aria-label','Monitor '+monitor.id);

  const head=document.createElement('header');
  head.className='monitor-window-head';
  const title=document.createElement('div');
  title.className='monitor-window-title';
  title.innerHTML='<strong>Monitor · Multiway</strong><span>'+monitor.id+'</span>';
  const close=document.createElement('button');
  close.type='button';
  close.className='monitor-window-close';
  close.textContent='×';
  close.setAttribute('aria-label','Close Monitor');
  close.addEventListener('click',()=>{win.hidden=true;});
  head.append(title,close);

  const body=document.createElement('div');
  body.className='monitor-window-body';
  const toolbar=document.createElement('div');
  toolbar.className='monitor-toolbar';
  for(const [key,label] of [['overlay','Overlay'],['sum','Complex Sum'],['phase','Phase'],['magnitude','Magnitude']]){
    const item=document.createElement('label');
    item.className='monitor-check';
    const input=document.createElement('input');
    input.type='checkbox';
    input.checked=monitor.ui[key]!==false;
    input.addEventListener('change',()=>{
      monitor.ui[key]=input.checked;
      renderWindow(monitor,win);
    });
    const text=document.createElement('span');
    text.textContent=label;
    item.append(input,text);
    toolbar.appendChild(item);
  }
  const status=document.createElement('span');
  status.className='monitor-workspace-status';
  status.textContent='No inputs';
  toolbar.appendChild(status);

  const main=document.createElement('div');
  main.className='monitor-workspace-main';
  const graphs=document.createElement('section');
  graphs.className='monitor-graphs';
  graphs.append(buildGraphCard('phase'),buildGraphCard('magnitude'));

  const panel=document.createElement('aside');
  panel.className='monitor-input-panel';
  const panelHead=document.createElement('header');
  panelHead.className='monitor-input-panel-head';
  const panelTitle=document.createElement('strong');
  panelTitle.textContent='INPUT RESPONSES';
  const panelCount=document.createElement('span');
  panelCount.dataset.monitorWindowCount='';
  panelCount.textContent='0 inputs';
  panelHead.append(panelTitle,panelCount);
  const panelList=document.createElement('div');
  panelList.className='monitor-window-input-list';
  panel.append(panelHead,panelList);

  main.append(graphs,panel);
  body.append(toolbar,main);
  win.append(head,body);
  document.body.appendChild(win);

  head.addEventListener('pointerdown',event=>startWindowDrag(event,win,monitor));
  win.addEventListener('pointerdown',()=>bringToFront(win));

  requestAnimationFrame(()=>{
    const initial=monitor.windowPosition||{
      x:Math.max(6,(window.innerWidth-win.offsetWidth)/2),
      y:Math.max(6,(window.innerHeight-win.offsetHeight)/2)
    };
    const pos=clampWindowPosition(initial.x,initial.y,win);
    win.style.left=pos.x+'px';
    win.style.top=pos.y+'px';
    monitor.windowPosition=pos;
  });
  renderWindow(monitor,win);
  return win;
}

function openWindow(monitorId){
  const monitor=monitorById(monitorId);
  if(!monitor) return null;
  let win=windows.get(monitorId);
  if(!win||!win.isConnected){
    win=buildWindow(monitor);
    windows.set(monitorId,win);
  }
  win.hidden=false;
  renderWindow(monitor,win);
  bringToFront(win);
  return win;
}

function refreshMonitor(monitor){
  const win=windows.get(monitor.id);
  if(win&&!win.hidden) renderWindow(monitor,win);
}

function refreshAll(){
  if(!activeCard) return;
  renderNodes();
  activeMonitors().forEach(refreshMonitor);
}

document.addEventListener('pointerdown',event=>{
  const handle=event.target.closest?.('.mpgd-filter-output,.xo-filter-output');
  if(handle) startProcessorWire(event,handle);
},true);

document.addEventListener('raptor:pipelinefilterrequest',event=>{
  if(event.detail?.filterType!==TYPE||!activeCard) return;
  createMonitor(Number(event.detail.x)||680,Number(event.detail.y)||140);
});

document.addEventListener('raptor:pipelinedisconnectrequest',event=>{
  const wireId=String(event.detail?.wireId||'');
  if(!wireId.startsWith('monitor-input:')) return;
  const rest=wireId.slice('monitor-input:'.length);
  const separator=rest.indexOf(':monitor-input-');
  if(separator<0) return;
  const monitorId=rest.slice(0,separator);
  const inputId=rest.slice(separator+1);
  const monitor=monitorById(monitorId);
  if(monitor) removeInput(monitor,inputId);
});

for(const name of [
  'raptor:filteroutputchange',
  'raptor:crossoverfilterchange',
  'raptor:filterbypasschange',
  'raptor:filterinputchange',
  'raptor:filterdeleted'
]){
  document.addEventListener(name,()=>{
    if(!activeCard) return;
    activeMonitors().forEach(refreshMonitor);
    requestAnimationFrame(renderConnections);
  });
}

document.addEventListener('keydown',event=>{
  if(event.key!=='Escape') return;
  const front=[...windows.values()]
    .filter(win=>!win.hidden)
    .sort((a,b)=>(Number(b.style.zIndex)||0)-(Number(a.style.zIndex)||0))[0];
  if(front) front.hidden=true;
});

const baseCreate=api.createState?.bind(api);
if(baseCreate){
  api.createState=()=>{
    const state=baseCreate();
    if(!state.nodes) state.nodes={};
    state.nodes.monitors=[];
    return state;
  };
}

const baseClone=api.cloneState?.bind(api);
if(baseClone){
  api.cloneState=state=>{
    const clone=baseClone(state);
    if(!clone.nodes) clone.nodes={};
    clone.nodes.monitors=Array.isArray(state?.nodes?.monitors)
      ?state.nodes.monitors.map(monitor=>cloneMonitor(monitor,true))
      :[];
    return clone;
  };
}

const baseLoad=api.load?.bind(api);
if(baseLoad){
  api.load=card=>{
    windows.forEach(win=>win.remove());
    windows.clear();
    baseLoad(card);
    activeCard=card;
    ensureMonitors(card);
    renderNodes();
  };
}

const baseDelete=api.onDelete?.bind(api);
if(baseDelete){
  api.onDelete=card=>{
    if(card===activeCard){
      windows.forEach(win=>win.remove());
      windows.clear();
      activeCard=null;
      removeRenderedNodes();
      ensureWireGroup().replaceChildren();
    }
    baseDelete(card);
  };
}

new MutationObserver(()=>{
  if(!activeCard) return;
  activeMonitors().forEach(refreshMonitor);
  requestAnimationFrame(renderConnections);
}).observe(measurementList,{childList:true,subtree:false});

new MutationObserver(()=>requestAnimationFrame(renderConnections))
  .observe(measurementNode,{attributes:true,attributeFilter:['style']});
new ResizeObserver(()=>requestAnimationFrame(renderConnections)).observe(measurementNode);
canvas.addEventListener('scroll',()=>requestAnimationFrame(renderConnections),{passive:true});

window.addEventListener('resize',()=>{
  renderConnections();
  for(const [id,win] of windows){
    if(win.hidden) continue;
    const monitor=monitorById(id);
    if(!monitor) continue;
    const rect=win.getBoundingClientRect();
    const pos=clampWindowPosition(rect.left,rect.top,win);
    win.style.left=pos.x+'px';
    win.style.top=pos.y+'px';
    monitor.windowPosition=pos;
  }
});

window.RaptorMonitor=Object.freeze({
  type:TYPE,
  createAt:createMonitor,
  list:()=>activeMonitors().map(monitor=>cloneMonitor(monitor,false)),
  get:monitorId=>{
    const monitor=monitorById(monitorId);
    return monitor?cloneMonitor(monitor,false):null;
  },
  open:openWindow,
  evaluate(monitorId){
    const monitor=monitorById(monitorId);
    if(!monitor) return null;
    const evaluation=monitorEvaluation(monitor);
    return Object.freeze({
      compatibility:evaluation.compatibility,
      sum:evaluation.sum,
      inputCount:monitor.inputs.length,
      liveResponseCount:evaluation.responses.length
    });
  },
  disconnect(monitorId,inputId){
    const monitor=monitorById(monitorId);
    return monitor?removeInput(monitor,inputId):false;
  },
  delete:deleteMonitor,
  refresh:refreshAll,
  refreshConnections:renderConnections
});
})();