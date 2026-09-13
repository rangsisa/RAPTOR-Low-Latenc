(()=>{
'use strict';

const canvas=document.getElementById('pipelineNodeCanvas');
const workspaceView=window.RaptorPipelineWorkspaceView;
const filterButton=document.getElementById('pipelineCanvasFilterButton');
if(!canvas||!workspaceView) return;

const FILTER_COMMANDS=Object.freeze([
  {type:'lowpass',label:'Lowpass Filter'},
  {type:'highpass',label:'Highpass Filter'},
  {type:'bandpass',label:'Bandpass Filter'},
  {type:'mag-phase-gd',label:'Mag-Phase-GD Filter'},
  {type:'target-export',label:'Target Export'}
]);

let menu=null;
let request=null;
let targetExportLoader=null;
let bandpassEditorLoader=null;

function activeLine(){
  return window.RaptorPipeline?.getActiveLine?.()||null;
}

function ensureBandpassEditorModule(){
  if(bandpassEditorLoader) return bandpassEditorLoader;
  bandpassEditorLoader=new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-raptor-bandpass-side-editor]');
    if(existing){
      resolve(existing);
      return;
    }
    const script=document.createElement('script');
    script.src='./crossover-bandpass-editor.js?v=bandpass-side-layout-v1-20260908-1';
    script.async=true;
    script.dataset.raptorBandpassSideEditor='';
    script.addEventListener('load',()=>resolve(script),{once:true});
    script.addEventListener('error',()=>{
      bandpassEditorLoader=null;
      script.remove();
      reject(new Error('Bandpass side editor module failed to load'));
    },{once:true});
    document.body.appendChild(script);
  });
  return bandpassEditorLoader;
}

ensureBandpassEditorModule().catch(error=>console.error('[RAPTOR Bandpass Editor]',error));

function ensureTargetExportStyle(){
  if(document.querySelector('link[data-raptor-target-export-style]')) return;
  const link=document.createElement('link');
  link.rel='stylesheet';
  link.href='./target-export.css?v=strong-lineage-20260912-1';
  link.dataset.raptorTargetExportStyle='';
  document.head.appendChild(link);
}

function ensureTargetExportModule(){
  if(window.RaptorTargetExport) return Promise.resolve(window.RaptorTargetExport);
  if(targetExportLoader) return targetExportLoader;

  ensureTargetExportStyle();
  targetExportLoader=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='./target-export.js?v=wire-drop-input-anchor-20260913-1';
    script.async=true;
    script.dataset.raptorTargetExportModule='';
    script.addEventListener('load',()=>{
      if(window.RaptorTargetExport){
        resolve(window.RaptorTargetExport);
        return;
      }
      targetExportLoader=null;
      reject(new Error('Target Export module did not initialize'));
    },{once:true});
    script.addEventListener('error',()=>{
      targetExportLoader=null;
      script.remove();
      reject(new Error('Target Export module failed to load'));
    },{once:true});
    document.body.appendChild(script);
  });
  return targetExportLoader;
}

function ensureMenu(){
  if(menu) return menu;
  menu=document.createElement('div');
  menu.className='pipeline-context-menu';
  menu.hidden=true;
  menu.setAttribute('role','menu');
  document.body.appendChild(menu);
  return menu;
}

function closeMenu(){
  if(!menu) return;
  menu.hidden=true;
  menu.replaceChildren();
  filterButton?.setAttribute('aria-expanded','false');
  request=null;
}

function canvasPoint(event){
  return workspaceView.clientToLogical(event.clientX,event.clientY);
}

function positionMenu(target,clientX,clientY){
  target.hidden=false;
  target.style.left='0px';
  target.style.top='0px';
  const rect=target.getBoundingClientRect();
  const gap=6;
  target.style.left=Math.round(Math.max(gap,Math.min(window.innerWidth-rect.width-gap,clientX)))+'px';
  target.style.top=Math.round(Math.max(gap,Math.min(window.innerHeight-rect.height-gap,clientY)))+'px';
}

function commandAcceptsSource(command,source){
  return !source||command.type!=='target-export'||source.kind==='filter';
}

function connectCreatedFilter(filterId,source){
  if(!filterId||!source) return false;
  return window.RaptorPipeline?.connectSourceToFilter?.(filterId,source)===true;
}

function createRequestedFilter(command,current){
  const lineNow=activeLine();
  if(!lineNow||String(lineNow.id||'')!==String(current.lineId||'')) return;
  const placement=current.source?'input':'center';

  if(command.type==='target-export'){
    ensureTargetExportModule()
      .then(module=>{
        const active=activeLine();
        if(!active||String(active.id||'')!==String(current.lineId||'')) return;
        const created=module.createAt?.(current.x,current.y,{placement})||null;
        if(current.source&&created?.id) connectCreatedFilter(created.id,current.source);
      })
      .catch(error=>console.error('[RAPTOR Target Export]',error));
    return;
  }

  let createdId=null;
  const onCreated=event=>{
    if(event.detail?.filterType!==command.type) return;
    if(String(event.detail?.lineId||'')!==String(current.lineId||'')) return;
    createdId=String(event.detail?.filterId||'')||null;
  };
  document.addEventListener('raptor:filtercreated',onCreated);
  try{
    document.dispatchEvent(new CustomEvent('raptor:pipelinefilterrequest',{
      detail:{
        lineId:current.lineId,
        lineName:current.lineName,
        filterType:command.type,
        filterLabel:command.label,
        x:current.x,
        y:current.y,
        placement
      }
    }));
  }finally{
    document.removeEventListener('raptor:filtercreated',onCreated);
  }
  if(current.source&&createdId) connectCreatedFilter(createdId,current.source);
}

