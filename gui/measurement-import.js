(()=>{
'use strict';

const fileInput=document.getElementById('measurementFileInput');
if(!fileInput) throw new Error('measurementFileInput is required');

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
    // Reset only AFTER FileList has been copied and ingestion has completed.
    // Do not mutate value during click/native-picker lifecycle.
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
  version:'native-change-only-v3',
  input:fileInput
});
})();
