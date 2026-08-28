(()=>{
const FILE_COLORS=['#4DA3FF','#FF9F43','#55D187','#A78BFA','#FF6B6B','#36CFC9','#F6C85F','#8FA6B8'];
const canonicalV1=window.RaptorMeasurementCanonicalV1;
if(!canonicalV1) throw new Error('measurement-canonical-v1.js must load before pipeline.js');
const COMMON_SAMPLE_RATES=[44100,48000,88200,96000,176400,192000];
const FFT_SIZES=Array.from({length:13},(_,i)=>2**(8+i));
const nodeCanvas=document.getElementById('pipelineNodeCanvas');
const emptyState=document.getElementById('pipelineNodeEmpty');
const measurementNode=document.getElementById('measurementNode');
const measurementHead=measurementNode.querySelector('.measurement-node-head');
const activeLineLabel=document.getElementById('measurementLineLabel');
const fileInput=document.getElementById('measurementFileInput');
const fileList=document.getElementById('measurementList');
const fileSummary=document.getElementById('measurementSummary');
const selectButton=document.getElementById('measurementSelect');
const deleteButton=document.getElementById('measurementDelete');
const countLabel=document.getElementById('measurementCount');
const colorMenu=document.getElementById('fileColorMenu');
const wirePath=document.getElementById('pipelineWirePreview');
const wireLayer=wirePath.closest('svg');
const inputRegistry=new Map();
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
let previewAnchor=null;
let fileIdSequence=0;

function createState(){
  return {version:1,nodes:{measurement:{files:[],position:null}}};
}

function cloneState(state){
  const source=state||createState();
  const measurement=source.nodes?.measurement||{};
  const files=(measurement.files||[]).map(file=>{
    const canonical=file.canonical?canonicalV1.clone(file.canonical):null;
    return {
      ...file,
      sourceBuffer:file.sourceBuffer instanceof ArrayBuffer?file.sourceBuffer.slice(0):file.sourceBuffer,
      canonical,
      // Compatibility bridge only. Canonical V1 remains authoritative.
      buffer:canonical?.data?.buffer||null,
      points:canonical?.points||file.points||0,
      columns:canonical?.column_count||file.columns||0
    };
  });
  const position=measurement.position?{...measurement.position}:null;
  return {version:source.version||1,nodes:{measurement:{files,position}}};
}

function ensureState(card){
  if(!card._raptorLineState) card._raptorLineState=createState();
  if(!card._raptorLineState.nodes) card._raptorLineState.nodes={};
  if(!card._raptorLineState.nodes.measurement) card._raptorLineState.nodes.measurement={files:[],position:null};
  const measurement=card._raptorLineState.nodes.measurement;
  if(!Array.isArray(measurement.files)) measurement.files=[];
  if(measurement.position===undefined) measurement.position=null;
  return card._raptorLineState;
}

function activeFiles(){
  return activeCard?ensureState(activeCard).nodes.measurement.files:[];
}

function setLoadState(card,active){
  if(!card) return;
  card.classList.toggle('is-loaded',active);
  const button=card.querySelector('.pipeline-load')||card.querySelector('.pipeline-card-action');
  if(button) button.setAttribute('aria-pressed',String(active));
}

function applyMeasurementPosition(){
  if(!activeCard||measurementNode.hidden) return;
  const measurement=ensureState(activeCard).nodes.measurement;
  let x=24;
  let y=Math.max(12,(nodeCanvas.clientHeight-measurementNode.offsetHeight)/2);
  if(measurement.position&&Number.isFinite(measurement.position.x)&&Number.isFinite(measurement.position.y)){
    x=measurement.position.x;
    y=measurement.position.y;
  }
  measurementNode.style.transform='none';
  measurementNode.style.left=`${Math.max(8,x)}px`;
  measurementNode.style.top=`${Math.max(8,y)}px`;
}

function load(card){
  if(activeCard&&activeCard!==card) setLoadState(activeCard,false);
  activeCard=card;
  setLoadState(activeCard,true);
  ensureState(card);
  selectionMode=false;
  selectedIds.clear();
  closeColorMenu();
  closePreview();
  emptyState.hidden=true;
  measurementNode.hidden=false;
  activeLineLabel.textContent=card.dataset.lineName||'RAPTOR Line';
  renderFiles();
  requestAnimationFrame(applyMeasurementPosition);
}

function clearLoaded(){
  if(activeCard) setLoadState(activeCard,false);
  activeCard=null;
  selectionMode=false;
  selectedIds.clear();
  measurementNode.hidden=true;
  measurementNode.classList.remove('is-wiring','is-dragging');
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

function registerInput(id,element,options={}){
  if(!id||!element) return;
  inputRegistry.set(id,{id,element,...options});
}

function unregisterInput(id){
  inputRegistry.delete(id);
}

function hexTint(hex,alpha=.09){
  const value=hex.replace('#','');
  const full=value.length===3?value.split('').map(c=>c+c).join(''):value;
  const n=parseInt(full,16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`;
}

function extractDeclaredSampleRate(text){
  const head=String(text||'').split(/\r?\n/).slice(0,32).join('\n');
  const patterns=[
    /(?:sample\s*rate|samplerate|sample_rate_hz)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(khz|hz)?/i,
    /(?:^|[\s,;])fs\s*[:=]\s*(\d+(?:\.\d+)?)\s*(khz|hz)?/im
  ];

  for(const pattern of patterns){
    const match=head.match(pattern);
    if(!match) continue;
    let value=Number(match[1]);
    if(!Number.isFinite(value)||value<=0) continue;
    if(String(match[2]||'').toLowerCase()==='khz') value*=1000;
    if(value>=8000&&value<=768000) return value;
  }
  return null;
}

function sampleRateFromFrequencyCoverage(fMax){
  if(!Number.isFinite(fMax)||fMax<=0) return null;

  // Fallback only when source metadata does not declare Sample Rate.
  // This uses measured frequency coverage, never FFT/bin spacing.
  const candidates=COMMON_SAMPLE_RATES
    .map(sampleRate=>({
      sampleRate,
      nyquist:sampleRate/2,
      coverage:fMax/(sampleRate/2)
    }))
    .filter(candidate=>fMax<=candidate.nyquist*1.01)
    .filter(candidate=>candidate.coverage>=0.85)
    .sort((a,b)=>Math.abs(1-a.coverage)-Math.abs(1-b.coverage));

  return candidates[0]?.sampleRate||null;
}

function inferAcquisition(canonical,declaredSampleRate=null){
  canonicalV1.validate(canonical);
  const {frequency_hz:frequency}=canonicalV1.views(canonical);
  const points=canonical.points;
  const fMin=frequency[0]||null;
  const fMax=frequency[points-1]||null;

  if(points<2){
    const sampleRate=Number.isFinite(declaredSampleRate)&&declaredSampleRate>0
      ?declaredSampleRate
      :sampleRateFromFrequencyCoverage(fMax);
    return {
      sampleRate,
      sampleRateSource:Number.isFinite(declaredSampleRate)&&declaredSampleRate>0?'source':'frequency-range',
      fftSize:null,
      binHz:null,
      fMin,
      fMax
    };
  }

  const steps=[];
  for(let i=1;i<Math.min(points,96);i++){
    const delta=frequency[i]-frequency[i-1];
    if(Number.isFinite(delta)&&delta>0) steps.push(delta);
  }
  const positiveFirst=frequency[0]>0?frequency[0]:Infinity;
  const binHz=Math.min(positiveFirst,...steps);

  const hasDeclared=Number.isFinite(declaredSampleRate)&&declaredSampleRate>0;
  const sampleRate=hasDeclared
    ?declaredSampleRate
    :sampleRateFromFrequencyCoverage(fMax);

  // FFT is secondary metadata only. It may be estimated only after Sample Rate
  // is already authoritative; it must never determine or overwrite Sample Rate.
  let fftSize=null;
  if(sampleRate&&Number.isFinite(binHz)&&binHz>0){
    let best=null;
    for(const candidate of FFT_SIZES){
      const expected=sampleRate/candidate;
      const relative=Math.abs(expected-binHz)/expected;
      if(!best||relative<best.relative) best={fftSize:candidate,relative};
    }
    if(best&&best.relative<=0.001) fftSize=best.fftSize;
  }

  return {
    sampleRate,
    sampleRateSource:hasDeclared?'source':(sampleRate?'frequency-range':null),
    fftSize,
    binHz:Number.isFinite(binHz)?binHz:null,
    fMin,
    fMax
  };
}

function attachCanonical(entry,canonical){
  canonicalV1.validate(canonical);
  entry.canonical=canonical;

  // Compatibility aliases for code being migrated. These are not authority.
  entry.buffer=canonical.data.buffer;
  entry.points=canonical.points;
  entry.columns=canonical.column_count;
}

async function convertFile(file,entry){
  try{
    const sourceBuffer=await file.arrayBuffer();
    const text=new TextDecoder('utf-8').decode(sourceBuffer);
    const canonical=canonicalV1.parseText(text,{
      measurementId:entry.id,
      sourceName:file.name
    });
    const declaredSampleRate=extractDeclaredSampleRate(text);
    const acquisition=inferAcquisition(canonical,declaredSampleRate);

    canonical.sample_rate_hz=acquisition.sampleRate;
    canonical.base_fft_size=acquisition.fftSize;
    canonical.payload_sha256=await canonicalV1.sha256(canonical);

    entry.sourceBuffer=sourceBuffer;
    attachCanonical(entry,canonical);
    entry.sampleRate=acquisition.sampleRate;
    entry.sampleRateSource=acquisition.sampleRateSource;
    entry.fftSize=acquisition.fftSize;
    entry.binHz=acquisition.binHz;
    entry.fMin=acquisition.fMin;
    entry.fMax=acquisition.fMax;
    entry.status='ready';
    entry.error='';
  }catch(error){
    entry.canonical=null;
    entry.buffer=null;
    entry.points=0;
    entry.columns=0;
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
      sampleRateSource:null,
      fftSize:null,
      binHz:null,
      fMin:null,
      fMax:null,
      sourceBuffer:null,
      canonical:null,
      // Compatibility bridge only; Canonical V1 is authoritative.
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
  fileSummary.innerHTML=`<strong>${files.length}</strong> measurement${files.length===1?'':'s'} · converted`;
  countLabel.textContent=selectionMode?`${selectedIds.size} selected`:`${files.length} files`;
  deleteButton.hidden=!selectionMode||selectedIds.size===0;
  deleteButton.textContent=selectedIds.size?`Delete ${selectedIds.size}`:'Delete';
  fileList.replaceChildren();
  if(!files.length){
    const empty=document.createElement('div');
    empty.className='measurement-empty';
    empty.textContent='No measurement files imported';
    fileList.appendChild(empty);
    requestAnimationFrame(applyMeasurementPosition);
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
    else meta.textContent=`Canonical V1 · ${entry.points} pts · 4 cols`;
    info.append(name,meta);

    const previewButton=document.createElement('button');
    previewButton.className='measurement-preview-button';
    previewButton.type='button';
    previewButton.textContent='📈';
    previewButton.title='Preview measurement';
    previewButton.setAttribute('aria-label',`Preview ${entry.name}`);
    previewButton.setAttribute('aria-pressed','false');
    previewButton.disabled=selectionMode||entry.status!=='ready';
    previewButton.addEventListener('click',()=>openPreview(previewButton,entry));

    const output=document.createElement('button');
    output.className='measurement-output';
    output.type='button';
    output.title='Drag to connect';
    output.setAttribute('aria-label',`Connect ${entry.name}`);
    output.disabled=selectionMode||entry.status!=='ready';
    output.addEventListener('pointerdown',event=>startWire(event,entry,output));

    row.append(checkbox,color,info,previewButton,output);
    fileList.appendChild(row);
  }
  requestAnimationFrame(applyMeasurementPosition);
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
  ctx.fillStyle='#f7fcf8';
  ctx.fillRect(0,0,w,h);
  if(!entry.canonical) return;
  canonicalV1.validate(entry.canonical);

  const points=entry.canonical.points;
  const {
    frequency_hz:frequency,
    magnitude_db:magnitude,
    phase_deg:phase
  }=canonicalV1.views(entry.canonical);
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
    ctx.strokeStyle=i===2?'#a9c6b1':'#d7e7db';
    ctx.beginPath();ctx.moveTo(L,y+.5);ctx.lineTo(R,y+.5);ctx.stroke();
  }
  const decades=[20,50,100,200,500,1000,2000,5000,10000,20000,50000];
  ctx.font='7px Arial,sans-serif';
  ctx.fillStyle='#5f7769';
  ctx.textAlign='center';
  ctx.textBaseline='top';
  for(const f of decades){
    if(f<f0||f>f1) continue;
    const x=xOf(f);
    ctx.strokeStyle='#d7e7db';
    ctx.beginPath();ctx.moveTo(x+.5,T);ctx.lineTo(x+.5,B);ctx.stroke();
    if([20,100,1000,10000,20000].includes(f)) ctx.fillText(f>=1000?`${f/1000}k`:`${f}`,x,B+4);
  }
  ctx.strokeStyle='#8eae98';
  ctx.strokeRect(L+.5,T+.5,R-L-1,B-T-1);
  ctx.textAlign='right';ctx.textBaseline='top';ctx.fillStyle='#5f7769';
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

function openPreview(anchor,entry){
  if(entry.status!=='ready') return;
  if(!preview.hidden&&previewEntry?.id===entry.id){
    closePreview();
    return;
  }
  closePreview();
  closeColorMenu();
  previewEntry=entry;
  previewAnchor=anchor;
  previewAnchor.classList.add('is-preview-open');
  previewAnchor.setAttribute('aria-pressed','true');
  previewTitle.textContent=entry.name;
  previewDot.style.background=entry.color;
  previewRate.textContent=formatRate(entry.sampleRate);
  previewFft.textContent=entry.fftSize?String(entry.fftSize):'Unknown';
  previewPoints.textContent=entry.points?String(entry.points):'—';
  previewBin.textContent=formatFrequency(entry.binHz);
  previewRange.textContent=`${formatFrequency(entry.fMin)} – ${formatFrequency(entry.fMax)}`;
  preview.hidden=false;
  const rect=anchor.getBoundingClientRect();
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
  if(previewAnchor){
    previewAnchor.classList.remove('is-preview-open');
    previewAnchor.setAttribute('aria-pressed','false');
  }
  previewAnchor=null;
  previewEntry=null;
  preview.hidden=true;
}

function startWire(event,entry,handle){
  if(handle.disabled) return;
  event.preventDefault();
  closePreview();
  closeColorMenu();
  const pointerId=event.pointerId;
  const row=handle.closest('.measurement-file');
  const canvasRect=nodeCanvas.getBoundingClientRect();
  const handleRect=handle.getBoundingClientRect();
  const startX=handleRect.left+handleRect.width/2-canvasRect.left+nodeCanvas.scrollLeft;
  const startY=handleRect.top+handleRect.height/2-canvasRect.top+nodeCanvas.scrollTop;
  wirePath.setAttribute('stroke',entry.color);
  measurementNode.classList.add('is-wiring');
  row?.classList.add('is-wiring');
  handle.classList.add('is-wiring');
  try{handle.setPointerCapture(pointerId)}catch{}
  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    const endX=moveEvent.clientX-canvasRect.left+nodeCanvas.scrollLeft;
    const endY=moveEvent.clientY-canvasRect.top+nodeCanvas.scrollTop;
    const bend=Math.max(48,Math.abs(endX-startX)*.38);
    wirePath.setAttribute('d',`M ${startX} ${startY} C ${startX+bend} ${startY}, ${endX-bend} ${endY}, ${endX} ${endY}`);
  };
  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    wirePath.removeAttribute('d');
    measurementNode.classList.remove('is-wiring');
    row?.classList.remove('is-wiring');
    handle.classList.remove('is-wiring');
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    try{if(handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)}catch{}
  };
  move(event);
  window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
}

function startNodeDrag(event){
  if(!activeCard||measurementNode.hidden) return;
  if(event.button!==undefined&&event.button!==0) return;
  if(event.target.closest('.measurement-import')) return;
  event.preventDefault();
  closePreview();
  closeColorMenu();
  const pointerId=event.pointerId;
  const canvasRect=nodeCanvas.getBoundingClientRect();
  const nodeRect=measurementNode.getBoundingClientRect();
  const grabX=event.clientX-nodeRect.left;
  const grabY=event.clientY-nodeRect.top;
  measurementNode.style.transform='none';
  measurementNode.classList.add('is-dragging');
  try{measurementHead.setPointerCapture(pointerId)}catch{}

  const move=moveEvent=>{
    if(moveEvent.pointerId!==pointerId) return;
    const x=Math.max(8,moveEvent.clientX-canvasRect.left+nodeCanvas.scrollLeft-grabX);
    const y=Math.max(8,moveEvent.clientY-canvasRect.top+nodeCanvas.scrollTop-grabY);
    measurementNode.style.left=`${x}px`;
    measurementNode.style.top=`${y}px`;
    ensureState(activeCard).nodes.measurement.position={x,y};
  };
  const end=endEvent=>{
    if(endEvent.pointerId!==pointerId) return;
    measurementNode.classList.remove('is-dragging');
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    try{if(measurementHead.hasPointerCapture(pointerId)) measurementHead.releasePointerCapture(pointerId)}catch{}
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

measurementHead.addEventListener('pointerdown',startNodeDrag);

colorMenu.querySelectorAll('.file-color-choice').forEach(button=>{
  button.addEventListener('click',()=>chooseColor(button.dataset.color));
});

previewClose.addEventListener('click',closePreview);

document.addEventListener('pointerdown',event=>{
  if(!colorMenu.hidden&&!colorMenu.contains(event.target)&&!event.target.closest('.measurement-color')) closeColorMenu();
  if(!preview.hidden&&!preview.contains(event.target)&&!event.target.closest('.measurement-preview-button')) closePreview();
});

window.addEventListener('resize',()=>{
  if(!preview.hidden&&previewEntry) closePreview();
  if(activeCard&&ensureState(activeCard).nodes.measurement.position===null) requestAnimationFrame(applyMeasurementPosition);
});

function getMeasurement(fileId){
  return activeFiles().find(file=>file.id===fileId)||null;
}

function getMeasurementCanonical(fileId){
  const entry=getMeasurement(fileId);
  if(!entry?.canonical) return null;
  canonicalV1.validate(entry.canonical);
  return entry.canonical;
}

function getActiveLine(){
  if(!activeCard) return null;
  return {
    id:activeCard.dataset.lineId||null,
    name:activeCard.dataset.lineName||'RAPTOR Line'
  };
}

window.RaptorPipeline={
  createState,
  cloneState,
  load,
  onRename,
  onDelete,
  refresh:renderFiles,
  registerInput,
  unregisterInput,
  getMeasurement,
  getMeasurementCanonical,
  getActiveLine
};
})();
