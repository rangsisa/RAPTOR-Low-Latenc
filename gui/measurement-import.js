(()=>{
'use strict';

const fileInput=document.getElementById('measurementFileInput');
if(!fileInput) throw new Error('measurementFileInput is required');

let importing=false;

async function handleSelection(source){
  if(importing) return;

  const files=Array.from(fileInput.files||[]);
  if(!files.length) return;

  const pipeline=window.RaptorPipeline;
  if(!pipeline||typeof pipeline.importMeasurementFiles!=='function'){
    fileInput.value='';
    throw new Error('RaptorPipeline.importMeasurementFiles is required');
  }

  importing=true;
  fileInput.dataset.importState='importing';
  fileInput.dataset.importEvent=String(source||'unknown');

  try{
    await pipeline.importMeasurementFiles(files);
    fileInput.dataset.importState='idle';
  }catch(error){
    fileInput.dataset.importState='error';
    throw error;
  }finally{
    fileInput.value='';
    importing=false;
  }
}

function report(error){
  console.error('[RAPTOR Measurement Import]',error);
}

fileInput.addEventListener('pointerdown',event=>{
  event.stopPropagation();
});

fileInput.addEventListener('click',event=>{
  event.stopPropagation();
  if(!importing) fileInput.value='';
});

fileInput.addEventListener('input',()=>{
  handleSelection('input').catch(report);
});

fileInput.addEventListener('change',()=>{
  handleSelection('change').catch(report);
});

fileInput.addEventListener('cancel',()=>{
  if(!importing) fileInput.dataset.importState='idle';
});

window.RaptorMeasurementImport=Object.freeze({
  version:'native-rendered-input-v2',
  input:fileInput
});
})();
