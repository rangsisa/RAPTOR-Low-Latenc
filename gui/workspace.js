const navItems=[...document.querySelectorAll('.nav-item')];
const canvas=document.getElementById('workspaceCanvas');
const pageViews=[...document.querySelectorAll('.page-view')];
const addPipelineButton=document.getElementById('addPipeline');
const pipelineRow=document.getElementById('pipelineRow');

const editModal=document.getElementById('pipelineEditModal');
const editClose=document.getElementById('pipelineEditClose');
const nameInput=document.getElementById('pipelineNameInput');
const duplicateButton=document.getElementById('pipelineDuplicate');
const deleteButton=document.getElementById('pipelineDelete');
const doneButton=document.getElementById('pipelineDone');

deleteButton.textContent='Delete Pipeline';

let pipelineSequence=0;
let lineIdSequence=0;
let editingCard=null;

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

const TOOL_PAGES=new Set(['raptor-editor','nga-editor','nga-auto-zero']);
const toolContexts=new Map();

function renderToolContext(toolId,context={}){
  const label=document.querySelector('[data-tool-context="'+toolId+'"]');
  if(!label) return;

  const lineName=context.lineName||'';
  const fileName=context.fileName||'';
  if(lineName&&fileName){
    label.textContent='Pipeline · '+lineName+' · '+fileName;
  }else if(lineName){
    label.textContent='Pipeline · '+lineName+' · no input connected';
  }else{
    label.textContent='Pipeline context · no input connected';
  }
}

function openTool(toolId,detail={}){
  const id=String(toolId||'').trim();
  if(!TOOL_PAGES.has(id)) return;

  const previous=toolContexts.get(id)||{};
  const hasPipelineContext=
    detail.lineId!==undefined||
    detail.lineName!==undefined||
    detail.fileId!==undefined||
    detail.fileName!==undefined||
    detail.slot!==undefined;

  const context=hasPipelineContext?{...previous,...detail}:{...previous};
  toolContexts.set(id,context);
  renderToolContext(id,context);

  canvas.dataset.tool=id;
  activate(id);

  const nextHash='#'+encodeURIComponent(id);
  if(location.hash!==nextHash) history.pushState({page:id,tool:id},'',nextHash);

  document.dispatchEvent(new CustomEvent('raptor:toolchange',{
    detail:{toolId:id,...context,source:detail.source||context.source||'workspace'}
  }));
}

