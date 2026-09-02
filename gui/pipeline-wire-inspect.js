(()=>{
'use strict';

const canvas=document.getElementById('pipelineNodeCanvas');
const baseSvg=canvas?.querySelector('.pipeline-wire-layer');
if(!canvas||!baseSvg) return;

const SVG_NS='http://www.w3.org/2000/svg';
const overlay=document.createElementNS(SVG_NS,'svg');
overlay.setAttribute('class','pipeline-wire-inspect-layer');
overlay.setAttribute('aria-hidden','true');
canvas.appendChild(overlay);

let lockedWireId=null;
let hoveredWireId=null;
let refreshFrame=0;

function allHits(){
  return [...baseSvg.querySelectorAll('.pipeline-persistent-wire-hit')];
}

function hitByWireId(wireId){
  if(!wireId) return null;
  return allHits().find(hit=>hit.dataset.wireId===wireId)||null;
}

function visualForHit(hit){
  if(!hit?.parentElement) return null;
  const children=[...hit.parentElement.children];
  const index=children.indexOf(hit);
  if(index<0) return null;
  const path=children[index+1];
  const flow=children[index+2];
  if(!path?.classList?.contains('pipeline-persistent-wire')) return null;
  return {
    path,
    flow:flow?.classList?.contains('pipeline-wire-flow')?flow:null
  };
}

function upstreamHits(startHit){
  const hits=allHits();
  const byTarget=new Map();
  for(const hit of hits){
    const targetId=String(hit.dataset.targetId||'');
    if(targetId&&!byTarget.has(targetId)) byTarget.set(targetId,hit);
  }

  const result=[];
  const seen=new Set();
  let current=startHit;
  while(current){
    const wireId=String(current.dataset.wireId||'');
    if(!wireId||seen.has(wireId)) break;
    seen.add(wireId);
    result.push(current);

    if(current.dataset.sourceKind!=='filter') break;
    const sourceId=String(current.dataset.sourceId||'');
    if(!sourceId) break;
    current=byTarget.get(sourceId)||null;
  }
  return result;
}

function traceColor(hits){
  for(const hit of hits){
    const visual=visualForHit(hit);
    const stroke=visual?.path?.getAttribute('stroke');
    if(stroke) return stroke;
  }
  return '#e86f17';
}

function clearNodeTrace(){
  canvas.querySelectorAll('.is-wire-trace-node').forEach(node=>{
    node.classList.remove('is-wire-trace-node');
    node.style.removeProperty('--wire-trace-color');
  });
}

function markNode(node,color){
  if(!node) return;
  node.classList.add('is-wire-trace-node');
  node.style.setProperty('--wire-trace-color',color);
}

function markLineageNodes(hits,color){
  clearNodeTrace();
  for(const hit of hits){
    const targetId=String(hit.dataset.targetId||'');
    if(targetId){
      markNode(
        [...canvas.querySelectorAll('.xo-filter-node,.mpgd-filter-node')]
          .find(node=>node.dataset.filterId===targetId),
        color
      );
    }

    const sourceId=String(hit.dataset.sourceId||'');
    if(hit.dataset.sourceKind==='filter'&&sourceId){
      markNode(
        [...canvas.querySelectorAll('.xo-filter-node,.mpgd-filter-node')]
          .find(node=>node.dataset.filterId===sourceId),
        color
      );
    }else if(hit.dataset.sourceKind==='measurement'&&sourceId){
      markNode(document.getElementById('measurementNode'),color);
      markNode(
        [...canvas.querySelectorAll('.measurement-file')]
          .find(row=>row.dataset.measurementId===sourceId),
        color
      );
    }
  }
}

function appendVisual(hit,mode){
  const visual=visualForHit(hit);
  if(!visual) return;

  const path=visual.path.cloneNode(false);
  path.removeAttribute('class');
  path.setAttribute('class','pipeline-wire-inspect-path'+(mode==='hover'?' is-hover':''));
  overlay.appendChild(path);

  if(visual.flow){
    const flow=visual.flow.cloneNode(false);
    flow.removeAttribute('class');
    flow.setAttribute('class','pipeline-wire-inspect-flow');
    overlay.appendChild(flow);
  }
}

function renderInspect(){
  overlay.replaceChildren();

  if(lockedWireId){
    const hit=hitByWireId(lockedWireId);
    if(!hit){
      lockedWireId=null;
      clearNodeTrace();
      return;
    }
    const hits=upstreamHits(hit);
    const color=traceColor(hits);
    for(const segment of [...hits].reverse()) appendVisual(segment,'locked');
    markLineageNodes(hits,color);
    return;
  }

  clearNodeTrace();
  if(!hoveredWireId) return;
  const hit=hitByWireId(hoveredWireId);
  if(hit) appendVisual(hit,'hover');
}

function scheduleRender(){
  if(refreshFrame) cancelAnimationFrame(refreshFrame);
  refreshFrame=requestAnimationFrame(()=>{
    refreshFrame=0;
    renderInspect();
  });
}

canvas.addEventListener('pointerover',event=>{
  if(lockedWireId) return;
  const hit=event.target.closest?.('.pipeline-persistent-wire-hit');
  if(!hit) return;
  hoveredWireId=hit.dataset.wireId||null;
  scheduleRender();
});

canvas.addEventListener('pointerout',event=>{
  if(lockedWireId) return;
  const hit=event.target.closest?.('.pipeline-persistent-wire-hit');
  if(!hit) return;
  if(event.relatedTarget?.closest?.('.pipeline-persistent-wire-hit')===hit) return;
  hoveredWireId=null;
  scheduleRender();
});

function wireHitFromEvent(event){
  const direct=event.target.closest?.('.pipeline-persistent-wire-hit');
  if(direct) return direct;

  if(Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)&&document.elementsFromPoint){
    const stacked=document.elementsFromPoint(event.clientX,event.clientY);
    const hit=stacked.find(element=>element?.classList?.contains('pipeline-persistent-wire-hit'));
    if(hit) return hit;
  }

  return null;
}

canvas.addEventListener('click',event=>{
  const hit=wireHitFromEvent(event);
  if(hit){
    event.stopPropagation();
    const wireId=hit.dataset.wireId||null;
    if(wireId){
      // Wire clicks are selection/replace only.
      // Focus is cleared exclusively by empty-canvas click or Escape.
      lockedWireId=wireId;
      hoveredWireId=null;
      scheduleRender();
    }
    return;
  }

  if(event.target.closest?.('.measurement-node,.xo-filter-node,.mpgd-filter-node,.pipeline-context-menu')) return;
  if(lockedWireId){
    lockedWireId=null;
    hoveredWireId=null;
    scheduleRender();
  }
});

document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!lockedWireId) return;
  lockedWireId=null;
  hoveredWireId=null;
  scheduleRender();
});

new MutationObserver(()=>scheduleRender())
  .observe(baseSvg,{childList:true,subtree:true});

canvas.addEventListener('scroll',scheduleRender,{passive:true});
window.addEventListener('resize',scheduleRender);

window.RaptorPipelineWireInspect=Object.freeze({
  clear(){
    lockedWireId=null;
    hoveredWireId=null;
    scheduleRender();
  },
  getLockedWireId:()=>lockedWireId
});
})();
