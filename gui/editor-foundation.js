(()=>{
'use strict';

const TOOL_IDS=['raptor-editor','nga-editor','nga-auto-zero'];
const F0=20;
const F1=20000;
const WIDTH=1000;
const HEIGHT=220;
const MAX_DISPLAY_POINTS=1800;
const VIEW_STATES=new Map(TOOL_IDS.map(id=>[id,{v0:F0,v1:F1}]));

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

function formatFrequency(value){
  if(!Number.isFinite(value)||value<=0) return '—';
  if(value>=1000){
    const k=value/1000;
    return (k<10?k.toFixed(2):k.toFixed(1)).replace(/\.?0+$/,'')+'k';
  }
  return (value<100?value.toFixed(1):value.toFixed(0)).replace(/\.0$/,'');
}

function yPhase(value){
  const v=Math.max(-180,Math.min(180,value));
  return HEIGHT-((v+180)/360)*HEIGHT;
}

function yMagnitude(value){
  const v=Math.max(-12,Math.min(12,value));
  return HEIGHT-((v+12)/24)*HEIGHT;
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

function updateXAxis(body,state){
  for(const axis of body.querySelectorAll('.editor-foundation-x')){
    const labels=[...axis.querySelectorAll('span')];
    if(!labels.length) continue;
    labels.forEach((label,index)=>{
      const ratio=labels.length===1?0:index/(labels.length-1);
      label.textContent=formatFrequency(frequencyAtRatio(ratio,state));
    });
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

  const readouts=[...body.querySelectorAll('.matching-readout')];
  if(readouts[0]) readouts[0].textContent='No Pipeline input';
  if(readouts[1]) readouts[1].textContent='No Pipeline input';

  updateXAxis(body,state);
  body.dataset.graphInput='empty';
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

function render(toolId,input=null){
  const state=VIEW_STATES.get(toolId)||{v0:F0,v1:F1};
  const body=input?.body||document.querySelector('[data-tool-body="'+toolId+'"]');
  if(!body) return;

  const fallback=currentInput(toolId);
  const canonical=input?.canonical||fallback.canonical;
  const views=input?.views||fallback.views;
  const entry=input?.entry||fallback.entry;

  if(!canonical||!views){
    setEmpty(body,state);
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

  const readouts=[...body.querySelectorAll('.matching-readout')];
  const name=entry?.name||canonical.source_name||'Pipeline measurement';
  const range=formatFrequency(state.v0)+'–'+formatFrequency(state.v1)+' Hz';
  if(readouts[0]) readouts[0].textContent=name+' · '+range;
  if(readouts[1]) readouts[1].textContent=name+' · '+range;

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

function bindGraphInteraction(toolId){
  const body=document.querySelector('[data-tool-body="'+toolId+'"]');
  if(!body||body.dataset.graphInteractionBound==='1') return;
  body.dataset.graphInteractionBound='1';

  body.querySelectorAll('.editor-foundation-plot').forEach(plot=>{
    plot.addEventListener('wheel',event=>{
      event.preventDefault();
      event.stopPropagation();

      const rect=plot.getBoundingClientRect();
      const left=30;
      const right=7;
      const usable=Math.max(1,rect.width-left-right);
      const ratio=(event.clientX-rect.left-left)/usable;
      zoom(toolId,ratio,event.deltaY);
    },{passive:false});

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