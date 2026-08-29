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

const TOOL_PAGES=new Set(['nga-auto-zero']);
const TOOL_SLOTS=Object.freeze({
  'nga-auto-zero':'autoZero'
});
const toolContexts=new Map();
const toolInputs=new Map();

function formatContextRate(value){
  if(!Number.isFinite(value)||value<=0) return '';
  return value>=1000?((value/1000).toFixed(value%1000?1:0)+' kHz'):(value+' Hz');
}

function formatContextFrequency(value){
  if(!Number.isFinite(value)||value<=0) return '';
  if(value>=1000){
    const digits=value>=10000?1:2;
    return (value/1000).toFixed(digits).replace(/\.0+$/,'')+' kHz';
  }
  return value.toFixed(value<10?3:value<100?2:1).replace(/\.0+$/,'')+' Hz';
}

function hasExplicitPipelineContext(detail={}){
  return detail.lineId!==undefined||
    detail.lineName!==undefined||
    detail.fileId!==undefined||
    detail.fileName!==undefined||
    detail.slot!==undefined;
}

function resolvePipelineToolInput(toolId,detail={}){
  const slot=detail.slot||TOOL_SLOTS[toolId];
  const activeLine=window.RaptorPipeline?.getActiveLine?.()||null;

  let lineId=detail.lineId!==undefined?detail.lineId:(activeLine?.id??null);
  let lineName=detail.lineName!==undefined?detail.lineName:(activeLine?.name||'');
  let fileId=detail.fileId!==undefined?detail.fileId:null;

  // Deleted Target Editor/Node 2 no longer supplies tool inputs implicitly.
  // Only an explicit Pipeline handoff may bind a measurement to a tool page.
  if(activeLine&&lineId!==null&&String(lineId)!==String(activeLine.id)){
    lineId=activeLine.id;
    lineName=activeLine.name||'';
    fileId=null;
  }

  const entry=fileId?window.RaptorPipeline?.getMeasurement?.(fileId):null;
  const canonical=fileId?window.RaptorPipeline?.getMeasurementCanonical?.(fileId):null;

  let views=null;
  if(canonical&&window.RaptorMeasurementCanonicalV1){
    window.RaptorMeasurementCanonicalV1.validate(canonical);
    views=window.RaptorMeasurementCanonicalV1.views(canonical);
  }

  const context={
    ...detail,
    slot,
    lineId,
    lineName,
    fileId:entry?.id||null,
    fileName:entry?.name||'',
    points:canonical?.points||0,
    sampleRate:entry?.sampleRate??canonical?.sample_rate_hz??null,
    fftSize:entry?.fftSize??canonical?.base_fft_size??null,
    binHz:entry?.binHz??null,
    fMin:entry?.fMin??null,
    fMax:entry?.fMax??null,
    format:canonical?.format||null,
    payloadSha256:canonical?.payload_sha256||null
  };

  return {context,entry,canonical,views};
}

function bindToolWorkspaceInput(toolId,resolved){
  const body=document.querySelector('[data-tool-body="'+toolId+'"]');
  if(!body) return;

  const input={
    context:{...resolved.context},
    entry:resolved.entry||null,
    canonical:resolved.canonical||null,
    views:resolved.views||null
  };

  body._raptorInput=input;
  body.dataset.inputState=resolved.canonical?'ready':'empty';
  body.dataset.pipelineId=resolved.context.lineId??'';
  body.dataset.measurementId=resolved.context.fileId??'';
  body.dataset.slot=resolved.context.slot||TOOL_SLOTS[toolId]||'';
}