function restoreRouteFromHash(){
  const direct=decodeURIComponent(location.hash.replace(/^#/,''));
  let toolId=TOOL_PAGES.has(direct)?direct:null;

  // Backward compatibility for links created before Target Editor was removed.
  if(!toolId){
    const legacy=location.hash.match(/^#target-editor\/([^/?#]+)/);
    const legacyId=legacy?decodeURIComponent(legacy[1]):'';
    if(TOOL_PAGES.has(legacyId)) toolId=legacyId;
  }

  if(!toolId) return false;
  canvas.dataset.tool=toolId;
  renderToolContext(toolId,toolContexts.get(toolId)||{});
  activate(toolId);
  document.dispatchEvent(new CustomEvent('raptor:toolchange',{detail:{toolId,...(toolContexts.get(toolId)||{}),source:'route'}}));
  return true;
}

function defaultLineName(){
  const index=pipelineSequence++;
  return index===0?'RAPTOR Line':`RAPTOR Line ${index}`;
}

function allLineNames(exceptCard=null){
  return [...pipelineRow.querySelectorAll('.pipeline-card')]
    .filter(card=>card!==exceptCard)
    .map(card=>card.dataset.lineName || '');
}

function uniqueCopyName(sourceName){
  const names=new Set(allLineNames());
  const base=`${sourceName} Copy`;
  if(!names.has(base)) return base;
  let n=2;
  while(names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function createPipelineCard(name=defaultLineName()){
  const card=document.createElement('article');
  card.className='pipeline-card';
  card.dataset.lineId=String(lineIdSequence++);
  card.dataset.lineName=name;
  card._raptorLineState=window.RaptorPipeline?.createState?.() || null;

  const title=document.createElement('div');
  title.className='pipeline-card-name';
  title.textContent=name;

  const load=document.createElement('button');
  load.className='pipeline-card-action pipeline-load';
  load.type='button';
  load.textContent='Load';
  load.setAttribute('aria-pressed','false');
  load.addEventListener('click',()=>window.RaptorPipeline?.load?.(card));

  const edit=document.createElement('button');
  edit.className='pipeline-card-action';
  edit.type='button';
  edit.textContent='Edit';
  edit.addEventListener('click',()=>openEdit(card));

  card.append(title,load,edit);
  pipelineRow.appendChild(card);
  return card;
}

function addPipeline(){
  const card=createPipelineCard();
  card.scrollIntoView({behavior:'auto',block:'nearest',inline:'end'});
}

function openEdit(card){
  if(editingCard && editingCard!==card) editingCard.classList.remove('is-editing');
  editingCard=card;
  editingCard.classList.add('is-editing');
  nameInput.value=card.dataset.lineName || '';
  editModal.hidden=false;
  requestAnimationFrame(()=>{
    nameInput.focus({preventScroll:true});
    nameInput.select();
  });
}

function closeEdit(){
  if(editingCard) editingCard.classList.remove('is-editing');
  editingCard=null;
  editModal.hidden=true;
}

function applyRename(){
  if(!editingCard) return;
  const next=nameInput.value.trim();
  if(!next){
    nameInput.value=editingCard.dataset.lineName || '';
    return;
  }
  editingCard.dataset.lineName=next;
  editingCard.querySelector('.pipeline-card-name').textContent=next;
  window.RaptorPipeline?.onRename?.(editingCard);
}

function duplicateCurrent(){
  if(!editingCard) return;
  applyRename();
  const sourceCard=editingCard;
  const sourceName=sourceCard.dataset.lineName || 'RAPTOR Line';
  const clone=createPipelineCard(uniqueCopyName(sourceName));
  clone._raptorLineState=window.RaptorPipeline?.cloneState?.(sourceCard._raptorLineState) || clone._raptorLineState;
  clone.scrollIntoView({behavior:'auto',block:'nearest',inline:'end'});
}

function deleteCurrent(){
  if(!editingCard) return;
  const card=editingCard;
  window.RaptorPipeline?.onDelete?.(card);
  closeEdit();
  card.remove();
}

navItems.forEach(button=>button.addEventListener('click',()=>{
  const page=button.dataset.page;
  if(TOOL_PAGES.has(page)){
    openTool(page,{source:'workspace-nav'});
    return;
  }

  canvas.dataset.tool='';
  activate(page);

  if(location.hash){
    history.pushState({page},'',location.pathname+location.search);
  }
}));
addPipelineButton.addEventListener('click',addPipeline);
editClose.addEventListener('click',closeEdit);
doneButton.addEventListener('click',()=>{applyRename();closeEdit()});
duplicateButton.addEventListener('click',duplicateCurrent);
deleteButton.addEventListener('click',deleteCurrent);

nameInput.addEventListener('keydown',event=>{
  if(event.key==='Enter'){
    event.preventDefault();
    applyRename();
    closeEdit();
  }
  if(event.key==='Escape'){
    event.preventDefault();
    closeEdit();
  }
});

editModal.addEventListener('pointerdown',event=>{
  if(event.target===editModal) closeEdit();
});

document.addEventListener('keydown',event=>{
  if(event.key==='Escape' && !editModal.hidden) closeEdit();
});

window.RaptorWorkspace=Object.freeze({
  activate,
  openTool,
  getCurrentPage:()=>canvas.dataset.page||'',
  getCurrentTool:()=>canvas.dataset.tool||'',
  getToolContext:toolId=>({...toolContexts.get(String(toolId||''))})
});

window.addEventListener('popstate',()=>{
  if(!restoreRouteFromHash()) activate('pipeline');
});

// Pipeline is the initial workspace page unless a tool route is present.
canvas.dataset.page='';
if(!restoreRouteFromHash()) activate('pipeline');
