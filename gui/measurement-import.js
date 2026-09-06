(()=>{
'use strict';

const fileInput=document.getElementById('measurementFileInput');
if(!fileInput) throw new Error('measurementFileInput is required');

const importTrigger=fileInput.closest('.measurement-import');
if(!importTrigger) throw new Error('measurement import trigger is required');

// Desktop-safe picker activation: remove the styled native file input from the
// clickable overlay path, then open it only from an explicit user gesture on
// the visible + Import control. The existing change/import pipeline stays intact.
fileInput.hidden=true;
importTrigger.setAttribute('role','button');
importTrigger.setAttribute('tabindex','0');
importTrigger.setAttribute('aria-label','Import measurement files');

let importing=false;

function openFilePicker(event){
  if(importing) return;
  if(event){
    event.preventDefault();
    event.stopPropagation();
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
  version:'explicit-user-picker-v4',
  input:fileInput,
  trigger:importTrigger
});
})();
