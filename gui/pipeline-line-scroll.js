(()=>{
'use strict';

const scroller=document.querySelector('.pipeline-strip .pipeline-scroll');
const row=document.getElementById('pipelineRow');
if(!scroller||!row) return;

const strip=scroller.closest('.pipeline-strip');
if(!strip) return;

if(!document.getElementById('pipelineLineScrollStyle')){
  const style=document.createElement('style');
  style.id='pipelineLineScrollStyle';
  style.textContent=`
    .pipeline-line-nav{
      flex:0 0 auto;
      height:40px;
      display:flex;
      align-items:stretch;
      overflow:hidden;
      border:1px solid #aeb9c4;
      border-radius:6px;
      background:#fff;
      box-shadow:0 2px 7px rgba(28,38,48,.07)
    }
    .pipeline-line-nav[hidden]{display:none!important}
    .pipeline-line-nav-button{
      width:30px;
      height:38px;
      padding:0;
      border:0;
      background:#f7f9fa;
      color:#34414c;
      font-size:19px;
      font-weight:800;
      line-height:1;
      cursor:pointer;
      touch-action:manipulation;
      user-select:none
    }
    .pipeline-line-nav-button + .pipeline-line-nav-button{
      border-left:1px solid #c3cbd2
    }
    .pipeline-line-nav-button:hover:not(:disabled){
      background:#eef2f4;
      color:#a94a0b
    }
    .pipeline-line-nav-button:disabled{
      color:#aab3ba;
      background:#f7f9fa;
      cursor:default
    }
    @media(max-width:700px){
      .pipeline-line-nav-button{width:28px}
    }
  `;
  document.head.appendChild(style);
}

let nav=strip.querySelector('.pipeline-line-nav');
if(!nav){
  nav=document.createElement('div');
  nav.className='pipeline-line-nav';
  nav.setAttribute('role','group');
  nav.setAttribute('aria-label','RAPTOR Line horizontal navigation');

  const left=document.createElement('button');
  left.type='button';
  left.className='pipeline-line-nav-button pipeline-line-nav-button--left';
  left.setAttribute('aria-label','Scroll RAPTOR Lines left');
  left.title='Scroll RAPTOR Lines left';
  left.textContent='‹';

  const right=document.createElement('button');
  right.type='button';
  right.className='pipeline-line-nav-button pipeline-line-nav-button--right';
  right.setAttribute('aria-label','Scroll RAPTOR Lines right');
  right.title='Scroll RAPTOR Lines right';
  right.textContent='›';

  nav.append(left,right);
  strip.insertBefore(nav,scroller);
}

const leftButton=nav.querySelector('.pipeline-line-nav-button--left');
const rightButton=nav.querySelector('.pipeline-line-nav-button--right');

function scrollAmount(){
  return Math.max(180,Math.round(scroller.clientWidth*.68));
}

function updateControls(){
  const max=Math.max(0,scroller.scrollWidth-scroller.clientWidth);
  const overflowing=max>1;
  nav.hidden=!overflowing;
  if(!overflowing){
    leftButton.disabled=true;
    rightButton.disabled=true;
    if(scroller.scrollLeft!==0) scroller.scrollLeft=0;
    return;
  }
  leftButton.disabled=scroller.scrollLeft<=1;
  rightButton.disabled=scroller.scrollLeft>=max-1;
}

leftButton.addEventListener('click',()=>{
  scroller.scrollBy({left:-scrollAmount(),behavior:'smooth'});
});
rightButton.addEventListener('click',()=>{
  scroller.scrollBy({left:scrollAmount(),behavior:'smooth'});
});

scroller.addEventListener('scroll',updateControls,{passive:true});
scroller.addEventListener('wheel',event=>{
  if(scroller.scrollWidth<=scroller.clientWidth+1) return;
  if(Math.abs(event.deltaX)>=Math.abs(event.deltaY)) return;
  scroller.scrollLeft+=event.deltaY;
  if(event.cancelable) event.preventDefault();
},{passive:false});

new MutationObserver(mutations=>{
  const addedCard=mutations.some(mutation=>
    Array.from(mutation.addedNodes).some(node=>
      node?.nodeType===1&&node.classList?.contains('pipeline-card')
    )
  );
  requestAnimationFrame(()=>{
    updateControls();
    if(addedCard){
      scroller.scrollTo({left:scroller.scrollWidth,behavior:'smooth'});
    }
  });
}).observe(row,{childList:true});

if('ResizeObserver' in window){
  new ResizeObserver(()=>requestAnimationFrame(updateControls)).observe(scroller);
}else{
  window.addEventListener('resize',()=>requestAnimationFrame(updateControls),{passive:true});
}

requestAnimationFrame(updateControls);
})();
