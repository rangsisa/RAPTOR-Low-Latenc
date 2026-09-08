(()=>{
'use strict';

const fileInput=document.getElementById('measurementFileInput');
if(!fileInput) throw new Error('measurementFileInput is required');

const importTrigger=fileInput.closest('.measurement-import');
if(!importTrigger) throw new Error('measurement import trigger is required');

// Native-label authority (v6): the visible + Import control is a real
// <label for="measurementFileInput"> in index.html. Do not synthesize clicks,
// call showPicker(), or preventDefault() here. This keeps file-picker activation
// in the browser's native trusted-user path even if other UI modules are loaded.
fileInput.hidden=true;

let importing=false;

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
    // Reset only after FileList has been copied and ingestion has completed.
    fileInput.value='';
    importing=false;
  }
}

fileInput.dataset.importState='idle';

fileInput.addEventListener('change',()=>{
  importCurrentSelection().catch(error=>{
    console.error('[RAPTOR Measurement Import]',error);
  });
});

window.RaptorMeasurementImport=Object.freeze({
  version:'native-label-v6',
  input:fileInput,
  trigger:importTrigger
});
})();
