(()=>{
'use strict';

const THEME_STORAGE_KEY='raptor.pipeline.canvas.theme.v1';
const ZOOM_STORAGE_KEY='raptor.pipeline.canvas.zoom.v1';
const ZOOM_LEVELS=Object.freeze([.5,.6,.7,.8,.9,1,1.1,1.2,1.3,1.4,1.5]);

const canvas=document.getElementById('pipelineNodeCanvas');
const themeLight=document.getElementById('pipelineThemeLight');
const themeDark=document.getElementById('pipelineThemeDark');
const zoomOut=document.getElementById('pipelineZoomOut');
const zoomIn=document.getElementById('pipelineZoomIn');
const zoomValue=document.getElementById('pipelineZoomValue');
if(!canvas||!themeLight||!themeDark||!zoomOut||!zoomIn||!zoomValue) return;

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

  themeLight.classList.toggle('is-active',!dark);
  themeDark.classList.toggle('is-active',dark);
  themeLight.setAttribute('aria-pressed',dark?'false':'true');
  themeDark.setAttribute('aria-pressed',dark?'true':'false');
  themeLight.title=dark?'Switch canvas to Light mode':'Light canvas active';
  themeDark.title=dark?'Dark canvas active':'Switch canvas to Dark mode';

  if(persist) storeTheme(dark?'dark':'light');
}

function updateZoomControls(){
  const index=ZOOM_LEVELS.indexOf(zoom);
  const value=Math.round(zoom*100)+'%';
  zoomValue.value=value;
  zoomValue.textContent=value;
  zoomValue.title='Pipeline canvas zoom · Ctrl/⌘ + wheel zooms around the cursor';
  zoomOut.disabled=index<=0;
  zoomIn.disabled=index<0||index>=ZOOM_LEVELS.length-1;
  zoomOut.title='Zoom out · '+value;
  zoomIn.title='Zoom in · '+value;
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

function setZoom(next,persist=false,anchorClient=null){
  if(!ZOOM_LEVELS.includes(next)||next===zoom) return false;

  const oldZoom=zoom;
  const rect=canvas.getBoundingClientRect();
  const viewportX=anchorClient&&Number.isFinite(anchorClient.clientX)
    ?Math.max(0,Math.min(canvas.clientWidth,anchorClient.clientX-rect.left))
    :canvas.clientWidth/2;
  const viewportY=anchorClient&&Number.isFinite(anchorClient.clientY)
    ?Math.max(0,Math.min(canvas.clientHeight,anchorClient.clientY-rect.top))
    :canvas.clientHeight/2;

  const logicalAnchorX=(canvas.scrollLeft+viewportX)/oldZoom;
  const logicalAnchorY=(canvas.scrollTop+viewportY)/oldZoom;

  zoom=next;
  canvas.style.setProperty('--pipeline-zoom',String(zoom));
  refreshPositionedNodes();
  updateZoomControls();
  if(persist) storeZoom(zoom);

  requestAnimationFrame(()=>{
    canvas.scrollLeft=Math.max(0,logicalAnchorX*zoom-viewportX);
    canvas.scrollTop=Math.max(0,logicalAnchorY*zoom-viewportY);
    document.dispatchEvent(new CustomEvent('raptor:pipelinezoomchange',{
      detail:{zoom,anchorClient:anchorClient?{clientX:anchorClient.clientX,clientY:anchorClient.clientY}:null}
    }));
  });
  return true;
}

function zoomByStep(step,persist=false,anchorClient=null){
  const index=ZOOM_LEVELS.indexOf(zoom);
  if(index<0) return false;
  const nextIndex=Math.max(0,Math.min(ZOOM_LEVELS.length-1,index+step));
  if(nextIndex===index) return false;
  return setZoom(ZOOM_LEVELS[nextIndex],persist,anchorClient);
}

themeLight.addEventListener('click',()=>applyTheme('light',true));
themeDark.addEventListener('click',()=>applyTheme('dark',true));

zoomOut.addEventListener('click',()=>zoomByStep(-1,true));
zoomIn.addEventListener('click',()=>zoomByStep(1,true));

canvas.addEventListener('wheel',event=>{
  if(!(event.ctrlKey||event.metaKey)) return;
  if(!Number.isFinite(event.deltaY)||event.deltaY===0) return;
  event.preventDefault();
  zoomByStep(event.deltaY<0?1:-1,true,{clientX:event.clientX,clientY:event.clientY});
},{passive:false});

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
