(()=>{
'use strict';

const PANEL_SELECTOR='.xo-filter-parameter-popover';
const BANDPASS_SELECTOR='.xo-filter-parameter-popover.is-bandpass';
const ENHANCED_ATTR='data-crossover-parameter-window';

function ensureStyle(){
  if(document.getElementById('raptorCrossoverParameterWindowStyle')) return;
  const style=document.createElement('style');
  style.id='raptorCrossoverParameterWindowStyle';
  style.textContent=`
    ${PANEL_SELECTOR} .xo-filter-parameter-popover-head{
      cursor:grab;
      touch-action:none
    }
    ${PANEL_SELECTOR}.is-crossover-editor-dragging .xo-filter-parameter-popover-head{
      cursor:grabbing
    }
    ${PANEL_SELECTOR}.is-crossover-editor-dragging{
      box-shadow:0 16px 38px rgba(18,26,34,.30)
    }
    ${BANDPASS_SELECTOR}{
      width:min(520px,calc(100vw - 16px));
      max-width:none
    }
    ${BANDPASS_SELECTOR} .xo-filter-parameter-popover-body.is-bandpass-side-layout{
      display:grid;
      grid-template-columns:minmax(0,1fr) minmax(0,1fr);
      gap:0;
      padding:11px 0
    }
    ${BANDPASS_SELECTOR} .xo-bandpass-side{
      min-width:0;
      display:grid;
      align-content:start;
      gap:10px;
      padding:0 14px
    }
    ${BANDPASS_SELECTOR} .xo-bandpass-side--highpass{
      border-left:1px solid #d4dbe0
    }
    ${BANDPASS_SELECTOR} .xo-bandpass-side .xo-filter-parameter-field{
      min-width:0;
      grid-template-columns:92px minmax(0,1fr);
      gap:8px
    }
    ${BANDPASS_SELECTOR} .xo-bandpass-side .xo-filter-parameter-field>span{
      white-space:nowrap
    }
    @media(max-width:560px){
      ${BANDPASS_SELECTOR}{width:min(430px,calc(100vw - 12px))}
      ${BANDPASS_SELECTOR} .xo-bandpass-side{padding:0 8px;gap:8px}
      ${BANDPASS_SELECTOR} .xo-bandpass-side .xo-filter-parameter-field{
        grid-template-columns:72px minmax(0,1fr);
        gap:5px;
        font-size:8px
      }
      ${BANDPASS_SELECTOR} .xo-bandpass-side .xo-filter-parameter-field select,
      ${BANDPASS_SELECTOR} .xo-bandpass-side .xo-filter-parameter-field input[type="number"]{
        height:32px;
        padding:0 6px;
        font-size:9px
      }
    }
  `;
  document.head.appendChild(style);
}

function fieldByName(body,name){
  return [...body.querySelectorAll(':scope > .xo-filter-parameter-field')].find(field=>
    field.querySelector(':scope > span')?.textContent?.trim()===name
  )||null;
}

function renameField(field,label,ariaLabel){
  const name=field?.querySelector(':scope > span');
  if(name) name.textContent=label;
  const control=field?.querySelector('input,select');
  if(control&&ariaLabel) control.setAttribute('aria-label',ariaLabel);
}

function clampPanelPosition(left,top,panel){
  const viewport=window.visualViewport||null;
  const viewportLeft=viewport?.offsetLeft||0;
  const viewportTop=viewport?.offsetTop||0;
  const viewportWidth=viewport?.width||window.innerWidth;
  const viewportHeight=viewport?.height||window.innerHeight;
  const width=panel.offsetWidth||(panel.classList.contains('is-bandpass')?520:252);
  const height=panel.offsetHeight||150;
  const margin=6;
  return {
    left:Math.max(viewportLeft+margin,Math.min(viewportLeft+viewportWidth-width-margin,left)),
    top:Math.max(viewportTop+margin,Math.min(viewportTop+viewportHeight-height-margin,top))
  };
}

function restoreUserPosition(panel){
  if(panel.dataset.crossoverUserPositioned!=='1'||panel.classList.contains('is-crossover-editor-dragging')) return;
  const left=Number(panel.dataset.crossoverUserLeft);
  const top=Number(panel.dataset.crossoverUserTop);
  if(!(Number.isFinite(left)&&Number.isFinite(top))) return;
  const pos=clampPanelPosition(left,top,panel);
  panel.style.left=pos.left+'px';
  panel.style.top=pos.top+'px';
  panel.dataset.crossoverUserLeft=String(pos.left);
  panel.dataset.crossoverUserTop=String(pos.top);
}

function startDrag(event,panel){
  if(event.button!==undefined&&event.button!==0) return;
  if(event.target.closest('button,input,label,select,textarea,a')) return;
  if(event.cancelable) event.preventDefault();
  event.stopPropagation();

  const head=event.currentTarget;
  const pointerId=event.pointerId;
  const rect=panel.getBoundingClientRect();
  const dx=event.clientX-rect.left;
  const dy=event.clientY-rect.top;
  panel.classList.add('is-crossover-editor-dragging');
  try{head.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    if(moveEvent.cancelable) moveEvent.preventDefault();
    const pos=clampPanelPosition(moveEvent.clientX-dx,moveEvent.clientY-dy,panel);
    panel.style.left=pos.left+'px';
    panel.style.top=pos.top+'px';
    panel.dataset.crossoverUserLeft=String(pos.left);
    panel.dataset.crossoverUserTop=String(pos.top);
    panel.dataset.crossoverUserPositioned='1';
  };

  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    panel.classList.remove('is-crossover-editor-dragging');
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    try{if(head.hasPointerCapture(pointerId)) head.releasePointerCapture(pointerId)}catch{}
    restoreUserPosition(panel);
  };

  window.addEventListener('pointermove',move,{passive:false});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
}

function applyBandpassSideLayout(panel,body){
  if(!panel.classList.contains('is-bandpass')||body.classList.contains('is-bandpass-side-layout')) return;

  const highpassSlope=fieldByName(body,'Highpass Slope');
  const lowFrequency=fieldByName(body,'Low Frequency');
  const lowpassSlope=fieldByName(body,'Lowpass Slope');
  const highFrequency=fieldByName(body,'High Frequency');
  if(!(highpassSlope&&lowFrequency&&lowpassSlope&&highFrequency)) return;

  const lowpassSide=document.createElement('div');
  lowpassSide.className='xo-bandpass-side xo-bandpass-side--lowpass';
  lowpassSide.setAttribute('aria-label','Lowpass settings');
  const highpassSide=document.createElement('div');
  highpassSide.className='xo-bandpass-side xo-bandpass-side--highpass';
  highpassSide.setAttribute('aria-label','Highpass settings');

  // UI order only: LP lives on the left and HP on the right.
  // DSP ownership remains unchanged: LP uses highFrequencyHz, HP uses lowFrequencyHz.
  renameField(highFrequency,'Frequency','Lowpass Frequency in Hz');
  renameField(lowFrequency,'Frequency','Highpass Frequency in Hz');
  lowpassSide.append(lowpassSlope,highFrequency);
  highpassSide.append(highpassSlope,lowFrequency);
  body.replaceChildren(lowpassSide,highpassSide);
  body.classList.add('is-bandpass-side-layout');
}

function enhancePanel(panel){
  if(!(panel instanceof HTMLElement)||panel.hasAttribute(ENHANCED_ATTR)) return;
  const body=panel.querySelector('.xo-filter-parameter-popover-body');
  const head=panel.querySelector('.xo-filter-parameter-popover-head');
  if(!body||!head) return;

  applyBandpassSideLayout(panel,body);
  head.addEventListener('pointerdown',event=>startDrag(event,panel));
  panel.setAttribute(ENHANCED_ATTR,'1');
}

function scan(){
  document.querySelectorAll(PANEL_SELECTOR).forEach(enhancePanel);
}

function restoreAfterViewportChange(){
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    document.querySelectorAll(PANEL_SELECTOR+'['+ENHANCED_ATTR+']').forEach(restoreUserPosition);
  }));
}

ensureStyle();
scan();
new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
window.addEventListener('resize',restoreAfterViewportChange,{passive:true});
window.visualViewport?.addEventListener('resize',restoreAfterViewportChange,{passive:true});
window.visualViewport?.addEventListener('scroll',restoreAfterViewportChange,{passive:true});
})();
