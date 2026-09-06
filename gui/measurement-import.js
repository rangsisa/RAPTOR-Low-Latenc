(()=>{
'use strict';

const fileInput=document.getElementById('measurementFileInput');
if(!fileInput) throw new Error('measurementFileInput is required');

const importTrigger=fileInput.closest('.measurement-import');
if(!importTrigger) throw new Error('measurement import trigger is required');

// Keep the native file input out of the styled overlay path. The visible
// + Import control owns activation; the native input owns the actual picker.
fileInput.hidden=true;
importTrigger.setAttribute('role','button');
importTrigger.setAttribute('tabindex','0');
importTrigger.setAttribute('aria-label','Import measurement files');

let importing=false;

function openFilePicker(event){
  if(importing) return;

  // fileInput.click() dispatches a synthetic click that bubbles back through
  // .measurement-import. Never cancel that native-input click: preventDefault()
  // there would cancel the file input's activation behavior and suppress the
  // chooser on both desktop and mobile browsers.
  if(event?.target===fileInput) return;

  if(event){
    event.preventDefault();
    event.stopPropagation();
  }

  // Prefer the picker API when available; fall back to the historical file
  // input activation path. Both calls stay inside the original user gesture.
  if(typeof fileInput.showPicker==='function'){
    try{
      fileInput.showPicker();
      return;
    }catch{}
  }
  fileInput.click();
}

async function importCurrentSelection(){
  if(importing) return;

  const files=Array.from(fileInput.files||[]);
  if(!files.length) return;

  const pipeline=window.RaptorPipeline;
  if(!pipeline||typeof pipeline.importMeasurementFiles!=='function'){
    throw new Error('RaptorPipeline.importMeasurementFiles is required');
  }

  importing=true;
  fileInput.dataset.importState='importing';

  try{
    await pipeline.importMeasurementFiles(files);
    fileInput.dataset.importState='idle';
  }catch(error){
    fileInput.dataset.importState='error';
    throw error;
  }finally{
    // Reset only AFTER FileList has been copied and ingestion has completed.
    // Do not mutate value during click/native-picker lifecycle.
    fileInput.value='';
    importing=false;
  }
}

fileInput.dataset.importState='idle';

importTrigger.addEventListener('click',openFilePicker);
importTrigger.addEventListener('keydown',event=>{
  if(event.key!=='Enter'&&event.key!==' ') return;
  openFilePicker(event);
});

fileInput.addEventListener('change',()=>{
  importCurrentSelection().catch(error=>{
    console.error('[RAPTOR Measurement Import]',error);
  });
});

window.RaptorMeasurementImport=Object.freeze({
  version:'explicit-user-picker-v5',
  input:fileInput,
  trigger:importTrigger
});
})();
