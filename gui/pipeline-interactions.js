(()=>{
const node=document.getElementById('measurementNode');
const nodeHeader=node?.querySelector('.measurement-node-head');
const nodeCanvas=document.getElementById('pipelineNodeCanvas');
const preview=document.getElementById('measurementPreview');
const api=window.RaptorPipeline;
if(!node||!nodeHeader||!nodeCanvas||!preview||!api) return;

let activeCard=null;
let activePreviewButton=null;

function ensureMeasurementState(card){
  if(!card) return null;
  if(!card._raptorLineState) card._raptorLineState={version:1,nodes:{measurement:{files:[],position:null}}};
  if(!card._raptorLineState.nodes) card._raptorLineState.nodes={};
  if(!card._raptorLineState.nodes.measurement) card._raptorLineState.nodes.measurement={files:[],position:null};
  const measurement=card._raptorLineState.nodes.measurement;
  if(!('position' in measurement)) measurement.position=null;
  return measurement;
}

const baseCreate=api.createState?.bind(api);
if(baseCreate){
  api.createState=()=>{
    const state=baseCreate();
    if(!state.nodes) state.nodes={};
    if(!state.nodes.measurement) state.nodes.measurement={files:[]};
    if(!('position' in state.nodes.measurement)) state.nodes.measurement.position=null;
    return state;
  };
}

const baseClone=api.cloneState?.bind(api);
if(baseClone){
  api.cloneState=state=>{
    const clone=baseClone(state);
    const sourcePosition=state?.nodes?.measurement?.position;
    if(!clone.nodes) clone.nodes={};
    if(!clone.nodes.measurement) clone.nodes.measurement={files:[]};
    clone.nodes.measurement.position=sourcePosition?{x:sourcePosition.x,y:sourcePosition.y}:null;
    return clone;
  };
}

function applyNodePosition(card){
  const measurement=ensureMeasurementState(card);
  const position=measurement?.position;
  if(position&&Number.isFinite(position.x)&&Number.isFinite(position.y)){
    node.style.left=`${position.x}px`;
    node.style.top=`${position.y}px`;
    node.style.transform='none';
  }else{
    node.style.removeProperty('left');
    node.style.removeProperty('top');
    node.style.removeProperty('transform');
  }
}

const baseLoad=api.load?.bind(api);
if(baseLoad){
  api.load=card=>{
    baseLoad(card);
    activeCard=card;
    requestAnimationFrame(()=>applyNodePosition(card));
  };
}

const baseDelete=api.onDelete?.bind(api);
if(baseDelete){
  api.onDelete=card=>{
    if(card===activeCard) activeCard=null;
    baseDelete(card);
  };
}

function closePreviewVisual(){
  preview.hidden=true;
  if(activePreviewButton) activePreviewButton.classList.remove('is-open');
  activePreviewButton=null;
}

nodeHeader.addEventListener('pointerdown',event=>{
  if(!activeCard||event.button>0) return;
  if(event.target.closest('button,input,label,a')) return;
  event.preventDefault();
  closePreviewVisual();

  const pointerId=event.pointerId;
  const canvasRect=nodeCanvas.getBoundingClientRect();
  const nodeRect=node.getBoundingClientRect();
  const startPointerX=event.clientX;
  const startPointerY=event.clientY;
  const startLeft=nodeRect.left-canvasRect.left+nodeCanvas.scrollLeft;
  const startTop=nodeRect.top-canvasRect.top+nodeCanvas.scrollTop;
  let left=startLeft;
  let top=startTop;

  node.classList.add('is-dragging');
  node.style.transform='none';
  node.style.left=`${left}px`;
  node.style.top=`${top}px`;
  try{nodeHeader.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    const wantedX=startLeft+(moveEvent.clientX-startPointerX);
    const wantedY=startTop+(moveEvent.clientY-startPointerY);
    const maxX=Math.max(8,nodeCanvas.scrollWidth-node.offsetWidth-8);
    const maxY=Math.max(8,nodeCanvas.scrollHeight-node.offsetHeight-8);
    left=Math.max(8,Math.min(maxX,wantedX));
    top=Math.max(8,Math.min(maxY,wantedY));
    node.style.left=`${left}px`;
    node.style.top=`${top}px`;
  };

  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    try{if(nodeHeader.hasPointerCapture(pointerId)) nodeHeader.releasePointerCapture(pointerId)}catch{}
    node.classList.remove('is-dragging');
    const measurement=ensureMeasurementState(activeCard);
    if(measurement) measurement.position={x:left,y:top};
  };

  window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
});

document.addEventListener('click',event=>{
  const button=event.target.closest('.measurement-preview-button');
  if(!button) return;
  if(activePreviewButton===button){
    preview.hidden=true;
    button.classList.remove('is-open');
    activePreviewButton=null;
  }else{
    activePreviewButton?.classList.remove('is-open');
    activePreviewButton=button;
    button.classList.add('is-open');
  }
});

new MutationObserver(()=>{
  if(preview.hidden){
    activePreviewButton?.classList.remove('is-open');
    activePreviewButton=null;
  }
}).observe(preview,{attributes:true,attributeFilter:['hidden']});

window.RaptorPipelineInteractions={
  resetMeasurementPosition(){
    if(!activeCard) return;
    const measurement=ensureMeasurementState(activeCard);
    measurement.position=null;
    applyNodePosition(activeCard);
  }
};
})();
