(()=>{
const COMMON_SAMPLE_RATES=[44100,48000,88200,96000,176400,192000];
const FFT_SIZES=Array.from({length:13},(_,i)=>2**(8+i));
const preview=document.getElementById('measurementPreview');
const previewRate=document.getElementById('measurementPreviewRate');
const previewFft=document.getElementById('measurementPreviewFft');

function formatRate(value){
  if(!value) return 'Unknown';
  return value>=1000?`${(value/1000).toFixed(value%1000?1:0)} kHz`:`${value} Hz`;
}

function inferFromRange(entry){
  const fMax=Number(entry?.fMax);
  const binHz=Number(entry?.binHz);
  if(!(Number.isFinite(fMax)&&fMax>0&&Number.isFinite(binHz)&&binHz>0)){
    return {sampleRate:null,fftSize:null};
  }

  // Sample rate cannot be determined from bin spacing alone because
  // 48k/32768, 96k/65536, 192k/131072 ... can share the same Δf.
  // Use the measured upper-frequency extent as Nyquist evidence first.
  const candidates=COMMON_SAMPLE_RATES
    .map(sampleRate=>({sampleRate,nyquist:sampleRate/2,coverage:fMax/(sampleRate/2)}))
    .filter(candidate=>fMax<=candidate.nyquist*1.01)
    .filter(candidate=>candidate.coverage>=0.85)
    .sort((a,b)=>Math.abs(1-a.coverage)-Math.abs(1-b.coverage));

  if(!candidates.length) return {sampleRate:null,fftSize:null};
  const sampleRate=candidates[0].sampleRate;

  let fftBest=null;
  for(const fftSize of FFT_SIZES){
    const expected=sampleRate/fftSize;
    const relative=Math.abs(expected-binHz)/expected;
    if(!fftBest||relative<fftBest.relative) fftBest={fftSize,relative};
  }
  const fftSize=fftBest&&fftBest.relative<=0.001?fftBest.fftSize:null;
  return {sampleRate,fftSize};
}

function findEntryForButton(button){
  const loaded=document.querySelector('.pipeline-card.is-loaded');
  const files=loaded?._raptorLineState?.nodes?.measurement?.files;
  if(!Array.isArray(files)) return null;
  const rows=[...document.querySelectorAll('#measurementList .measurement-file')];
  const row=button.closest('.measurement-file');
  const index=rows.indexOf(row);
  return index>=0?files[index]||null:null;
}

function correctEntry(entry){
  const inferred=inferFromRange(entry);
  entry.sampleRate=inferred.sampleRate;
  entry.fftSize=inferred.fftSize;

  // Keep Canonical V1 provenance metadata synchronized with the UI inference.
  if(entry?.canonical){
    entry.canonical.sample_rate_hz=inferred.sampleRate;
    entry.canonical.base_fft_size=inferred.fftSize;
  }
  return inferred;
}

document.addEventListener('click',event=>{
  const button=event.target.closest('.measurement-preview-button');
  if(!button) return;
  const entry=findEntryForButton(button);
  if(!entry) return;
  const inferred=correctEntry(entry);
  if(preview&&!preview.hidden){
    previewRate.textContent=formatRate(inferred.sampleRate);
    previewFft.textContent=inferred.fftSize?String(inferred.fftSize):'Unknown';
  }
});

window.RaptorAcquisitionInference={inferFromRange,correctEntry};
})();
