(()=>{
const FILE_COLORS=['#2f6f9f','#e86f17','#2e8b57','#8b5cf6','#d14b4b','#0f8b8d','#b7791f','#5b6770'];
const COMMON_SAMPLE_RATES=[44100,48000,88200,96000,176400,192000];
const FFT_SIZES=Array.from({length:13},(_,i)=>2**(8+i));
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
const preview=document.getElementById('measurementPreview');
const previewCanvas=document.getElementById('measurementPreviewCanvas');
const previewTitle=document.getElementById('measurementPreviewTitle');
const previewDot=document.getElementById('measurementPreviewDot');
const previewClose=document.getElementById('measurementPreviewClose');
const previewRate=document.getElementById('measurementPreviewRate');
const previewFft=document.getElementById('measurementPreviewFft');
const previewPoints=document.getElementById('measurementPreviewPoints');
const previewBin=document.getElementById('measurementPreviewBin');
const previewRange=document.getElementById('measurementPreviewRange');
let activeCard=null;
let selectionMode=false;
let selectedIds=new Set();
let colorTarget=null;
let previewEntry=null;
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
  closePreview();
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
  closePreview();
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

function inferAcquisition(buffer,points){
  if(!(buffer instanceof ArrayBuffer)||points<2) return {sampleRate:null,fftSize:null,binHz:null,fMin:null,fMax:null};
  const frequency=new Float64Array(buffer,0,points);
  const steps=[];
  for(let i=1;i<Math.min(points,96);i++){
    const delta=frequency[i]-frequency[i-1];
    if(Number.isFinite(delta)&&delta>0) steps.push(delta);
  }
  const positiveFirst=Number.isFinite(frequency[0])&&frequency[0]>0?frequency[0]:Infinity;
  const binHz=Math.min(positiveFirst,...steps);
  let best=null;
  if(Number.isFinite(binHz)&&binHz>0){
    for(const sampleRate of COMMON_SAMPLE_RATES){
      for(const fftSize of FFT_SIZES){
        const expected=sampleRate/fftSize;
        const relative=Math.abs(expected-binHz)/expected;
        if(!best||relative<best.relative) best={sampleRate,fftSize,relative};
      }
    }
  }
  if(!best||best.relative>.001) best=null;
  const finite=[...frequency].filter(Number.isFinite);
  return {
    sampleRate:best?.sampleRate||null,
    fftSize:best?.fftSize||null,
    binHz:Number.isFinite(binHz)?binHz:null,
    fMin:finite.length?Math.min(...finite):null,
    fMax:finite.length?Math.max(...finite):null
  };
}

async function convertFile(file,entry){
  try{
    const sourceBuffer=await file.arrayBuffer();
    const text=new TextDecoder('utf-8').decode(sourceBuffer);
    const parsed=parseMeasurement(text);
    const acquisition=inferAcquisition(parsed.buffer,parsed.points);
    entry.sourceBuffer=sourceBuffer;
    entry.buffer=parsed.buffer;
    entry.points=parsed.points;
    entry.columns=parsed.columns;
    entry.sampleRate=acquisition.sampleRate;
    entry.fftSize=acquisition.fftSize;
    entry.binHz=acquisition.binHz;
    entry.fMin=acquisition.fMin;
    entry.fMax=acquisition.fMax;
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
      sampleRate:null,
      fftSize:null,
      binHz:null,
      fMin:null,
      fMax:null,
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
  fileSummary.innerHTML=`<strong>${files.length}</strong> measurement${files.length===1?'':'s'} · converted immediately on import`;
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
    output.title='Tap to preview · drag to connect';
    output.setAttribute('aria-label',`Preview or connect ${entry.name}`);
    output.disabled=selectionMode||entry.status!=='ready';
    output.addEventListener('pointerdown',event=>handleOutputPointerDown(event,entry,output));

    row.append(checkbox,color,info,output);
    fileList.appendChild(row);
  }
}

function openColorMenu(button,entry){
  closePreview();
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
  closePreview();
  renderFiles();
}

function formatRate(value){
  if(!value) return 'Unknown';
  return value>=1000?`${(value/1000).toFixed(value%1000?1:0)} kHz`:`${value} Hz`;
}

function formatFrequency(value){
  if(!Number.isFinite(value)) return '—';
  if(value>=1000) return `${(value/1000).toFixed(value>=10000?1:2).replace(/\.0+$/,'')} kHz`;
  return `${value.toFixed(value<10?3:value<100?2:1).replace(/\.0+$/,'')} Hz`;
}

function drawPreview(entry){
  const canvas=previewCanvas;
  const ctx=canvas.getContext('2d');
  const dpr=Math.max(1,window.devicePixelRatio||1);
  const w=canvas.clientWidth||286;
  const h=canvas.clientHeight||138;
  canvas.width=Math.round(w*dpr);
  canvas.height=Math.round(h*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle='#fbfcfd';
  ctx.fillRect(0,0,w,h);
  if(!(entry.buffer instanceof ArrayBuffer)||!entry.points||entry.columns<2) return;

  const points=entry.points;
  const frequency=new Float64Array(entry.buffer,0,points);
  const magnitude=new Float64Array(entry.buffer,points*8,points);
  const phase=entry.columns>=3?new Float64Array(entry.buffer,points*16,points):null;
  const positive=[];
  const mags=[];
  for(let i=0;i<points;i++){
    if(Number.isFinite(frequency[i])&&frequency[i]>0) positive.push(frequency[i]);
    if(Number.isFinite(magnitude[i])) mags.push(magnitude[i]);
  }
  if(!positive.length||!mags.length) return;
  const f0=Math.min(...positive),f1=Math.max(...positive);
  const log0=Math.log10(f0),log1=Math.log10(f1);
  let magMin=Math.min(...mags),magMax=Math.max(...mags);
  const center=(magMin+magMax)/2;
  const span=Math.max(12,magMax-magMin);
  magMin=center-span*.58;
  magMax=center+span*.58;
  const L=27,R=w-27,T=11,B=h-18;
  const xOf=f=>L+(Math.log10(f)-log0)/(log1-log0)*(R-L);
  const yMag=v=>B-(v-magMin)/(magMax-magMin)*(B-T);
  const yPhase=v=>B-(Math.max(-180,Math.min(180,v))+180)/360*(B-T);

  ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y=T+(B-T)*i/4;
    ctx.strokeStyle=i===2?'#b8c2cb':'#d9dfe4';
    ctx.beginPath();ctx.moveTo(L,y+.5);ctx.lineTo(R,y+.5);ctx.stroke();
  }
  const decades=[20,50,100,200,500,1000,2000,5000,10000,20000,50000];
  ctx.font='7px Arial,sans-serif';
  ctx.fillStyle='#7a8791';
  ctx.textAlign='center';
  ctx.textBaseline='top';
  for(const f of decades){
    if(f<f0||f>f1) continue;
    const x=xOf(f);
    ctx.strokeStyle='#d7dde2';
    ctx.beginPath();ctx.moveTo(x+.5,T);ctx.lineTo(x+.5,B);ctx.stroke();
    if([20,100,1000,10000,20000].includes(f)) ctx.fillText(f>=1000?`${f/1000}k`:`${f}`,x,B+4);
  }
  ctx.strokeStyle='#9eabb5';
  ctx.strokeRect(L+.5,T+.5,R-L-1,B-T-1);
  ctx.textAlign='right';ctx.textBaseline='top';ctx.fillStyle='#687580';
  ctx.fillText(`${magMax.toFixed(1)}`,L-4,T-2);
  ctx.textBaseline='bottom';ctx.fillText(`${magMin.toFixed(1)}`,L-4,B+1);
  ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText('180°',R+4,T-2);
  ctx.textBaseline='bottom';ctx.fillText('-180°',R+4,B+1);

  ctx.strokeStyle='#26323d';
  ctx.lineWidth=1.25;
  ctx.lineJoin='round';
  ctx.beginPath();
  let magStarted=false;
  for(let i=0;i<points;i++){
    const f=frequency[i],v=magnitude[i];
    if(!(Number.isFinite(f)&&f>0&&Number.isFinite(v))) continue;
    const x=xOf(f),y=yMag(v);
    magStarted?ctx.lineTo(x,y):ctx.moveTo(x,y);
    magStarted=true;
  }
  if(magStarted) ctx.stroke();

  if(phase){
    ctx.strokeStyle='#2f6f9f';
    ctx.lineWidth=1.15;
    let started=false,previous=null;
    ctx.beginPath();
    for(let i=0;i<points;i++){
      const f=frequency[i],v=phase[i];
      if(!(Number.isFinite(f)&&f>0&&Number.isFinite(v))) continue;
      const x=xOf(f),y=yPhase(v);
      if(!started||previous===null||Math.abs(v-previous)>300){
        if(started) ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x,y);
        started=true;
      }else ctx.lineTo(x,y);
      previous=v;
    }
    if(started) ctx.stroke();
  }
}

function openPreview(handle,entry){
  if(entry.status!=='ready') return;
  closeColorMenu();
  previewEntry=entry;
  previewTitle.textContent=entry.name;
  previewDot.style.background=entry.color;
  previewRate.textContent=formatRate(entry.sampleRate);
  previewFft.textContent=entry.fftSize?String(entry.fftSize):'Unknown';
  previewPoints.textContent=entry.points?String(entry.points):'—';
  previewBin.textContent=formatFrequency(entry.binHz);
  previewRange.textContent=`${formatFrequency(entry.fMin)} – ${formatFrequency(entry.fMax)}`;
  preview.hidden=false;
  const rect=handle.getBoundingClientRect();
  const width=preview.offsetWidth||286;
  const height=preview.offsetHeight||230;
  let left=rect.right+10;
  if(left+width>window.innerWidth-6) left=rect.left-width-10;
  left=Math.max(6,Math.min(window.innerWidth-width-6,left));
  let top=rect.top-height*.42;
  top=Math.max(6,Math.min(window.innerHeight-height-6,top));
  preview.style.left=`${left}px`;
  preview.style.top=`${top}px`;
  requestAnimationFrame(()=>drawPreview(entry));
}

function closePreview(){
  previewEntry=null;
  preview.hidden=true;
}

function wireGeometry(entry,handle){
  const canvasRect=nodeCanvas.getBoundingClientRect();
  const handleRect=handle.getBoundingClientRect();
  return {
    canvasRect,
    startX:handleRect.left+handleRect.width/2-canvasRect.left+nodeCanvas.scrollLeft,
    startY:handleRect.top+handleRect.height/2-canvasRect.top+nodeCanvas.scrollTop,
    color:entry.color
  };
}

function drawWireTo(geometry,event){
  const endX=event.clientX-geometry.canvasRect.left+nodeCanvas.scrollLeft;
  const endY=event.clientY-geometry.canvasRect.top+nodeCanvas.scrollTop;
  const bend=Math.max(48,Math.abs(endX-geometry.startX)*.38);
  wirePath.setAttribute('stroke',geometry.color);
  wirePath.setAttribute('d',`M ${geometry.startX} ${geometry.startY} C ${geometry.startX+bend} ${geometry.startY}, ${endX-bend} ${endY}, ${endX} ${endY}`);
}

function handleOutputPointerDown(event,entry,handle){
  if(handle.disabled) return;
  event.preventDefault();
  const pointerId=event.pointerId;
  const originX=event.clientX,originY=event.clientY;
  const geometry=wireGeometry(entry,handle);
  let dragging=false;
  closePreview();
  try{handle.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    const distance=Math.hypot(moveEvent.clientX-originX,moveEvent.clientY-originY);
    if(!dragging&&distance>=7) dragging=true;
    if(dragging) drawWireTo(geometry,moveEvent);
  };
  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    try{if(handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)}catch{}
    if(dragging) wirePath.removeAttribute('d');
    else openPreview(handle,entry);
  };
  window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
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
  closePreview();
  renderFiles();
});

deleteButton.addEventListener('click',()=>{
  if(!activeCard||!selectedIds.size) return;
  const measurement=ensureState(activeCard).nodes.measurement;
  measurement.files=measurement.files.filter(file=>!selectedIds.has(file.id));
  selectedIds.clear();
  selectionMode=false;
  closePreview();
  renderFiles();
});

colorMenu.querySelectorAll('.file-color-choice').forEach(button=>{
  button.addEventListener('click',()=>chooseColor(button.dataset.color));
});

previewClose.addEventListener('click',closePreview);

document.addEventListener('pointerdown',event=>{
  if(!colorMenu.hidden&&!colorMenu.contains(event.target)&&!event.target.closest('.measurement-color')) closeColorMenu();
  if(!preview.hidden&&!preview.contains(event.target)&&!event.target.closest('.measurement-output')) closePreview();
});

window.addEventListener('resize',()=>{
  if(!preview.hidden&&previewEntry) closePreview();
});

window.RaptorPipeline={createState,cloneState,load,onRename,onDelete,refresh:renderFiles};
})();
