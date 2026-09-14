(()=>{
'use strict';

const api=window.RaptorPipeline;
const canonicalApi=window.RaptorMeasurementCanonicalV1;
const sourceApi=window.RaptorBankFileSource;
const node=document.getElementById('bankFileNode');
const list=document.getElementById('bankFileList');
if(!api||!canonicalApi||!sourceApi||!node||!list) return;

function tint(hex,alpha=.20){
  const value=String(hex||'').replace('#','');
  if(!/^[0-9a-f]{6}$/i.test(value)) return 'rgba(91,103,112,'+alpha+')';
  const number=parseInt(value,16);
  return 'rgba('+((number>>16)&255)+','+((number>>8)&255)+','+(number&255)+','+alpha+')';
}

function compactFrequency(value){
  const number=Number(value);
  if(!(number>0)) return '—';
  return number>=1000?(number/1000).toFixed(number%1000?1:0)+'k':String(number);
}

const entries=sourceApi.buildEntries();
for(const entry of entries){
  canonicalApi.validate(entry.canonical);
  api.registerMeasurementSource?.(entry);

  const row=document.createElement('div');
  row.className='measurement-file bank-file-row';
  row.dataset.measurementId=entry.id;
  row.style.setProperty('--file-color',entry.color);
  row.style.setProperty('--file-tint',tint(entry.color,.24));

  const info=document.createElement('div');
  info.className='bank-file-info';
  const name=document.createElement('strong');
  name.className='bank-file-name';
  name.textContent=entry.name;
  const meta=document.createElement('span');
  meta.className='bank-file-meta';
  meta.textContent='FFT '+entry.fftSize+' · to '+compactFrequency(entry.fMax)+' Hz · '+entry.points+' pts';
  info.append(name,meta);

  const output=document.createElement('button');
  output.type='button';
  output.className='measurement-output bank-file-output';
  output.setAttribute('aria-label','Connect Bank File '+entry.name);
  output.title=entry.name+' · '+entry.sampleRate/1000+' kHz · 0° · 0 dB';
  output.addEventListener('pointerdown',event=>{
    api.startCanonicalWire?.(event,{
      kind:'measurement',
      id:entry.id,
      measurementId:entry.id,
      name:entry.name,
      color:entry.color,
      sampleRate:entry.sampleRate,
      fftSize:entry.fftSize,
      format:entry.canonical.format,
      canonical:entry.canonical,
      hasData:true
    },output);
  });
  api.registerOutput?.('bank:'+entry.id,output,{
    radius:48,
    getSource:()=>({
      kind:'measurement',
      id:entry.id,
      measurementId:entry.id,
      name:entry.name,
      color:entry.color,
      sampleRate:entry.sampleRate,
      fftSize:entry.fftSize,
      format:entry.canonical.format,
      canonical:entry.canonical,
      hasData:true
    })
  });

  row.append(info,output);
  list.appendChild(row);
}

window.RaptorBankFile=Object.freeze({
  entries:()=>entries.slice(),
  get:id=>entries.find(entry=>entry.id===String(id))||null
});
})();
