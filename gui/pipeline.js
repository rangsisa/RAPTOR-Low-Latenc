(()=>{
const FILE_COLORS=['#2f6f9f','#e86f17','#2e8b57','#8b5cf6','#d14b4b','#0f8b8d','#b7791f','#5b6770'];
const nodeCanvas=document.getElementById('pipelineNodeCanvas');
const emptyState=document.getElementById('pipelineNodeEmpty');
const measurementNode=document.getElementById('measurementNode');
const activeLineLabel=document.getElementById('measurementLineLabel');
const fileInput=document.getElementById('measurementFileInput');
const fileList=document.getElementById('measurementList');
const fileSummary=document.getElementById('measurementSummary');
const selectButton=document.getElementById('measurementSelect');
const deleteButton=document.getElementById('measurementDelete');
const countLabel=document.getElementById('measurementCount');
const colorMenu=document.getElementById('fileColorMenu');
const wirePath=document.getElementById('pipelineWirePreview');
let activeCard=null;
let selectionMode=false;
let selectedIds=new Set();
let colorTarget=null;
let fileIdSequence=0;

function createState(){
  return {version:1,nodes:{measurement:{files:[]}}};
}

function cloneState(state){
  const source=state||createState();
  const files=(source.nodes?.measurement?.files||[]).map(file=>({
    ...file,
    sourceBuffer:file.sourceBuffer instanceof ArrayBuffer?file.sourceBuffer.slice(0):file.sourceBuffer,
    buffer:file.buffer instanceof ArrayBuffer?file.buffer.slice(0):file.buffer
  }));
  return {version:source.version||1,nodes:{measurement:{files}}};
}

function ensureState(card){
  if(!card._raptorLineState) card._raptorLineState=createState();
  if(!card._raptorLineState.nodes) card._raptorLineState.nodes={};
  if(!card._raptorLineState.nodes.measurement) card._raptorLineState.nodes.measurement={files:[]};
  return card._raptorLineState;
}

function activeFiles(){
  return activeCard?ensureState(activeCard).nodes.measurement.files:[];
}

function load(card){
  if(activeCard) activeCard.classList.remove('is-loaded');
  activeCard=card;
  activeCard.classList.add('is-loaded');
  ensureState(card);
  selectionMode=false;
  selectedIds.clear();
  closeColorMenu();
  emptyState.hidden=true;
  measurementNode.hidden=false;
  activeLineLabel.textContent=card.dataset.lineName||'RAPTOR Line';
  renderFiles();
}

function clearLoaded(){
  if(activeCard) activeCard.classList.remove('is-loaded');
  activeCard=null;
  selectionMode=false;
  selectedIds.clear();
  measurementNode.hidden=true;
  emptyState.hidden=false;
  wirePath.removeAttribute('d');
  closeColorMenu();
}

function onRename(card){
  if(card===activeCard) activeLineLabel.textContent=card.dataset.lineName||'RAPTOR Line';
}

function onDelete(card){
  if(card===activeCard) clearLoaded();
}

function hexTint(hex,alpha=.09){
  const value=hex.replace('#','');
  const full=value.length===3?value.split('').map(c=>c+c).join(''):value;
  const n=parseInt(full,16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`;
}

function parseMeasurement(text){
  const rows=[];
  let maxColumns=0;
  for(const rawLine of text.split(/\r?\n/)){
    const line=rawLine.trim();
    if(!line) continue;
    const tokens=line.replace(/^\uFEFF/,'').split(/[\s,;]+/).filter(Boolean);
    const nums=[];
    for(let i=0;i<Math.min(4,tokens.length);i++){
      const value=Number(tokens[i]);
      if(!Number.isFinite(value)) break;
      nums.push(value);
    }
    if(nums.length>=2){
      rows.push(nums);
      if(nums.length>maxColumns) maxColumns=nums.length;
    }
  }
  if(!rows.length) throw new Error('No numeric measurement rows found');
  const columns=Math.max(2,Math.min(4,maxColumns));
  const points=rows.length;
  const buffer=new ArrayBuffer(points*columns*8);
  for(let c=0;c<columns;c++){
    const view=new Float64Array(buffer,c*points*8,points);
    for(let r=0;r<points;r++) view[r]=Number.isFinite(rows[r][c])?rows[r][c]:NaN;
  }
  return {points,columns,buffer};
}

async function convertFile(file,entry){
  try{
    const sourceBuffer=await file.arrayBuffer();
    const text=new TextDecoder('utf-8').decode(sourceBuffer);
    const parsed=parseMeasurement(text);
    entry.sourceBuffer=sourceBuffer;
    entry.buffer=parsed.buffer;
    entry.points=parsed.points;
    entry.columns=parsed.columns;
    entry.status='ready';
    entry.error='';
  }catch(error){
    entry.status='error';
    entry.error=error instanceof Error?error.message:'Conversion failed';
  }
}

async function importFiles(files){
  if(!activeCard||!files.length) return;
  const target=activeFiles();
  for(const file of files){
    const entry={
      id:`measurement-${Date.now()}-${fileIdSequence++}`,
      name:file.name,
      color:FILE_COLORS[target.length%FILE_COLORS.length],
      status:'converting',
      points:0,
      columns:0,
      size:file.size,
      sourceBuffer:null,
      buffer:null,
      error:''
    };
    target.push(entry);
    renderFiles();
    await new Promise(resolve=>setTimeout(resolve,0));
    await convertFile(file,entry);
    renderFiles();
  }
}

function renderFiles(){
  if(!activeCard) return;
  const files=activeFiles();
  measurementNode.classList.toggle('is-selecting',selectionMode);
  selectButton.setAttribute('aria-pressed',String(selectionMode));
  fileSummary.innerHTML=`<strong>${files.length}</strong> measurement${files.length===1?'':'s'} · imported files are converted on load`;
  countLabel.textContent=selectionMode?`${selectedIds.size} selected`:`${files.length} files`;
  deleteButton.hidden=!selectionMode||selectedIds.size===0;
  deleteButton.textContent=selectedIds.size?`Delete ${selectedIds.size}`:'Delete';
  fileList.replaceChildren();
  if(!files.length){
    const empty=document.createElement('div');
    empty.className='measurement-empty';
    empty.textContent='No measurement files imported';
    fileList.appendChild(empty);
    return;
  }
  for(const entry of files){
    const row=document.createElement('div');
    row.className='measurement-file'+(selectedIds.has(entry.id)?' is-selected':'')+(entry.status==='error'?' is-error':'');
    row.style.setProperty('--file-color',entry.color);
    row.style.setProperty('--file-tint',hexTint(entry.color));

    const checkbox=document.createElement('input');
    checkbox.className='measurement-file-check';
    checkbox.type='checkbox';
    checkbox.checked=selectedIds.has(entry.id);
    checkbox.setAttribute('aria-label',`Select ${entry.name}`);
    checkbox.addEventListener('change',()=>{
      checkbox.checked?selectedIds.add(entry.id):selectedIds.delete(entry.id);
      renderFiles();
    });

    const color=document.createElement('button');
    color.className='measurement-color';
    color.type='button';
    color.title='File color';
    color.setAttribute('aria-label',`Choose color for ${entry.name}`);
    color.addEventListener('click',event=>openColorMenu(event.currentTarget,entry));

    const info=document.createElement('div');
    info.className='measurement-file-info';
    const name=document.createElement('span');
    name.className='measurement-file-name';
    name.textContent=entry.name;
    const meta=document.createElement('span');
    meta.className='measurement-file-meta';
    if(entry.status==='converting') meta.textContent='Converting…';
    else if(entry.status==='error') meta.textContent=`Import error · ${entry.error}`;
    else meta.textContent=`Converted · ${entry.points} pts · ${entry.columns} cols`;
    info.append(name,meta);

    const output=document.createElement('button');
    output.className='measurement-output';
    output.type='button';
    output.title='Drag to connect';
    output.setAttribute('aria-label',`Output for ${entry.name}`);
    output.disabled=selectionMode||entry.status!=='ready';
    output.addEventListener('pointerdown',event=>startWire(event,entry,output));

    row.append(checkbox,color,info,output);
    fileList.appendChild(row);
  }
}

function openColorMenu(button,entry){
  colorTarget=entry;
  const rect=button.getBoundingClientRect();
  colorMenu.style.left=`${Math.min(window.innerWidth-118,Math.max(6,rect.left-5))}px`;
  colorMenu.style.top=`${Math.min(window.innerHeight-70,rect.bottom+5)}px`;
  colorMenu.hidden=false;
}

function closeColorMenu(){
  colorTarget=null;
  colorMenu.hidden=true;
}

function chooseColor(color){
  if(!colorTarget) return;
  colorTarget.color=color;
  closeColorMenu();
  renderFiles();
}

function startWire(event,entry,handle){
  if(handle.disabled) return;
  event.preventDefault();
  const canvasRect=nodeCanvas.getBoundingClientRect();
  const handleRect=handle.getBoundingClientRect();
  const startX=handleRect.left+handleRect.width/2-canvasRect.left+nodeCanvas.scrollLeft;
  const startY=handleRect.top+handleRect.height/2-canvasRect.top+nodeCanvas.scrollTop;
  wirePath.setAttribute('stroke',entry.color);
  const move=moveEvent=>{
    const endX=moveEvent.clientX-canvasRect.left+nodeCanvas.scrollLeft;
    const endY=moveEvent.clientY-canvasRect.top+nodeCanvas.scrollTop;
    const bend=Math.max(48,Math.abs(endX-startX)*.38);
    wirePath.setAttribute('d',`M ${startX} ${startY} C ${startX+bend} ${startY}, ${endX-bend} ${endY}, ${endX} ${endY}`);
  };
  const end=()=>{
    wirePath.removeAttribute('d');
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
  };
  move(event);
  window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerup',end,{once:true});
  window.addEventListener('pointercancel',end,{once:true});
}

fileInput.addEventListener('change',async()=>{
  const files=[...fileInput.files];
  fileInput.value='';
  await importFiles(files);
});

selectButton.addEventListener('click',()=>{
  selectionMode=!selectionMode;
  if(!selectionMode) selectedIds.clear();
  closeColorMenu();
  renderFiles();
});

deleteButton.addEventListener('click',()=>{
  if(!activeCard||!selectedIds.size) return;
  const measurement=ensureState(activeCard).nodes.measurement;
  measurement.files=measurement.files.filter(file=>!selectedIds.has(file.id));
  selectedIds.clear();
  selectionMode=false;
  renderFiles();
});

colorMenu.querySelectorAll('.file-color-choice').forEach(button=>{
  button.addEventListener('click',()=>chooseColor(button.dataset.color));
});

document.addEventListener('pointerdown',event=>{
  if(!colorMenu.hidden&&!colorMenu.contains(event.target)&&!event.target.closest('.measurement-color')) closeColorMenu();
});

window.RaptorPipeline={createState,cloneState,load,onRename,onDelete,refresh:renderFiles};
})();
