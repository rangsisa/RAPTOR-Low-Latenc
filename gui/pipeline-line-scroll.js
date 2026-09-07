(()=>{
'use strict';

const scroller=document.querySelector('.pipeline-strip .pipeline-scroll');
const row=document.getElementById('pipelineRow');
if(!scroller||!row) return;

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
  if(!addedCard) return;
  requestAnimationFrame(()=>{
    scroller.scrollTo({left:scroller.scrollWidth,behavior:'smooth'});
  });
}).observe(row,{childList:true});
})();
