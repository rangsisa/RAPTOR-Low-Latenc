(()=>{
'use strict';

const TOOL_ID="raptor-editor";
const rbj=window.RaptorEqGeometryRBJ;
if(!rbj) throw new Error('eq-geometry-rbj.js must load before raptor-editor-eq-geometry.js');

/*
 * RAPTOR Editor EQ geometry state.
 * Intentionally isolated from the other Editor: Pipeline line + measurement
 * context is part of the state key, so operations cannot cross-talk.
 */
const STATES=new Map();
let sequence=1;

function bodyFor(body=null){
  return body||document.querySelector('[data-tool-body="'+TOOL_ID+'"]');
}

function contextKey(body=null){
  const node=bodyFor(body);
  if(!node) return null;
  const context=node._raptorInput?.context||{};
  const lineId=node.dataset.pipelineId||context.lineId||'';
  const measurementId=node.dataset.measurementId||context.fileId||'';
  const slot=node.dataset.slot||context.slot||'';
  if(!lineId||!measurementId) return null;
  return TOOL_ID+'::'+lineId+'::'+slot+'::'+measurementId;
}

function sampleRateOf(body=null){
  const node=bodyFor(body);
  const input=node?._raptorInput||{};
  const value=input.entry?.sampleRate??input.canonical?.sample_rate_hz??input.context?.sampleRate??null;
  return Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
}

function requireContext(body=null){
  const node=bodyFor(body);
  const key=contextKey(node);
  if(!node||!key) throw new Error('RAPTOR Editor EQ geometry requires a connected Pipeline measurement');
  const sampleRateHz=sampleRateOf(node);
  if(!sampleRateHz) throw new Error('RAPTOR Editor EQ geometry requires Pipeline sample-rate metadata');
  return {body:node,key,sampleRateHz};
}

function stateFor(key,create=false){
  let state=STATES.get(key);
  if(!state&&create){
    state={version:1,operations:[]};
    STATES.set(key,state);
  }
  return state||null;
}

function cloneOperation(operation){
  return Object.freeze({
    id:String(operation.id),
    type:'peaking',
    frequencyHz:Number(operation.frequencyHz),
    gainDb:Number(operation.gainDb),
    q:Number(operation.q)
  });
}

function normalizeForStore(operation,sampleRateHz,id=null){
  const normalized=rbj.normalizeOperation({
    ...operation,
    id:id??operation.id??null
  },sampleRateHz);
  return {
    id:String(normalized.id||("raptor"+'-eq-'+sequence++)),
    type:'peaking',
    frequencyHz:normalized.frequencyHz,
    gainDb:normalized.gainDb,
    q:normalized.q
  };
}

function emit(body,key){
  document.dispatchEvent(new CustomEvent('raptor:eqgeometrychange',{
    detail:{toolId:TOOL_ID,contextKey:key,operationCount:stateFor(key)?.operations.length||0}
  }));
}

function getOperations(body=null){
  const key=contextKey(body);
  if(!key) return Object.freeze([]);
  const state=stateFor(key);
  return Object.freeze((state?.operations||[]).map(cloneOperation));
}

function setOperations(operations,body=null){
  const ctx=requireContext(body);
  if(!Array.isArray(operations)) throw new TypeError('operations must be an array');
  const next=operations.map(operation=>normalizeForStore(operation,ctx.sampleRateHz));
  stateFor(ctx.key,true).operations=next;
  emit(ctx.body,ctx.key);
  return getOperations(ctx.body);
}

function addOperation(operation,body=null){
  const ctx=requireContext(body);
  const state=stateFor(ctx.key,true);
  const next=normalizeForStore(operation,ctx.sampleRateHz);
  state.operations.push(next);
  emit(ctx.body,ctx.key);
  return cloneOperation(next);
}

function updateOperation(id,patch={},body=null){
  const ctx=requireContext(body);
  const state=stateFor(ctx.key,true);
  const index=state.operations.findIndex(operation=>operation.id===String(id));
  if(index<0) throw new Error('Unknown EQ operation: '+id);
  state.operations[index]=normalizeForStore({...state.operations[index],...patch},ctx.sampleRateHz,state.operations[index].id);
  emit(ctx.body,ctx.key);
  return cloneOperation(state.operations[index]);
}

function removeOperation(id,body=null){
  const ctx=requireContext(body);
  const state=stateFor(ctx.key,true);
  const before=state.operations.length;
  state.operations=state.operations.filter(operation=>operation.id!==String(id));
  const removed=state.operations.length!==before;
  if(removed) emit(ctx.body,ctx.key);
  return removed;
}

function clearOperations(body=null){
  const ctx=requireContext(body);
  STATES.delete(ctx.key);
  emit(ctx.body,ctx.key);
}

function deriveViews(body,baseViews,sampleRateHz=null){
  const node=bodyFor(body);
  const operations=getOperations(node);
  if(!operations.length) return baseViews;
  const fs=Number(sampleRateHz??sampleRateOf(node));
  if(!Number.isFinite(fs)||fs<=0) throw new Error('RAPTOR Editor EQ geometry has no authoritative sample rate');
  return rbj.deriveViews(baseViews,operations,fs);
}

function responseAt(frequencyHz,operation,sampleRateHz=null,body=null){
  const fs=Number(sampleRateHz??sampleRateOf(body));
  if(!Number.isFinite(fs)||fs<=0) throw new Error('RAPTOR Editor EQ geometry has no authoritative sample rate');
  return rbj.responseAt(frequencyHz,operation,fs);
}

window.RaptorEditorEqGeometry=Object.freeze({
  toolId:TOOL_ID,
  model:rbj.model,
  contextKey,
  getOperations,
  setOperations,
  addOperation,
  updateOperation,
  removeOperation,
  clearOperations,
  deriveViews,
  responseAt
});
})();