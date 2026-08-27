(()=>{
'use strict';

const adapters=new Map();

function sanitizeName(value){
  const raw=String(value||'raptor-output').trim()||'raptor-output';
  return raw.replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'_').replace(/\s+/g,' ').slice(0,180);
}

function ensureExtension(name,extension){
  const ext=String(extension||'').replace(/^\./,'').toLowerCase();
  if(!ext) return name;
  return name.toLowerCase().endsWith('.'+ext)?name:`${name}.${ext}`;
}

function registerAdapter(adapter){
  if(!adapter||typeof adapter!=='object') throw new TypeError('Adapter must be an object');
  const id=String(adapter.id||'').trim().toLowerCase();
  if(!id) throw new Error('Adapter id is required');
  if(typeof adapter.create!=='function') throw new Error(`Adapter ${id} requires create()`);
  if(adapters.has(id)) throw new Error(`Adapter already registered: ${id}`);
  adapters.set(id,Object.freeze({...adapter,id}));
}

function unregisterAdapter(id){
  adapters.delete(String(id||'').trim().toLowerCase());
}

function listAdapters(){
  return [...adapters.values()].map(adapter=>({
    id:adapter.id,
    label:adapter.label||adapter.id,
    extension:adapter.extension||'',
    mimeType:adapter.mimeType||'application/octet-stream'
  }));
}

function getAdapter(id){
  const key=String(id||'').trim().toLowerCase();
  const adapter=adapters.get(key);
  if(!adapter) throw new Error(`Unknown sound-file adapter: ${key}`);
  return adapter;
}

async function create(format,artifact,options={}){
  const adapter=getAdapter(format);
  if(typeof adapter.canHandle==='function'&&!adapter.canHandle(artifact,options)){
    throw new Error(`${adapter.label||adapter.id} cannot serialize this artifact`);
  }

  const output=await adapter.create(artifact,options);
  const normalized=output instanceof Blob?{blob:output}:output;

  if(!normalized||!(normalized.blob instanceof Blob)){
    throw new Error(`Adapter ${adapter.id} did not return a Blob`);
  }

  const requestedName=normalized.filename||options.filename||artifact?.name||'raptor-output';
  const filename=ensureExtension(sanitizeName(requestedName),normalized.extension||adapter.extension||'');
  return Object.freeze({
    format:adapter.id,
    filename,
    mimeType:normalized.mimeType||normalized.blob.type||adapter.mimeType||'application/octet-stream',
    blob:normalized.blob,
    size:normalized.blob.size
  });
}

function save(result){
  if(!result||!(result.blob instanceof Blob)) throw new TypeError('A SoundFilePort result is required');
  const url=URL.createObjectURL(result.blob);
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=result.filename||'raptor-output';
  anchor.rel='noopener';
  anchor.style.display='none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function sha256(input){
  const blob=input instanceof Blob?input:input?.blob;
  if(!(blob instanceof Blob)) throw new TypeError('Blob required');
  const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

window.RaptorSoundFile=Object.freeze({
  registerAdapter,
  unregisterAdapter,
  listAdapters,
  create,
  save,
  sha256,
  sanitizeName
});
})();
