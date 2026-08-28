(()=>{
'use strict';

const TOOL_IDS=['raptor-editor','nga-editor','nga-auto-zero'];
const F0=20;
const F1=20000;
const WIDTH=1000;
const HEIGHT=220;
const MAX_DISPLAY_POINTS=1800;
const SVG_NS='http://www.w3.org/2000/svg';
const FREQ_TICKS=[
  20,40,80,
  100,200,300,400,500,600,700,800,900,
  1000,2000,3000,4000,5000,6000,7000,8000,9000,
  10000,15000
];

const VIEW_STATES=new Map(TOOL_IDS.map(id=>[id,{v0:F0,v1:F1}]));
const UI_STATES=new Map(TOOL_IDS.map(id=>[id,{
  phase:true,
  magnitude:true,
  wrap:false,
  sync:true
}]));

function eqGeometryForTool(toolId){
  if(toolId==='raptor-editor') return window.RaptorEditorEqGeometry||null;
  if(toolId==='nga-editor') return window.NgaEditorEqGeometry||null;
  return null;
}

function deriveDisplayViews(toolId,body,entry,canonical,views){
  const geometry=eqGeometryForTool(toolId);
  if(!geometry||!body||!views){
    if(body){
      body._raptorDisplayViews=views||null;
      body.dataset.eqGeometry='none';
      delete body.dataset.eqGeometryError;
    }
    return views;
  }

  const operations=geometry.getOperations(body);
  if(!operations.length){
    body._raptorDisplayViews=views;
    body.dataset.eqGeometry='idle';
    delete body.dataset.eqGeometryError;
    return views;
  }

  const sampleRate=Number(
    entry?.sampleRate ??
    canonical?.sample_rate_hz ??
    body._raptorInput?.context?.sampleRate ??
    NaN
  );

  if(!Number.isFinite(sampleRate)||sampleRate<=0){
    body._raptorDisplayViews=views;
    body.dataset.eqGeometry='blocked-no-sample-rate';
    body.dataset.eqGeometryError='Authoritative sample rate required';
    return views;
  }

  try{
    const derived=geometry.deriveViews(body,views,sampleRate);
    body._raptorDisplayViews=derived;
    body.dataset.eqGeometry='applied';
    body.dataset.eqGeometryOperations=String(operations.length);
    delete body.dataset.eqGeometryError;
    return derived;
  }catch(error){
    body._raptorDisplayViews=views;
    body.dataset.eqGeometry='error';
    body.dataset.eqGeometryError=error instanceof Error?error.message:String(error);
    return views;
  }
}

function log10(value){return Math.log(value)/Math.LN10;}

function xOf(frequency,state){
  const a=log10(state.v0);
  const b=log10(state.v1);
  return (log10(frequency)-a)/(b-a)*WIDTH;
}

function frequencyAtRatio(ratio,state){
  const a=Math.log(state.v0);
  const b=Math.log(state.v1);
  return Math.exp(a+Math.max(0,Math.min(1,ratio))*(b-a));
}

function formatFrequency(value,withUnit=false){
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

function yPhase(value){
  const v=Math.max(-180,Math.min(180,value));
  return HEIGHT-((v+180)/360)*HEIGHT;
}

function yMagnitude(value){
  const v=Math.max(-40,Math.min(40,value));
  return HEIGHT-((v+40)/80)*HEIGHT;
}

function pointsInDisplayRange(frequency,state,phase=null,coherence=null){
  const indices=[];
  for(let i=0;i<frequency.length;i++){
    const f=frequency[i];
    if(Number.isFinite(f)&&f>=state.v0&&f<=state.v1) indices.push(i);
  }
  if(indices.length<=MAX_DISPLAY_POINTS) return indices;

  const selected=new Set();
  const stride=(indices.length-1)/(MAX_DISPLAY_POINTS-1);
  for(let n=0;n<MAX_DISPLAY_POINTS;n++){
    selected.add(indices[Math.min(indices.length-1,Math.round(n*stride))]);
  }

  // Preserve samples immediately around every wrapped-phase boundary so
  // display decimation cannot erase a real ±180° crossing.
  if(phase){
    for(let n=1;n<indices.length;n++){
      const a=indices[n-1];
      const b=indices[n];
      const p0=phase[a];
      const p1=phase[b];
      if(Number.isFinite(p0)&&Number.isFinite(p1)&&Math.abs(p1-p0)>180){
        selected.add(a);
        selected.add(b);
      }
    }
  }

  // Preserve the worst coherence sample in each display bucket so a narrow
  // low-confidence region cannot disappear merely because of decimation.
  if(coherence){
    const bucketCount=Math.min(MAX_DISPLAY_POINTS,indices.length);
    for(let bucket=0;bucket<bucketCount;bucket++){
      const start=Math.floor(bucket*indices.length/bucketCount);
      const end=Math.min(indices.length,Math.max(start+1,Math.floor((bucket+1)*indices.length/bucketCount)));
      let worstIndex=null;
      let worstValue=Infinity;
      for(let n=start;n<end;n++){
        const i=indices[n];
        const value=coherence[i];
        if(Number.isFinite(value)&&value<worstValue){
          worstValue=value;
          worstIndex=i;
        }
      }
      if(worstIndex!==null) selected.add(worstIndex);
    }
  }

  return [...selected].sort((a,b)=>a-b);
}

function phasePath(frequency,phase,indices,state){
  let path='';
  let previousIndex=null;

  for(const i of indices){
    const f1=frequency[i];
    const p1=phase[i];
    if(!Number.isFinite(f1)||!Number.isFinite(p1)) continue;

    const x1=xOf(f1,state);
    const y1=yPhase(p1);

    if(previousIndex===null){
      path+='M'+x1.toFixed(2)+' '+y1.toFixed(2)+' ';
      previousIndex=i;
      continue;
    }

    const f0=frequency[previousIndex];
    const p0=phase[previousIndex];
    const x0=xOf(f0,state);
    const delta=p1-p0;

    if(Number.isFinite(f0)&&Number.isFinite(p0)&&Math.abs(delta)>180){
      // Follow the shortest continuous 360° branch to the real wrap
      // boundary, terminate exactly at ±180°, then resume from the
      // opposite boundary at the same log-frequency position.
      let adjustedP1=p1;
      let boundary=180;
      let opposite=-180;

      if(delta>180){
        adjustedP1=p1-360;
        boundary=-180;
        opposite=180;
      }else{
        adjustedP1=p1+360;
        boundary=180;
        opposite=-180;
      }

      const denominator=adjustedP1-p0;
      let t=denominator===0?0:(boundary-p0)/denominator;
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

function magnitudePath(frequency,magnitude,indices,state){
  let path='';
  for(const i of indices){
    const f=frequency[i];
    const value=magnitude[i];
    if(!Number.isFinite(f)||!Number.isFinite(value)) continue;
    const x=xOf(f,state);
    const y=yMagnitude(value);
    path+=(path?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)+' ';
  }
  return path.trim();
}

function fillPath(linePath,frequency,indices,state){
  if(!linePath||!indices.length) return '';
  const first=frequency[indices[0]];
  const last=frequency[indices[indices.length-1]];
  if(!(Number.isFinite(first)&&Number.isFinite(last))) return '';
  return linePath+' L'+xOf(last,state).toFixed(2)+' '+HEIGHT+' L'+xOf(first,state).toFixed(2)+' '+HEIGHT+' Z';
}

function coherenceLossPath(frequency,coherence,indices,state){
  if(!coherence||!indices.length) return '';

  const points=[];
  for(const i of indices){
    const f=frequency[i];
    const value=coherence[i];
    if(!Number.isFinite(f)||!Number.isFinite(value)) continue;
    const c=Math.max(0,Math.min(1,value));
    const x=xOf(f,state);
    const y=(1-c)*HEIGHT;
    points.push([x,y]);
  }

  if(!points.length) return '';
  let path='M'+points[0][0].toFixed(2)+' 0 ';
  path+='L'+points[0][0].toFixed(2)+' '+points[0][1].toFixed(2)+' ';
  for(let i=1;i<points.length;i++){
    path+='L'+points[i][0].toFixed(2)+' '+points[i][1].toFixed(2)+' ';
  }
  path+='L'+points[points.length-1][0].toFixed(2)+' 0 Z';
  return path;
}

function ensureCoherenceLossPath(svg){
  if(!svg) return null;
  let path=svg.querySelector('.editor-foundation-coherence-loss');
  if(path) return path;

  path=document.createElementNS(SVG_NS,'path');
  path.classList.add('editor-foundation-coherence-loss');

  const line=[...svg.querySelectorAll('path')]
    .find(node=>!node.classList.contains('editor-foundation-fill')&&!node.classList.contains('editor-foundation-coherence-loss'));
  if(line) svg.insertBefore(path,line);
  else svg.appendChild(path);
  return path;
}

function currentInput(toolId){
  const body=document.querySelector('[data-tool-body="'+toolId+'"]');
  const workspace=window.RaptorWorkspace?.getToolInput?.(toolId)||null;
  return {
    body,
    entry:workspace?.entry||body?._raptorInput?.entry||null,
    canonical:workspace?.canonical||body?._raptorInput?.canonical||null,
    views:workspace?.views||body?._raptorInput?.views||null
  };
}

function formatGridFrequency(value){
  return value>=1000?(value/1000)+'k':String(value);
}

function updateFrequencyGrid(body,state){
  for(const grid of body.querySelectorAll('.editor-foundation-axis')){
    grid.querySelectorAll('.editor-frequency-grid-line').forEach(node=>node.remove());
    for(const frequency of FREQ_TICKS){
      if(frequency<state.v0||frequency>state.v1) continue;
      const pct=xOf(frequency,state)/WIDTH*100;
      const line=document.createElement('span');
      line.className='editor-frequency-grid-line';
      line.style.left=pct+'%';
      line.setAttribute('aria-hidden','true');
      grid.appendChild(line);
    }
  }
}

function updateXAxis(body,state){
  for(const axis of body.querySelectorAll('.editor-foundation-x')){
    axis.replaceChildren();
    for(const frequency of FREQ_TICKS){
      if(frequency<state.v0||frequency>state.v1) continue;
      const pct=xOf(frequency,state)/WIDTH*100;
      const label=document.createElement('span');
      label.textContent=formatGridFrequency(frequency);
      label.style.left=pct+'%';
      if(pct<1.5) label.style.transform='translateX(2px)';
      else if(pct>98.5) label.style.transform='translateX(calc(-100% - 2px))';
      axis.appendChild(label);
    }
  }
  updateFrequencyGrid(body,state);
}

function updateTraceVisibility(body,ui){
  const phaseSvg=body.querySelector('.editor-foundation-trace--phase');
  const magSvg=body.querySelector('.editor-foundation-trace--mag');
  if(phaseSvg) phaseSvg.style.opacity=ui.phase?'1':'0';
  if(magSvg) magSvg.style.opacity=ui.magnitude?'1':'0';

  for(const marker of body.querySelectorAll('.editor-wrap-marker')){
    marker.style.display=ui.phase&&ui.wrap?'':'none';
  }
}

function clearWrapMarkers(body){
  body.querySelectorAll('.editor-wrap-marker').forEach(node=>node.remove());
}

function renderWrapMarkers(body,frequency,phase,indices,state,ui){
  clearWrapMarkers(body);
  if(!ui.phase||!ui.wrap||indices.length<2) return;

  const svg=body.querySelector('.editor-foundation-trace--phase');
  if(!svg) return;

  let previousIndex=indices[0];
  let count=0;
  for(let n=1;n<indices.length;n++){
    const i=indices[n];
    const previous=phase[previousIndex];
    const current=phase[i];
    if(Number.isFinite(previous)&&Number.isFinite(current)&&Math.abs(current-previous)>300){
      const f=frequency[i];
      if(Number.isFinite(f)&&f>=state.v0&&f<=state.v1){
        const x=xOf(f,state);
        const line=document.createElementNS(SVG_NS,'line');
        line.classList.add('editor-wrap-marker');
        line.setAttribute('x1',x.toFixed(2));
        line.setAttribute('x2',x.toFixed(2));
        line.setAttribute('y1','0');
        line.setAttribute('y2',String(HEIGHT));
        svg.appendChild(line);
        count++;
        if(count>=96) break;
      }
    }
    previousIndex=i;
  }
}

function ensureCursorOverlay(svg){
  if(!svg) return null;

  let vertical=svg.querySelector('.editor-cursor-line--vertical');
  let horizontal=svg.querySelector('.editor-cursor-line--horizontal');
  let point=svg.querySelector('.editor-cursor-point');

  if(!vertical){
    vertical=document.createElementNS(SVG_NS,'line');
    vertical.classList.add('editor-cursor-line','editor-cursor-line--vertical');
    vertical.setAttribute('y1','0');
    vertical.setAttribute('y2',String(HEIGHT));
    vertical.hidden=true;
    svg.appendChild(vertical);
  }

  if(!horizontal){
    horizontal=document.createElementNS(SVG_NS,'line');
    horizontal.classList.add('editor-cursor-line','editor-cursor-line--horizontal');
    horizontal.setAttribute('x1','0');
    horizontal.setAttribute('x2',String(WIDTH));
    horizontal.hidden=true;
    svg.appendChild(horizontal);
  }

  if(!point){
    point=document.createElementNS(SVG_NS,'circle');
    point.classList.add('editor-cursor-point');
    point.setAttribute('r','3');
    point.hidden=true;
    svg.appendChild(point);
  }

  return {vertical,horizontal,point};
}

function setCursorOverlay(overlay,x,y,visible){
  if(!overlay) return;
  overlay.vertical.setAttribute('x1',x.toFixed(2));
  overlay.vertical.setAttribute('x2',x.toFixed(2));
  overlay.horizontal.setAttribute('y1',y.toFixed(2));
  overlay.horizontal.setAttribute('y2',y.toFixed(2));
  overlay.point.setAttribute('cx',x.toFixed(2));
  overlay.point.setAttribute('cy',y.toFixed(2));
  overlay.vertical.hidden=!visible;
  overlay.horizontal.hidden=!visible;
  overlay.point.hidden=!visible;
}

function hideCursors(body){
  body.querySelectorAll('.editor-cursor-line,.editor-cursor-point').forEach(node=>{node.hidden=true;});
}

function ensurePointerReadouts(body){
  for(const card of body.querySelectorAll('.matching-card')){
    const head=card.querySelector('.matching-head');
    const lineReadout=head?.querySelector('.matching-readout');
    const plot=card.querySelector('.editor-foundation-plot');
    if(!head||!lineReadout||!plot) continue;

    const kind=plot.classList.contains('editor-foundation-plot--phase')?'phase':'magnitude';
    let readout=head.querySelector('.matching-pointer-readout');
    if(!readout){
      readout=document.createElement('div');
      readout.className='matching-pointer-readout';
      readout.dataset.pointerKind=kind;
      lineReadout.insertAdjacentElement('afterend',readout);
    }
    readout.textContent=kind==='phase'?'— Hz · —°':'— Hz · — dB';
  }
}

function resetPointerReadout(body,plotKind){
  const readout=body.querySelector('.matching-pointer-readout[data-pointer-kind="'+plotKind+'"]');
  if(readout) readout.textContent=plotKind==='phase'?'— Hz · —°':'— Hz · — dB';
}

function showPointerCoordinate(toolId,plotKind,plot,event){
  const state=VIEW_STATES.get(toolId);
  const body=document.querySelector('[data-tool-body="'+toolId+'"]');
  if(!state||!body) return;

  const ratio=Math.max(0,Math.min(1,ratioForPointer(plot,event)));
  const frequency=frequencyAtRatio(ratio,state);
  const value=pointerValueForPlot(plotKind,plot,event);

  const readout=body.querySelector('.matching-pointer-readout[data-pointer-kind="'+plotKind+'"]');
  if(!readout) return;
  readout.textContent=plotKind==='phase'
    ?formatFrequency(frequency,true)+' · '+value.toFixed(1)+'°'
    :formatFrequency(frequency,true)+' · '+value.toFixed(2)+' dB';
}

function pointerValueForPlot(plotKind,plot,event){
  const rect=plot.getBoundingClientRect();
  const top=4;
  const bottom=4;
  const usable=Math.max(1,rect.height-top-bottom);
  const yRatio=Math.max(0,Math.min(1,(event.clientY-rect.top-top)/usable));
  return plotKind==='phase'
    ?180-yRatio*360
    :40-yRatio*80;
}

function wrappedPhaseDelta(target,reference){
  let delta=target-reference;
  while(delta>180) delta-=360;
  while(delta<=-180) delta+=360;
  return delta;
}

let graphContextMenu=null;
let graphContextRequest=null;

function ensureGraphContextMenu(){
  if(graphContextMenu) return graphContextMenu;

  const menu=document.createElement('div');
  menu.className='editor-graph-context';
  menu.hidden=true;
  menu.setAttribute('role','menu');
  menu.innerHTML=
    '<div class="editor-graph-context-meta" data-context-meta>—</div>'+
    '<button class="editor-graph-context-action" type="button" role="menuitem" data-context-action="add-band">Add Band</button>';

  menu.querySelector('[data-context-action="add-band"]')?.addEventListener('click',()=>{
    const request=graphContextRequest;
    closeGraphContextMenu();
    if(!request||request.disabled) return;
    document.dispatchEvent(new CustomEvent('raptor:addbandrequest',{detail:{...request}}));
  });

  document.body.appendChild(menu);
  graphContextMenu=menu;
  return menu;
}

function closeGraphContextMenu(){
  if(!graphContextMenu) return;
  graphContextMenu.hidden=true;
  graphContextRequest=null;
}

function positionGraphContextMenu(menu,event){
  menu.hidden=false;
  menu.style.left='0px';
  menu.style.top='0px';

  const rect=menu.getBoundingClientRect();
  const gap=6;
  const left=Math.min(
    window.innerWidth-rect.width-gap,
    Math.max(gap,event.clientX)
  );
  const top=Math.min(
    window.innerHeight-rect.height-gap,
    Math.max(gap,event.clientY)
  );

  menu.style.left=Math.round(left)+'px';
  menu.style.top=Math.round(top)+'px';
}

function openGraphContextMenu(toolId,plotKind,plot,event){
  if(toolId!=='raptor-editor'&&toolId!=='nga-editor') return;

  event.preventDefault();
  event.stopPropagation();

  const state=VIEW_STATES.get(toolId);
  const {body,canonical,views}=currentInput(toolId);
  const displayViews=body?._raptorDisplayViews||views;
  if(!state||!body) return;

  const ratio=Math.max(0,Math.min(1,ratioForPointer(plot,event)));
  const frequencyHz=frequencyAtRatio(ratio,state);
  const pointerValue=pointerValueForPlot(plotKind,plot,event);

  let nearestIndexValue=null;
  let nearestFrequencyHz=null;
  let curveValue=null;
  let deltaFromCurve=null;

  if(displayViews?.frequency_hz){
    nearestIndexValue=nearestIndex(displayViews.frequency_hz,frequencyHz);
    nearestFrequencyHz=displayViews.frequency_hz[nearestIndexValue];
    const source=plotKind==='phase'?displayViews.phase_deg:displayViews.magnitude_db;
    curveValue=source?.[nearestIndexValue];
    if(Number.isFinite(curveValue)){
      deltaFromCurve=plotKind==='phase'
        ?wrappedPhaseDelta(pointerValue,curveValue)
        :pointerValue-curveValue;
    }
  }

  const geometry=eqGeometryForTool(toolId);
  const contextKey=geometry?.contextKey?.(body)||null;
  const disabled=!canonical||!contextKey;
  graphContextRequest=Object.freeze({
    toolId,
    graphKind:plotKind,
    pipelineId:body.dataset.pipelineId||null,
    measurementId:body.dataset.measurementId||null,
    slot:body.dataset.slot||null,
    contextKey,
    frequencyHz,
    pointerValue,
    curveValue:Number.isFinite(curveValue)?curveValue:null,
    deltaFromCurve:Number.isFinite(deltaFromCurve)?deltaFromCurve:null,
    nearestFrequencyHz:Number.isFinite(nearestFrequencyHz)?nearestFrequencyHz:null,
    nearestIndex:Number.isInteger(nearestIndexValue)?nearestIndexValue:null,
    disabled
  });

  const menu=ensureGraphContextMenu();
  const meta=menu.querySelector('[data-context-meta]');
  const add=menu.querySelector('[data-context-action="add-band"]');
  if(meta){
    const unit=plotKind==='phase'?'°':' dB';
    const digits=plotKind==='phase'?1:2;
    meta.textContent=formatFrequency(frequencyHz,true)+' · '+pointerValue.toFixed(digits)+unit;
  }
  if(add){
    add.disabled=disabled;
    add.title=disabled?'Connect a Pipeline measurement first':'Add a new editable EQ band here';
  }

  positionGraphContextMenu(menu,event);
}

function nearestIndex(frequency,target){
  let lo=0,hi=frequency.length-1;
  while(lo<hi){
    const mid=(lo+hi)>>1;
    if(frequency[mid]<target) lo=mid+1;
    else hi=mid;
  }
  if(lo<=0) return 0;
  if(lo>=frequency.length) return frequency.length-1;
  const prev=lo-1;
  return Math.abs(frequency[lo]-target)<Math.abs(frequency[prev]-target)?lo:prev;
}

function restoreReadouts(toolId){
  const state=VIEW_STATES.get(toolId);
  const {body,entry,canonical}=currentInput(toolId);
  if(!body) return;
  const readouts=[...body.querySelectorAll('.matching-readout')];

  if(!canonical){
    if(readouts[0]) readouts[0].textContent='No Pipeline input';
    if(readouts[1]) readouts[1].textContent='No Pipeline input';
    return;
  }

  const name=entry?.name||canonical.source_name||'Pipeline measurement';
  const range=formatFrequency(state.v0)+'–'+formatFrequency(state.v1)+' Hz';
  if(readouts[0]) readouts[0].textContent=name+' · '+range;
  if(readouts[1]) readouts[1].textContent=name+' · '+range;
}

function showCursor(toolId,plotKind,ratio){
  const state=VIEW_STATES.get(toolId);
  const ui=UI_STATES.get(toolId);
  const {body,views}=currentInput(toolId);
  const displayViews=body?._raptorDisplayViews||views;
  if(!body||!displayViews?.frequency_hz) return;

  const frequency=displayViews.frequency_hz;
  const phase=displayViews.phase_deg;
  const magnitude=displayViews.magnitude_db;
  const target=frequencyAtRatio(ratio,state);
  const index=nearestIndex(frequency,target);
  const f=frequency[index];

  if(!Number.isFinite(f)||f<state.v0||f>state.v1) return;

  const x=xOf(f,state);
  const phaseValue=phase[index];
  const magnitudeValue=magnitude[index];
  const phaseY=yPhase(phaseValue);
  const magnitudeY=yMagnitude(magnitudeValue);

  const phaseSvg=body.querySelector('.editor-foundation-trace--phase');
  const magSvg=body.querySelector('.editor-foundation-trace--mag');
  const phaseCursor=ensureCursorOverlay(phaseSvg);
  const magCursor=ensureCursorOverlay(magSvg);

  setCursorOverlay(
    phaseCursor,
    x,
    phaseY,
    !!ui.phase&&(ui.sync||plotKind==='phase')
  );
  setCursorOverlay(
    magCursor,
    x,
    magnitudeY,
    !!ui.magnitude&&(ui.sync||plotKind==='magnitude')
  );

  const readouts=[...body.querySelectorAll('.matching-readout')];
  if((ui.sync||plotKind==='phase')&&readouts[0]){
    readouts[0].textContent=formatFrequency(f,true)+' · '+(Number.isFinite(phase[index])?phase[index].toFixed(1)+'°':'—°');
  }
  if((ui.sync||plotKind==='magnitude')&&readouts[1]){
    readouts[1].textContent=formatFrequency(f,true)+' · '+(Number.isFinite(magnitude[index])?magnitude[index].toFixed(2)+' dB':'— dB');
  }
}

function setEmpty(body,state){
  const phasePathEl=body.querySelector('.editor-foundation-trace--phase path');
  const magSvg=body.querySelector('.editor-foundation-trace--mag');
  const magFill=magSvg?.querySelector('.editor-foundation-fill');
  const coherenceLoss=magSvg?.querySelector('.editor-foundation-coherence-loss');
  const magLine=magSvg?[...magSvg.querySelectorAll('path')].find(path=>!path.classList.contains('editor-foundation-fill')&&!path.classList.contains('editor-foundation-coherence-loss')):null;
  phasePathEl?.setAttribute('d','');
  magFill?.setAttribute('d','');
  coherenceLoss?.setAttribute('d','');
  magLine?.setAttribute('d','');
  clearWrapMarkers(body);
  hideCursors(body);
  body._raptorDisplayViews=null;
  body.dataset.eqGeometry='none';
  delete body.dataset.eqGeometryOperations;
  delete body.dataset.eqGeometryError;

  const readouts=[...body.querySelectorAll('.matching-readout')];
  if(readouts[0]) readouts[0].textContent='No Pipeline input';
  if(readouts[1]) readouts[1].textContent='No Pipeline input';

  updateXAxis(body,state);
  body.dataset.graphInput='empty';
}

function render(toolId,input=null){
  const state=VIEW_STATES.get(toolId)||{v0:F0,v1:F1};
  const ui=UI_STATES.get(toolId);
  const body=input?.body||document.querySelector('[data-tool-body="'+toolId+'"]');
  if(!body) return;

  const fallback=currentInput(toolId);
  const canonical=input?.canonical||fallback.canonical;
  const views=input?.views||fallback.views;
  const entry=input?.entry||fallback.entry;

  if(!canonical||!views){
    setEmpty(body,state);
    updateTraceVisibility(body,ui);
    return;
  }

  try{
    window.RaptorMeasurementCanonicalV1?.validate?.(canonical);
  }catch(error){
    setEmpty(body,state);
    body.dataset.graphInput='error';
    return;
  }

  const displayViews=deriveDisplayViews(toolId,body,entry,canonical,views);
  const frequency=displayViews?.frequency_hz;
  const magnitude=displayViews?.magnitude_db;
  const phase=displayViews?.phase_deg;
  const coherence=displayViews?.coherence||null;
  if(!frequency||!magnitude||!phase){
    setEmpty(body,state);
    return;
  }

  const indices=pointsInDisplayRange(frequency,state,phase,coherence);
  if(!indices.length){
    setEmpty(body,state);
    body.dataset.graphInput='out-of-range';
    return;
  }

  const pPath=phasePath(frequency,phase,indices,state);
  const mPath=magnitudePath(frequency,magnitude,indices,state);
  const mFill=fillPath(mPath,frequency,indices,state);
  const uncertaintyPath=coherenceLossPath(frequency,coherence,indices,state);

  const phasePathEl=body.querySelector('.editor-foundation-trace--phase path');
  const magSvg=body.querySelector('.editor-foundation-trace--mag');
  const magFillEl=magSvg?.querySelector('.editor-foundation-fill');
  const coherenceLossEl=ensureCoherenceLossPath(magSvg);
  const magLineEl=magSvg?[...magSvg.querySelectorAll('path')].find(path=>!path.classList.contains('editor-foundation-fill')&&!path.classList.contains('editor-foundation-coherence-loss')):null;

  phasePathEl?.setAttribute('d',pPath);
  magFillEl?.setAttribute('d',mFill);
  coherenceLossEl?.setAttribute('d',uncertaintyPath);
  magLineEl?.setAttribute('d',mPath);

  renderWrapMarkers(body,frequency,phase,indices,state,ui);
  updateTraceVisibility(body,ui);
  hideCursors(body);
  restoreReadouts(toolId);
  updateXAxis(body,state);

  body.dataset.graphInput='canonical-v1';
  body.dataset.coherenceOverlay=coherence?'loss-fill':'none';
  body.dataset.displayPoints=String(indices.length);
  body.dataset.viewMin=String(state.v0);
  body.dataset.viewMax=String(state.v1);
}

function fit(toolId){
  const state=VIEW_STATES.get(toolId);
  if(!state) return;
  state.v0=F0;
  state.v1=F1;
  render(toolId);
}

function zoom(toolId,ratio,deltaY){
  const state=VIEW_STATES.get(toolId);
  if(!state) return;

  const anchor=frequencyAtRatio(ratio,state);
  const scale=Math.exp(deltaY*.0012);
  const la=Math.log(state.v0);
  const lb=Math.log(state.v1);
  const lp=Math.log(anchor);

  let next0=Math.exp(lp+(la-lp)*scale);
  let next1=Math.exp(lp+(lb-lp)*scale);
  if(next1/next0<1.06) return;

  const spanRatio=next1/next0;
  if(next0<F0){
    next0=F0;
    next1=Math.min(F1,next0*spanRatio);
  }
  if(next1>F1){
    next1=F1;
    next0=Math.max(F0,next1/spanRatio);
  }

  state.v0=next0;
  state.v1=next1;
  render(toolId);
}

function ratioForPointer(plot,event){
  const rect=plot.getBoundingClientRect();
  const left=4;
  const right=4;
  const usable=Math.max(1,rect.width-left-right);
  return (event.clientX-rect.left-left)/usable;
}

function bindControls(toolId,body){
  const checks=[...body.querySelectorAll('.matching-check input')];
  const ui=UI_STATES.get(toolId);
  const keys=['phase','magnitude','wrap','sync'];

  checks.slice(0,4).forEach((check,index)=>{
    check.checked=ui[keys[index]];
    check.addEventListener('change',()=>{
      ui[keys[index]]=check.checked;
      if(keys[index]==='sync'&&!check.checked) hideCursors(body);
      render(toolId);
    });
  });
}

function bindDockControls(toolId,body){
  const inspector=body.querySelector('[data-editor-inspector]');
  const modeButtons=[...body.querySelectorAll('.editor-dock-btn[data-editor-dock]:not([disabled])')]
    .filter(button=>!['undo','redo','apply'].includes(button.dataset.editorDock));

  modeButtons.forEach(button=>{
    button.addEventListener('click',()=>{
      modeButtons.forEach(item=>item.classList.toggle('is-active',item===button));
      body.dataset.editorMode=button.dataset.editorDock||'edit';
    });
  });

  const inspectorButton=body.querySelector('[data-editor-action="inspector"]');
  const closeButton=body.querySelector('[data-editor-action="close-inspector"]');

  inspectorButton?.addEventListener('click',()=>{
    if(!inspector) return;
    const opening=inspector.hidden;
    inspector.hidden=!opening;
    inspectorButton.classList.toggle('is-active',opening);
    inspectorButton.setAttribute('aria-pressed',opening?'true':'false');
  });

  closeButton?.addEventListener('click',()=>{
    if(!inspector) return;
    inspector.hidden=true;
    inspectorButton?.classList.remove('is-active');
    inspectorButton?.setAttribute('aria-pressed','false');
  });
}

function bindGraphInteraction(toolId){
  const body=document.querySelector('[data-tool-body="'+toolId+'"]');
  if(!body||body.dataset.graphInteractionBound==='1') return;
  body.dataset.graphInteractionBound='1';

  bindControls(toolId,body);
  bindDockControls(toolId,body);
  ensurePointerReadouts(body);

  body.querySelectorAll('.editor-foundation-plot').forEach(plot=>{
    const plotKind=plot.classList.contains('editor-foundation-plot--phase')?'phase':'magnitude';

    if(plotKind==='magnitude'){
      plot.addEventListener('wheel',event=>{
        event.preventDefault();
        event.stopPropagation();
        zoom(toolId,ratioForPointer(plot,event),event.deltaY);
      },{passive:false});
    }

    plot.addEventListener('pointermove',event=>{
      showPointerCoordinate(toolId,plotKind,plot,event);
      showCursor(toolId,plotKind,ratioForPointer(plot,event));
    });

    if(toolId==='raptor-editor'||toolId==='nga-editor'){
      plot.addEventListener('contextmenu',event=>{
        openGraphContextMenu(toolId,plotKind,plot,event);
      });
    }

    plot.addEventListener('pointerleave',()=>{
      hideCursors(body);
      restoreReadouts(toolId);
      resetPointerReadout(body,plotKind);
    });

    plot.addEventListener('dblclick',event=>{
      event.preventDefault();
      fit(toolId);
    });
  });

  body.querySelector('[data-editor-action="fit"]')?.addEventListener('click',()=>fit(toolId));
}

document.addEventListener('pointerdown',event=>{
  if(graphContextMenu&&!graphContextMenu.hidden&&!graphContextMenu.contains(event.target)){
    closeGraphContextMenu();
  }
});

document.addEventListener('keydown',event=>{
  if(event.key==='Escape') closeGraphContextMenu();
});

window.addEventListener('resize',closeGraphContextMenu);
window.addEventListener('scroll',closeGraphContextMenu,true);

document.addEventListener('raptor:toolinput',event=>{
  const toolId=event.detail?.toolId;
  if(!TOOL_IDS.includes(toolId)) return;
  const body=document.querySelector('[data-tool-body="'+toolId+'"]');
  render(toolId,{
    body,
    entry:body?._raptorInput?.entry||null,
    canonical:event.detail?.canonical||body?._raptorInput?.canonical||null,
    views:event.detail?.views||body?._raptorInput?.views||null
  });
});

document.addEventListener('raptor:eqgeometrychange',event=>{
  const toolId=event.detail?.toolId;
  if(toolId!=='raptor-editor'&&toolId!=='nga-editor') return;
  render(toolId);
});

for(const toolId of TOOL_IDS){
  bindGraphInteraction(toolId);
  render(toolId);
}

window.RaptorEditorGraphs=Object.freeze({
  render,
  fit,
  getView(toolId){
    const state=VIEW_STATES.get(toolId);
    return state?{...state}:null;
  },
  getDisplayViews(toolId){
    const body=document.querySelector('[data-tool-body="'+toolId+'"]');
    return body?._raptorDisplayViews||null;
  },
  getEqGeometry(toolId){
    return eqGeometryForTool(toolId);
  },
  getContextRequest(){
    return graphContextRequest?{...graphContextRequest}:null;
  },
  closeContextMenu:closeGraphContextMenu
});
})();