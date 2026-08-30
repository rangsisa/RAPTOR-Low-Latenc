(()=>{
'use strict';

const THEME_STORAGE_KEY='raptor.pipeline.canvas.theme.v1';
const ZOOM_STORAGE_KEY='raptor.pipeline.canvas.zoom.v1';
const ZOOM_LEVELS=Object.freeze([.5,.6,.7,.8,.9,1,1.1,1.2,1.3,1.4,1.5]);

const canvas=document.getElementById('pipelineNodeCanvas');
const controls=document.querySelector('.pipeline-canvas-controls');
const themeToggle=document.getElementById('pipelineCanvasThemeToggle');
const zoomOut=document.getElementById('pipelineZoomOut');
const zoomIn=document.getElementById('pipelineZoomIn');
const zoomValue=document.getElementById('pipelineZoomValue');
if(!canvas||!controls||!themeToggle||!zoomOut||!zoomIn||!zoomValue) return;

function readStoredTheme(){
  try{return window.localStorage.getItem(THEME_STORAGE_KEY)==='dark'?'dark':'light';}
  catch{return 'light';}
}
function storeTheme(theme){
  try{window.localStorage.setItem(THEME_STORAGE_KEY,theme);}catch{}
}
function readStoredZoom(){
  try{
    const value=Number(window.localStorage.getItem(ZOOM_STORAGE_KEY));
    return ZOOM_LEVELS.includes(value)?value:1;
  }catch{return 1;}
}
function storeZoom(value){
  try{window.localStorage.setItem(ZOOM_STORAGE_KEY,String(value));}catch{}
}

let zoom=readStoredZoom();

function applyTheme(theme,persist=false){
  const dark=theme==='dark';
  canvas.classList.toggle('is-dark-canvas',dark);
  controls.classList.toggle('is-dark-mode',dark);
  themeToggle.setAttribute('aria-pressed',dark?'true':'false');
  themeToggle.setAttribute('aria-label',dark?'Switch Pipeline workspace to light mode':'Switch Pipeline workspace to dark mode');
  themeToggle.textContent=dark?'☀ Light':'☾ Dark';
  if(persist) storeTheme(dark?'dark':'light');
}

function updateZoomControls(){
  const index=ZOOM_LEVELS.indexOf(zoom);
  const text=Math.round(zoom*100)+'%';
  zoomValue.value=text;
  zoomValue.textContent=text;
  zoomOut.disabled=index<=0;
  zoomIn.disabled=index<0||index>=ZOOM_LEVELS.length-1;
  zoomOut.title='Zoom out · '+text;
  zoomIn.title='Zoom in · '+text;
}

function positionNode(node,x,y){
  if(!node) return;
  const logicalX=Number.isFinite(Number(x))?Number(x):0;
  const logicalY=Number.isFinite(Number(y))?Number(y):0;
  node.dataset.pipelineLogicalX=String(logicalX);
  node.dataset.pipelineLogicalY=String(logicalY);
  node.style.left=(logicalX*zoom)+'px';
  node.style.top=(logicalY*zoom)+'px';
  node.style.transformOrigin='0 0';
  node.style.setProperty('scale',String(zoom));
}

function refreshPositionedNodes(){
  canvas.querySelectorAll('[data-pipeline-logical-x][data-pipeline-logical-y]').forEach(node=>{
    positionNode(node,Number(node.dataset.pipelineLogicalX),Number(node.dataset.pipelineLogicalY));
  });
}

function clientToLogical(clientX,clientY){
  const rect=canvas.getBoundingClientRect();
  return {
    x:(clientX-rect.left+canvas.scrollLeft)/zoom,
    y:(clientY-rect.top+canvas.scrollTop)/zoom
  };
}

function grabOffsetLogical(event,node){
  const rect=node.getBoundingClientRect();
  return {
    x:(event.clientX-rect.left)/zoom,
    y:(event.clientY-rect.top)/zoom
  };
}

function logicalScrollWidth(){
  return Math.max(canvas.clientWidth/zoom,canvas.scrollWidth/zoom);
}

function setZoom(next,persist=false){
  if(!ZOOM_LEVELS.includes(next)||next===zoom) return false;
  const oldZoom=zoom;
  const logicalCenterX=(canvas.scrollLeft+canvas.clientWidth/2)/oldZoom;
  const logicalCenterY=(canvas.scrollTop+canvas.clientHeight/2)/oldZoom;

  zoom=next;
  canvas.style.setProperty('--pipeline-zoom',String(zoom));
  refreshPositionedNodes();
  updateZoomControls();
  if(persist) storeZoom(zoom);

  requestAnimationFrame(()=>{
    canvas.scrollLeft=Math.max(0,logicalCenterX*zoom-canvas.clientWidth/2);
    canvas.scrollTop=Math.max(0,logicalCenterY*zoom-canvas.clientHeight/2);
    document.dispatchEvent(new CustomEvent('raptor:pipelinezoomchange',{detail:{zoom}}));
  });
  return true;
}

themeToggle.addEventListener('click',()=>{
  applyTheme(canvas.classList.contains('is-dark-canvas')?'light':'dark',true);
});
zoomOut.addEventListener('click',()=>{
  const index=ZOOM_LEVELS.indexOf(zoom);
  if(index>0) setZoom(ZOOM_LEVELS[index-1],true);
});
zoomIn.addEventListener('click',()=>{
  const index=ZOOM_LEVELS.indexOf(zoom);
  if(index>=0&&index<ZOOM_LEVELS.length-1) setZoom(ZOOM_LEVELS[index+1],true);
});

canvas.style.setProperty('--pipeline-zoom',String(zoom));
applyTheme(readStoredTheme(),false);
updateZoomControls();

window.RaptorPipelineWorkspaceView=Object.freeze({
  minZoom:ZOOM_LEVELS[0],
  maxZoom:ZOOM_LEVELS[ZOOM_LEVELS.length-1],
  getZoom:()=>zoom,
  positionNode,
  refreshPositionedNodes,
  clientToLogical,
  grabOffsetLogical,
  logicalScrollWidth,
  setZoom
});
})();