function renderToolContext(toolId,context={}){
  const label=document.querySelector('[data-tool-context="'+toolId+'"]');
  if(!label) return;

  const parts=[];
  if(context.lineName) parts.push('Pipeline: '+context.lineName);
  else parts.push('Pipeline: none');

  if(context.fileName){
    parts.push('Input: '+context.fileName);
    if(context.points) parts.push(context.points+' pts');

    const rate=formatContextRate(context.sampleRate);
    if(rate) parts.push(rate);

    if(context.fftSize) parts.push('FFT '+context.fftSize);

    const fMin=formatContextFrequency(context.fMin);
    const fMax=formatContextFrequency(context.fMax);
    if(fMin&&fMax) parts.push(fMin+' – '+fMax);

    if(context.format==='raptor.measurement.canonical.v1') parts.push('Canonical V1');
  }else{
    parts.push('Input: not connected');
  }

  const text=parts.join('  ·  ');
  label.textContent=text;
  label.title=text;
}

function openTool(toolId,detail={}){
  const id=String(toolId||'').trim();
  if(!TOOL_PAGES.has(id)) return;

  const previous=toolContexts.get(id)||{};
  const explicitPipelineContext=hasExplicitPipelineContext(detail);
  const base=explicitPipelineContext
    ?{...previous,...detail}
    :{source:detail.source||previous.source||'workspace-nav',slot:TOOL_SLOTS[id]};
  const resolved=resolvePipelineToolInput(id,base);
  const context=resolved.context;

  toolContexts.set(id,context);
  toolInputs.set(id,resolved);
  bindToolWorkspaceInput(id,resolved);
  renderToolContext(id,context);

  canvas.dataset.tool=id;
  activate(id);

  const nextHash='#'+encodeURIComponent(id);
  if(location.hash!==nextHash) history.pushState({page:id,tool:id},'',nextHash);

  const eventDetail={
    toolId:id,
    ...context,
    source:detail.source||context.source||'workspace',
    canonical:resolved.canonical,
    views:resolved.views
  };

  document.dispatchEvent(new CustomEvent('raptor:toolchange',{detail:eventDetail}));
  document.dispatchEvent(new CustomEvent('raptor:toolinput',{detail:eventDetail}));
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
  const resolved=resolvePipelineToolInput(toolId,{source:'route',slot:TOOL_SLOTS[toolId]});
  toolContexts.set(toolId,resolved.context);
  toolInputs.set(toolId,resolved);
  bindToolWorkspaceInput(toolId,resolved);
  renderToolContext(toolId,resolved.context);
  activate(toolId);
  document.dispatchEvent(new CustomEvent('raptor:toolchange',{
    detail:{
      toolId,
      ...resolved.context,
      source:'route',
      canonical:resolved.canonical,
      views:resolved.views
    }
  }));
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

  for(const [toolId,context] of toolContexts){
    if(String(context.lineId??'')!==String(editingCard.dataset.lineId??'')) continue;
    const resolved=resolvePipelineToolInput(toolId,{...context,lineName:next});
    toolContexts.set(toolId,resolved.context);
    toolInputs.set(toolId,resolved);
    bindToolWorkspaceInput(toolId,resolved);
    renderToolContext(toolId,resolved.context);
  }
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
  getToolContext:toolId=>({...toolContexts.get(String(toolId||''))}),
  getToolInput(toolId){
    const id=String(toolId||'');
    const resolved=toolInputs.get(id)||resolvePipelineToolInput(id,toolContexts.get(id)||{});
    return {
      context:{...resolved.context},
      entry:resolved.entry||null,
      canonical:resolved.canonical||null,
      views:resolved.views||null
    };
  },
  refreshTool(toolId){
    const id=String(toolId||'');
    if(!TOOL_PAGES.has(id)) return null;
    const resolved=resolvePipelineToolInput(id,toolContexts.get(id)||{});
    toolContexts.set(id,resolved.context);
    toolInputs.set(id,resolved);
    bindToolWorkspaceInput(id,resolved);
    renderToolContext(id,resolved.context);
    return resolved;
  }
});

window.addEventListener('popstate',()=>{
  if(!restoreRouteFromHash()) activate('pipeline');
});

// Pipeline is the initial workspace page unless a tool route is present.
canvas.dataset.page='';
if(!restoreRouteFromHash()) activate('pipeline');
