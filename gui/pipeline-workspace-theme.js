(()=>{
'use strict';

const STORAGE_KEY='raptor.pipeline.canvas.theme.v1';
const canvas=document.getElementById('pipelineNodeCanvas');
const toggle=document.getElementById('pipelineCanvasThemeToggle');
if(!canvas||!toggle) return;

function readStoredTheme(){
  try{
    const value=window.localStorage.getItem(STORAGE_KEY);
    return value==='dark'?'dark':'light';
  }catch{
    return 'light';
  }
}

function storeTheme(theme){
  try{window.localStorage.setItem(STORAGE_KEY,theme);}catch{}
}

function applyTheme(theme,persist=false){
  const dark=theme==='dark';
  canvas.classList.toggle('is-dark-canvas',dark);
  toggle.setAttribute('aria-pressed',dark?'true':'false');
  toggle.setAttribute('aria-label',dark?'Switch Pipeline workspace to light mode':'Switch Pipeline workspace to dark mode');
  toggle.textContent=dark?'☀ Light':'☾ Dark';
  if(persist) storeTheme(dark?'dark':'light');
}

toggle.addEventListener('click',()=>{
  applyTheme(canvas.classList.contains('is-dark-canvas')?'light':'dark',true);
});

applyTheme(readStoredTheme(),false);
})();