function openFilterMenu({clientX,clientY,x,y,source=null,origin='canvas'}={}){
  const line=activeLine();
  request=Object.freeze({
    kind:source?'wire-drop':'canvas',
    origin,
    lineId:line?.id||null,
    lineName:line?.name||'',
    x:Number(x),
    y:Number(y),
    source
  });

  const target=ensureMenu();
  target.replaceChildren();

  for(const command of FILTER_COMMANDS){
    const button=document.createElement('button');
    button.className='pipeline-context-action';
    button.type='button';
    button.setAttribute('role','menuitem');
    button.textContent=command.label;
    const compatible=commandAcceptsSource(command,source);
    button.disabled=!line||!compatible;
    button.title=!line?'Load a RAPTOR Line first':
      compatible?(source?'Create + connect '+command.label:'Create '+command.label+' node here'):
        'Target Export accepts filter outputs only';
    button.addEventListener('click',()=>{
      const current=request;
      closeMenu();
      if(!current||!activeLine()) return;
      createRequestedFilter(command,current);
    });
    target.appendChild(button);
  }

  positionMenu(target,clientX,clientY);
  filterButton?.setAttribute('aria-expanded',origin==='toolbar'?'true':'false');
}

function openCanvasMenu(event){
  event.preventDefault();
  event.stopPropagation();
  const point=canvasPoint(event);
  openFilterMenu({clientX:event.clientX,clientY:event.clientY,x:point.x,y:point.y});
}

function openToolbarMenu(event){
  event.preventDefault();
  event.stopPropagation();
  const canvasRect=canvas.getBoundingClientRect();
  const buttonRect=filterButton.getBoundingClientRect();
  const clientX=canvasRect.left+canvasRect.width/2;
  const clientY=canvasRect.top+canvasRect.height/2;
  const point=workspaceView.clientToLogical(clientX,clientY);
  openFilterMenu({
    clientX:buttonRect.left,
    clientY:buttonRect.bottom+5,
    x:point.x,
    y:point.y,
    origin:'toolbar'
  });
}

function openWireMenu(event,hit){
  event.preventDefault();
  event.stopPropagation();

  const line=activeLine();
  request=Object.freeze({
    kind:'wire',
    lineId:line?.id||null,
    lineName:line?.name||'',
    wireId:hit.dataset.wireId||null,
    sourceId:hit.dataset.sourceId||null,
    targetId:hit.dataset.targetId||null
  });

  const target=ensureMenu();
  target.replaceChildren();

  const disconnect=document.createElement('button');
  disconnect.className='pipeline-context-action pipeline-context-action--disconnect';
  disconnect.type='button';
  disconnect.setAttribute('role','menuitem');
  disconnect.textContent='Disconnect';
  disconnect.addEventListener('click',()=>{
    const current=request;
    closeMenu();
    if(!current||current.kind!=='wire') return;
    document.dispatchEvent(new CustomEvent('raptor:pipelinedisconnectrequest',{detail:{...current}}));
  });
  target.appendChild(disconnect);
  positionMenu(target,event.clientX,event.clientY);
}

filterButton?.addEventListener('click',openToolbarMenu);

document.addEventListener('raptor:pipelinewireblankdrop',event=>{
  const detail=event.detail||{};
  if(!detail.source) return;
  const point=workspaceView.clientToLogical(detail.clientX,detail.clientY);
  openFilterMenu({
    clientX:detail.clientX,
    clientY:detail.clientY,
    x:point.x,
    y:point.y,
    source:detail.source,
    origin:'wire-drop'
  });
});

canvas.addEventListener('contextmenu',event=>{
  const hit=event.target.closest?.('.pipeline-persistent-wire-hit');
  if(hit){
    openWireMenu(event,hit);
    return;
  }

  if(event.target.closest?.('.measurement-node,.mpgd-filter-node,.xo-filter-node,.target-export-node,.pipeline-context-menu')) return;
  openCanvasMenu(event);
});

document.addEventListener('pointerdown',event=>{
  if(menu&&!menu.hidden&&!menu.contains(event.target)) closeMenu();
});

document.addEventListener('keydown',event=>{
  if(event.key==='Escape') closeMenu();
});

window.addEventListener('resize',closeMenu);
canvas.addEventListener('scroll',closeMenu,{passive:true});

window.RaptorPipelineContext=Object.freeze({
  close:closeMenu,
  openAt:openFilterMenu,
  getRequest:()=>request?{...request}:null
});
})();
