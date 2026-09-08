(()=>{
'use strict';

const selector='.xo-filter-parameter-popover';
const savedPosition=new WeakMap();

function viewportBox(){
  const viewport=window.visualViewport||null;
  const left=viewport?.offsetLeft||0;
  const top=viewport?.offsetTop||0;
  const width=viewport?.width||window.innerWidth;
  const height=viewport?.height||window.innerHeight;
  return {left,top,right:left+width,bottom:top+height};
}

function clampPosition(popover,left,top){
  const box=viewportBox();
  const margin=6;
  const width=popover.offsetWidth||252;
  const height=popover.offsetHeight||150;
  return {
    left:Math.max(box.left+margin,Math.min(box.right-width-margin,left)),
    top:Math.max(box.top+margin,Math.min(box.bottom-height-margin,top))
  };
}

function setPosition(popover,left,top,remember=true){
  const next=clampPosition(popover,left,top);
  popover.style.left=next.left+'px';
  popover.style.top=next.top+'px';
  if(remember) savedPosition.set(popover,next);
  return next;
}

function labelText(field){
  return String(field?.querySelector(':scope > span')?.textContent||'').trim();
}

function renameField(field,text,ariaLabel){
  const label=field?.querySelector(':scope > span');
  if(label) label.textContent=text;
  const control=field?.querySelector('input,select');
  if(control&&ariaLabel) control.setAttribute('aria-label',ariaLabel);
}

function layoutBandpass(popover){
  if(!popover.classList.contains('is-bandpass')) return;
  const body=popover.querySelector('.xo-filter-parameter-popover-body');
  if(!body||body.querySelector('.xo-filter-bandpass-columns')) return;

  const fields=[...body.querySelectorAll(':scope > .xo-filter-parameter-field')];
  const find=name=>fields.find(field=>labelText(field)===name)||null;
  const lowpassSlope=find('Lowpass Slope');
  const highpassSlope=find('Highpass Slope');
  const lowFrequency=find('Low Frequency');
  const highFrequency=find('High Frequency');
  if(!(lowpassSlope&&highpassSlope&&lowFrequency&&highFrequency)) return;

  renameField(highFrequency,'Frequency','Lowpass Frequency in Hz');
  renameField(lowFrequency,'Frequency','Highpass Frequency in Hz');

  const columns=document.createElement('div');
  columns.className='xo-filter-bandpass-columns';

  const left=document.createElement('section');
  left.className='xo-filter-bandpass-side xo-filter-bandpass-side--lowpass';
  left.setAttribute('aria-label','Lowpass settings');

  const right=document.createElement('section');
  right.className='xo-filter-bandpass-side xo-filter-bandpass-side--highpass';
  right.setAttribute('aria-label','Highpass settings');

  left.append(lowpassSlope,highFrequency);
  right.append(highpassSlope,lowFrequency);
  columns.append(left,right);
  body.appendChild(columns);
}

function startDrag(event,popover,head){
  if(event.button!==undefined&&event.button!==0) return;
  if(event.target.closest('button,input,select,textarea,a,label')) return;
  if(event.cancelable) event.preventDefault();

  const rect=popover.getBoundingClientRect();
  const dx=event.clientX-rect.left;
  const dy=event.clientY-rect.top;
  const pointerId=event.pointerId;
  popover.classList.add('is-window-dragging');
  try{head.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    if(moveEvent.cancelable) moveEvent.preventDefault();
    setPosition(popover,moveEvent.clientX-dx,moveEvent.clientY-dy,true);
  };

  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    popover.classList.remove('is-window-dragging');
    try{if(head.hasPointerCapture(pointerId)) head.releasePointerCapture(pointerId)}catch{}
  };

  window.addEventListener('pointermove',move,{passive:false});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
}

function enhancePopover(popover){
  if(!(popover instanceof HTMLElement)||popover.dataset.parameterWindowV2==='1') return;
  popover.dataset.parameterWindowV2='1';
  layoutBandpass(popover);

  const head=popover.querySelector('.xo-filter-parameter-popover-head');
  if(head){
    head.classList.add('xo-filter-parameter-drag-handle');
    head.addEventListener('pointerdown',event=>startDrag(event,popover,head));
  }
}

function scan(){
  document.querySelectorAll(selector).forEach(enhancePopover);
}

function restoreMovedWindows(){
  requestAnimationFrame(()=>{
    document.querySelectorAll(selector).forEach(popover=>{
      const saved=savedPosition.get(popover);
      if(saved) setPosition(popover,saved.left,saved.top,true);
    });
  });
}

if(!document.getElementById('crossoverParameterWindowV2Style')){
  const style=document.createElement('style');
  style.id='crossoverParameterWindowV2Style';
  style.textContent=`
    .xo-filter-parameter-drag-handle{
      cursor:grab;
      touch-action:none
    }
    .xo-filter-parameter-popover.is-window-dragging .xo-filter-parameter-drag-handle{
      cursor:grabbing
    }
    .xo-filter-parameter-popover.is-window-dragging{
      box-shadow:0 16px 38px rgba(18,26,34,.30)
    }

    .xo-filter-parameter-popover.is-bandpass{
      width:min(500px,calc(100vw - 16px))
    }
    .xo-filter-parameter-popover.is-bandpass .xo-filter-parameter-popover-body{
      display:block;
      padding:12px
    }
    .xo-filter-bandpass-columns{
      display:grid;
      grid-template-columns:minmax(0,1fr) minmax(0,1fr);
      align-items:stretch
    }
    .xo-filter-bandpass-side{
      min-width:0;
      display:grid;
      gap:10px;
      padding:2px 16px 2px 2px
    }
    .xo-filter-bandpass-side--highpass{
      padding:2px 2px 2px 16px;
      border-left:1px solid #cbd3d9
    }
    .xo-filter-parameter-popover.is-bandpass .xo-filter-bandpass-side .xo-filter-parameter-field{
      grid-template-columns:minmax(82px,.9fr) minmax(84px,1fr);
      gap:8px
    }
    .xo-filter-parameter-popover.is-bandpass .xo-filter-bandpass-side .xo-filter-parameter-field>span{
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap
    }

    @media(max-width:520px){
      .xo-filter-parameter-popover.is-bandpass{
        width:calc(100vw - 12px)
      }
      .xo-filter-parameter-popover.is-bandpass .xo-filter-parameter-popover-body{
        padding:9px
      }
      .xo-filter-bandpass-side{
        gap:8px;
        padding:1px 9px 1px 1px
      }
      .xo-filter-bandpass-side--highpass{
        padding:1px 1px 1px 9px
      }
      .xo-filter-parameter-popover.is-bandpass .xo-filter-bandpass-side .xo-filter-parameter-field{
        grid-template-columns:minmax(68px,.9fr) minmax(66px,1fr);
        gap:5px;
        font-size:8px
      }
      .xo-filter-parameter-popover.is-bandpass .xo-filter-bandpass-side .xo-filter-parameter-field select,
      .xo-filter-parameter-popover.is-bandpass .xo-filter-bandpass-side .xo-filter-parameter-field input[type="number"]{
        height:32px;
        padding:0 5px;
        font-size:9px
      }
    }
  `;
  document.head.appendChild(style);
}

scan();
new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
window.addEventListener('resize',restoreMovedWindows,{passive:true});
window.visualViewport?.addEventListener('resize',restoreMovedWindows,{passive:true});
window.visualViewport?.addEventListener('scroll',restoreMovedWindows,{passive:true});
})();
