(()=>{
'use strict';

const preview=document.getElementById('measurementPreview');
const previewRate=document.getElementById('measurementPreviewRate');
const previewFft=document.getElementById('measurementPreviewFft');

function formatRate(value){
  if(!Number.isFinite(value)||value<=0) return 'Unknown';
  return value>=1000?`${(value/1000).toFixed(value%1000?1:0)} kHz`:`${value} Hz`;
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

function readAcquisition(entry){
  const sampleRate=Number(entry?.sampleRate ?? entry?.canonical?.sample_rate_hz);
  const fftSize=Number(entry?.fftSize ?? entry?.canonical?.base_fft_size);

  return {
    sampleRate:Number.isFinite(sampleRate)&&sampleRate>0?sampleRate:null,
    fftSize:Number.isFinite(fftSize)&&fftSize>0?fftSize:null
  };
}

document.addEventListener('click',event=>{
  const button=event.target.closest('.measurement-preview-button');
  if(!button) return;

  const entry=findEntryForButton(button);
  if(!entry) return;

  // Reporting layer only:
  // never infer or overwrite Sample Rate from FFT/bin spacing here.
  const acquisition=readAcquisition(entry);

  if(preview&&!preview.hidden){
    previewRate.textContent=formatRate(acquisition.sampleRate);
    previewFft.textContent=acquisition.fftSize?String(acquisition.fftSize):'Unknown';
  }
});

window.RaptorAcquisitionReport=Object.freeze({
  read:readAcquisition
});
})();