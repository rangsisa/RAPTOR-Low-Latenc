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
  wrap:true,
  sync:true
}]));

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

function pointsInDisplayRange(frequency,state){
  const indices=[];
  for(let i=0;i<frequency.length;i++){
    const f=frequency[i];
    if(Number.isFinite(f)&&f>=state.v0&&f<=state.v1) indices.push(i);
  }
  if(indices.length<=MAX_DISPLAY_POINTS) return indices;

  const out=[];
  const stride=(indices.length-1)/(MAX_DISPLAY_POINTS-1);
  for(let n=0;n<MAX_DISPLAY_POINTS;n++){
    out.push(indices[Math.min(indices.length-1,Math.round(n*stride))]);
  }
  return out;
}

function phasePath(frequency,phase,indices,state){
  let path='';
  let previous=null;
  for(const i of indices){
    const f=frequency[i];
    const value=phase[i];
    if(!Number.isFinite(f)||!Number.isFinite(value)) continue;
    const x=xOf(f,state);
    const y=yPhase(value);
    const move=previous===null||Math.abs(value-previous)>300;
    path+=(move?'M':'L')+x.toFixed(2)+' '+y.toFixed(2)+' ';
    previous=value;
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

function ensureCursorLine(svg){
  let line=svg?.querySelector('.editor-cursor-line');
  if(!line&&svg){
    line=document.createElementNS(SVG_NS,'line');
    line.classList.add('editor-cursor-line');
    line.setAttribute('y1','0');
    line.setAttribute('y2',String(HEIGHT));
    line.hidden=true;
    svg.appendChild(line);
  }
  return line;
}

function hideCursors(body){
  body.querySelectorAll('.editor-cursor-line').forEach(line=>{line.hidden=true;});
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
  if(!body||!views?.frequency_hz) return;

  const frequency=views.frequency_hz;
  const phase=views.phase_deg;
  const magnitude=views.magnitude_db;
  const target=frequencyAtRatio(ratio,state);
  const index=nearestIndex(frequency,target);
  const f=frequency[index];

  if(!Number.isFinite(f)||f<state.v0||f>state.v1) return;

  const x=xOf(f,state);
  const phaseSvg=body.querySelector('.editor-foundation-trace--phase');
  const magSvg=body.querySelector('.editor-foundation-trace--mag');
  const phaseCursor=ensureCursorLine(phaseSvg);
  const magCursor=ensureCursorLine(magSvg);

  if(phaseCursor){
    phaseCursor.setAttribute('x1',x.toFixed(2));
    phaseCursor.setAttribute('x2',x.toFixed(2));
    phaseCursor.hidden=!(ui.sync||plotKind==='phase');
  }
  if(magCursor){
    magCursor.setAttribute('x1',x.toFixed(2));
    magCursor.setAttribute('x2',x.toFixed(2));
    magCursor.hidden=!(ui.sync||plotKind==='magnitude');
  }

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
  const magLine=magSvg?[...magSvg.querySelectorAll('path')].find(path=>!path.classList.contains('editor-foundation-fill')):null;
  phasePathEl?.setAttribute('d','');
  magFill?.setAttribute('d','');
  magLine?.setAttribute('d','');
  clearWrapMarkers(body);
  hideCursors(body);

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

  const frequency=views.frequency_hz;
  const magnitude=views.magnitude_db;
  const phase=views.phase_deg;
  if(!frequency||!magnitude||!phase){
    setEmpty(body,state);
    return;
  }

  const indices=pointsInDisplayRange(frequency,state);
  if(!indices.length){
    setEmpty(body,state);
    body.dataset.graphInput='out-of-range';
    return;
  }

  const pPath=phasePath(frequency,phase,indices,state);
  const mPath=magnitudePath(frequency,magnitude,indices,state);
  const mFill=fillPath(mPath,frequency,indices,state);

  const phasePathEl=body.querySelector('.editor-foundation-trace--phase path');
  const magSvg=body.querySelector('.editor-foundation-trace--mag');
  const magFillEl=magSvg?.querySelector('.editor-foundation-fill');
  const magLineEl=magSvg?[...magSvg.querySelectorAll('path')].find(path=>!path.classList.contains('editor-foundation-fill')):null;

  phasePathEl?.setAttribute('d',pPath);
  magFillEl?.setAttribute('d',mFill);
  magLineEl?.setAttribute('d',mPath);

  renderWrapMarkers(body,frequency,phase,indices,state,ui);
  updateTraceVisibility(body,ui);
  hideCursors(body);
  restoreReadouts(toolId);
  updateXAxis(body,state);

  body.dataset.graphInput='canonical-v1';
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

  body.querySelectorAll('.editor-foundation-plot').forEach(plot=>{
    const plotKind=plot.classList.contains('editor-foundation-plot--phase')?'phase':'magnitude';

    plot.addEventListener('wheel',event=>{
      event.preventDefault();
      event.stopPropagation();
      zoom(toolId,ratioForPointer(plot,event),event.deltaY);
    },{passive:false});

    plot.addEventListener('pointermove',event=>{
      showCursor(toolId,plotKind,ratioForPointer(plot,event));
    });

    plot.addEventListener('pointerleave',()=>{
      hideCursors(body);
      restoreReadouts(toolId);
    });

    plot.addEventListener('dblclick',event=>{
      event.preventDefault();
      fit(toolId);
    });
  });

  body.querySelector('[data-editor-action="fit"]')?.addEventListener('click',()=>fit(toolId));
}

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
  }
});
})();