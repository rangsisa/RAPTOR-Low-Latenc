(()=>{
'use strict';

const canvas=document.getElementById('pipelineNodeCanvas');
const workspaceView=window.RaptorPipelineWorkspaceView;
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
const pendingTargetExports=[];

function activeLine(){
  return window.RaptorPipeline?.getActiveLine?.()||null;
}

function flushPendingTargetExports(){
  const api=window.RaptorTargetExport;
  if(!api?.createAt) return;
  while(pendingTargetExports.length){
    const item=pendingTargetExports.shift();
    if(!item) continue;
    const line=activeLine();
    if(!line||String(line.id)!==String(item.lineId)) continue;
    api.createAt(item.x,item.y);
  }
}

function ensureTargetExportModule(){
  if(window.RaptorTargetExport?.createAt){
    flushPendingTargetExports();
    return Promise.resolve(window.RaptorTargetExport);
  }
  if(targetExportLoader) return targetExportLoader;

  targetExportLoader=new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-raptor-target-export]');
    if(existing){
      existing.addEventListener('load',()=>{
        flushPendingTargetExports();
        resolve(window.RaptorTargetExport||null);
      },{once:true});
      existing.addEventListener('error',reject,{once:true});
      return;
    }

    const script=document.createElement('script');
    script.src='./target-export.js?v=target-export-20260906-1';
    script.dataset.raptorTargetExport='true';
    script.addEventListener('load',()=>{
      flushPendingTargetExports();
      resolve(window.RaptorTargetExport||null);
    },{once:true});
    script.addEventListener('error',reject,{once:true});
    document.body.appendChild(script);
  });
  return targetExportLoader;
}

function requestTargetExport(current){
  const line=activeLine();
  if(!current||!line) return;
  const item={
    lineId:line.id,
    x:Number(current.x)||520,
    y:Number(current.y)||180
  };
  if(window.RaptorTargetExport?.createAt){
    window.RaptorTargetExport.createAt(item.x,item.y);
    return;
  }
  pendingTargetExports.push(item);
  ensureTargetExportModule().catch(()=>{
    const index=pendingTargetExports.indexOf(item);
    if(index>=0) pendingTargetExports.splice(index,1);
  });
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
  request=null;
}

function canvasPoint(event){
  return workspaceView.clientToLogical(event.clientX,event.clientY);
}

function positionMenu(target,event){
  target.hidden=false;
  target.style.left='0px';
  target.style.top='0px';
  const rect=target.getBoundingClientRect();
  const gap=6;
  target.style.left=Math.round(Math.max(gap,Math.min(window.innerWidth-rect.width-gap,event.clientX)))+'px';
  target.style.top=Math.round(Math.max(gap,Math.min(window.innerHeight-rect.height-gap,event.clientY)))+'px';
}

function openCanvasMenu(event){
  event.preventDefault();
  event.stopPropagation();

  const line=activeLine();
  const point=canvasPoint(event);
  request=Object.freeze({
    kind:'canvas',
    lineId:line?.id||null,
    lineName:line?.name||'',
    x:point.x,
    y:point.y
  });

  const target=ensureMenu();
  target.replaceChildren();

  for(const command of FILTER_COMMANDS){
    const button=document.createElement('button');
    button.className='pipeline-context-action';
    button.type='button';
    button.setAttribute('role','menuitem');
    button.textContent=command.label;
    button.disabled=!line;
    button.title=line?'Create '+command.label+' node here':'Load a RAPTOR Line first';
    button.addEventListener('click',()=>{
      const current=request;
      closeMenu();
      if(!current||current.kind!=='canvas'||!activeLine()) return;

      if(command.type==='target-export'){
        requestTargetExport(current);
        return;
      }

      document.dispatchEvent(new CustomEvent('raptor:pipelinefilterrequest',{
        detail:{
          lineId:current.lineId,
          lineName:current.lineName,
          filterType:command.type,
          filterLabel:command.label,
          x:current.x,
          y:current.y
        }
      }));
    });
    target.appendChild(button);
  }

  positionMenu(target,event);
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
  positionMenu(target,event);
}

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

// Preload the sink node module so it is normally ready before the first menu use.
ensureTargetExportModule().catch(()=>{});

window.RaptorPipelineContext=Object.freeze({
  close:closeMenu,
  getRequest:()=>request?{...request}:null
});
})();
