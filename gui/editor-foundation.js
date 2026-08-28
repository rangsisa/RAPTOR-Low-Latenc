(()=>{
'use strict';

const TOOL_IDS=['raptor-editor','nga-editor','nga-auto-zero'];
const F0=20;
const F1=20000;
const WIDTH=1000;
const HEIGHT=220;
const MAX_DISPLAY_POINTS=1800;

function log10(value){return Math.log(value)/Math.LN10;}

function xOf(frequency){
  const a=log10(F0);
  const b=log10(F1);
  return (log10(frequency)-a)/(b-a)*WIDTH;
}

function yPhase(value){
  const v=Math.max(-180,Math.min(180,value));
  return HEIGHT-((v+180)/360)*HEIGHT;
}

function yMagnitude(value){
  const v=Math.max(-12,Math.min(12,value));
  return HEIGHT-((v+12)/24)*HEIGHT;
}

function pointsInDisplayRange(frequency){
  const indices=[];
  for(let i=0;i<frequency.length;i++){
    const f=frequency[i];
    if(Number.isFinite(f)&&f>=F0&&f<=F1) indices.push(i);
  }
  if(indices.length<=MAX_DISPLAY_POINTS) return indices;

  const out=[];
  const stride=(indices.length-1)/(MAX_DISPLAY_POINTS-1);
  for(let n=0;n<MAX_DISPLAY_POINTS;n++){
    out.push(indices[Math.min(indices.length-1,Math.round(n*stride))]);
  }
  return out;
}

function phasePath(frequency,phase,indices){
  let path='';
  let previous=null;
  for(const i of indices){
    const f=frequency[i];
    const value=phase[i];
    if(!Number.isFinite(f)||!Number.isFinite(value)) continue;
    const x=xOf(f);
    const y=yPhase(value);
    const move=previous===null||Math.abs(value-previous)>300;
    path+=(move?'M':'L')+x.toFixed(2)+' '+y.toFixed(2)+' ';
    previous=value;
  }
  return path.trim();
}

function magnitudePath(frequency,magnitude,indices){
  let path='';
  for(const i of indices){
    const f=frequency[i];
    const value=magnitude[i];
    if(!Number.isFinite(f)||!Number.isFinite(value)) continue;
    const x=xOf(f);
    const y=yMagnitude(value);
    path+=(path?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)+' ';
  }
  return path.trim();
}

function fillPath(linePath,frequency,indices){
  if(!linePath||!indices.length) return '';
  const first=frequency[indices[0]];
  const last=frequency[indices[indices.length-1]];
  if(!(Number.isFinite(first)&&Number.isFinite(last))) return '';
  return linePath+' L'+xOf(last).toFixed(2)+' '+HEIGHT+' L'+xOf(first).toFixed(2)+' '+HEIGHT+' Z';
}

function setEmpty(body){
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

  body.dataset.graphInput='empty';
}

function render(toolId,input){
  const body=document.querySelector('[data-tool-body="'+toolId+'"]');
  if(!body) return;

  const canonical=input?.canonical||body._raptorInput?.canonical||null;
  const views=input?.views||body._raptorInput?.views||null;
  const entry=input?.entry||body._raptorInput?.entry||null;

  if(!canonical||!views){
    setEmpty(body);
    return;
  }

  try{
    window.RaptorMeasurementCanonicalV1?.validate?.(canonical);
  }catch(error){
    setEmpty(body);
    body.dataset.graphInput='error';
    return;
  }

  const frequency=views.frequency_hz;
  const magnitude=views.magnitude_db;
  const phase=views.phase_deg;
  if(!frequency||!magnitude||!phase){
    setEmpty(body);
    return;
  }

  const indices=pointsInDisplayRange(frequency);
  if(!indices.length){
    setEmpty(body);
    body.dataset.graphInput='out-of-range';
    return;
  }

  const pPath=phasePath(frequency,phase,indices);
  const mPath=magnitudePath(frequency,magnitude,indices);
  const mFill=fillPath(mPath,frequency,indices);

  const phasePathEl=body.querySelector('.editor-foundation-trace--phase path');
  const magSvg=body.querySelector('.editor-foundation-trace--mag');
  const magFillEl=magSvg?.querySelector('.editor-foundation-fill');
  const magLineEl=magSvg?[...magSvg.querySelectorAll('path')].find(path=>!path.classList.contains('editor-foundation-fill')):null;

  phasePathEl?.setAttribute('d',pPath);
  magFillEl?.setAttribute('d',mFill);
  magLineEl?.setAttribute('d',mPath);

  const readouts=[...body.querySelectorAll('.matching-readout')];
  const name=entry?.name||canonical.source_name||'Pipeline measurement';
  if(readouts[0]) readouts[0].textContent=name+' · '+canonical.points+' pts';
  if(readouts[1]) readouts[1].textContent=name+' · '+canonical.points+' pts';

  body.dataset.graphInput='canonical-v1';
  body.dataset.displayPoints=String(indices.length);
}

function renderFromWorkspace(toolId){
  const input=window.RaptorWorkspace?.getToolInput?.(toolId)||null;
  render(toolId,input);
}

document.addEventListener('raptor:toolinput',event=>{
  const toolId=event.detail?.toolId;
  if(!TOOL_IDS.includes(toolId)) return;
  const body=document.querySelector('[data-tool-body="'+toolId+'"]');
  render(toolId,{
    context:event.detail,
    entry:body?._raptorInput?.entry||null,
    canonical:event.detail?.canonical||body?._raptorInput?.canonical||null,
    views:event.detail?.views||body?._raptorInput?.views||null
  });
});

for(const toolId of TOOL_IDS) renderFromWorkspace(toolId);

window.RaptorEditorGraphs=Object.freeze({
  render:renderFromWorkspace
});
})();