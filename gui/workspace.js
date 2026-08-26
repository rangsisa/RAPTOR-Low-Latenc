const navItems=[...document.querySelectorAll('.nav-item')];
const canvas=document.getElementById('workspaceCanvas');
const pageViews=[...document.querySelectorAll('.page-view')];
const addPipelineButton=document.getElementById('addPipeline');
const pipelineRow=document.getElementById('pipelineRow');
let pipelineCount=0;

function activate(page){
  if(canvas.dataset.page===page) return;

  navItems.forEach(button=>{
    const active=button.dataset.page===page;
    button.classList.toggle('is-active',active);
    if(active) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });

  pageViews.forEach(view=>{
    const active=view.dataset.view===page;
    view.hidden=!active;
    view.classList.toggle('is-page-active',active);
  });

  canvas.dataset.page=page;
}

function addPipeline(){
  const index=pipelineCount++;
  const name=index===0?'RAPTOR Line':`RAPTOR Line ${index}`;

  const card=document.createElement('article');
  card.className='pipeline-card';
  card.dataset.pipelineIndex=String(index);

  const title=document.createElement('div');
  title.className='pipeline-card-name';
  title.textContent=name;

  const load=document.createElement('button');
  load.className='pipeline-card-action';
  load.type='button';
  load.textContent='Load';

  const edit=document.createElement('button');
  edit.className='pipeline-card-action';
  edit.type='button';
  edit.textContent='Edit';

  card.append(title,load,edit);
  pipelineRow.appendChild(card);
  card.scrollIntoView({behavior:'auto',block:'nearest',inline:'end'});
}

navItems.forEach(button=>button.addEventListener('click',()=>activate(button.dataset.page)));
addPipelineButton.addEventListener('click',addPipeline);

// Pipeline is the initial workspace page. No transition is used between views.
canvas.dataset.page='';
activate('pipeline');
