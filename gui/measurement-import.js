(()=>{
'use strict';

const fileInput=document.getElementById('measurementFileInput');
if(!fileInput) throw new Error('measurementFileInput is required');

async function handleSelection(){
  const files=Array.from(fileInput.files||[]);
  if(!files.length) return;

  const pipeline=window.RaptorPipeline;
  if(!pipeline||typeof pipeline.importMeasurementFiles!=='function'){
    fileInput.value='';
    throw new Error('RaptorPipeline.importMeasurementFiles is required');
  }

  try{
    await pipeline.importMeasurementFiles(files);
  }finally{
    fileInput.value='';
  }
}

fileInput.addEventListener('change',()=>{
  handleSelection().catch(error=>{
    console.error('[RAPTOR Measurement Import]',error);
  });
});

window.RaptorMeasurementImport=Object.freeze({
  version:'native-label-v1',
  input:fileInput
});
})();
