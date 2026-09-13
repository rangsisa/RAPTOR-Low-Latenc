(function(root,factory){
'use strict';

const api=factory();
if(typeof module==='object'&&module.exports) module.exports=api;
if(root) root.RaptorCrossoverPassbandMetadata=api;

})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';

const HISTORY_KEY='raptor_crossover_history';
const SCHEMA_VERSION=1;
const TYPES=new Set(['lowpass','highpass','bandpass']);
const DEFAULT_PASSBAND_SETTLE_DB=.5;

function positive(value){
  const number=Number(value);
  return Number.isFinite(number)&&number>0?number:null;
}

function recordForFilter(filter,{model=null}={}){
  const type=TYPES.has(filter?.type)?filter.type:null;
  if(!type) throw new Error('Unsupported crossover filter metadata type');

  const record={
    schema_version:SCHEMA_VERSION,
    filter_id:String(filter.id||''),
    filter_type:type,
    model:model?String(model):null,
    highpass_cutoff_hz:null,
    highpass_slope_db_oct:null,
    lowpass_cutoff_hz:null,
    lowpass_slope_db_oct:null
  };

  if(type==='highpass'){
    record.highpass_cutoff_hz=positive(filter.frequencyHz);
    record.highpass_slope_db_oct=positive(filter.slopeDbOct);
  }else if(type==='lowpass'){
    record.lowpass_cutoff_hz=positive(filter.frequencyHz);
    record.lowpass_slope_db_oct=positive(filter.slopeDbOct);
  }else{
    record.highpass_cutoff_hz=positive(filter.lowFrequencyHz);
    record.highpass_slope_db_oct=positive(filter.highpassSlopeDbOct);
    record.lowpass_cutoff_hz=positive(filter.highFrequencyHz);
    record.lowpass_slope_db_oct=positive(filter.lowpassSlopeDbOct);
  }

  return Object.freeze(record);
}

function history(canonical){
  const records=canonical?.[HISTORY_KEY];
  return Array.isArray(records)?records.filter(record=>record&&typeof record==='object'):[];
}

function append(canonical,filter,options={}){
  const previous=history(canonical).map(record=>Object.freeze({...record}));
  return Object.freeze([...previous,recordForFilter(filter,options)]);
}

function transitionGuardRatio(slopeDbOct,settleDb=DEFAULT_PASSBAND_SETTLE_DB){
  const slope=positive(slopeDbOct);
  const settle=positive(settleDb);
  if(slope===null||settle===null) return 1;

  // RAPTOR's Linkwitz-Riley response is -6 dB at cutoff. Move into the
  // passband until the edge is approximately within settleDb of unity.
  // This naturally gives a wider guard for gentle slopes and a narrower
  // guard for steep slopes (about 1 octave at 24 dB/oct for 0.5 dB).
  const passbandAmplitude=10**(-settle/20);
  const odds=passbandAmplitude/(1-passbandAmplitude);
  return odds**(6/slope);
}

function effectiveRange(canonical,{minHz=10,maxHz=20000,settleDb=DEFAULT_PASSBAND_SETTLE_DB}={}){
  const minimum=positive(minHz)??10;
  const maximum=positive(maxHz)??20000;
  if(!(maximum>minimum)) throw new RangeError('maxHz must be higher than minHz');

  let fromHz=minimum;
  let toHz=maximum;
  let rawFromHz=minimum;
  let rawToHz=maximum;
  let appliedCount=0;
  let insetAppliedCount=0;
  const records=history(canonical);

  for(const record of records){
    const highpass=positive(record.highpass_cutoff_hz);
    const lowpass=positive(record.lowpass_cutoff_hz);
    if(highpass!==null){
      rawFromHz=Math.max(rawFromHz,highpass);
      const guard=transitionGuardRatio(record.highpass_slope_db_oct,settleDb);
      fromHz=Math.max(fromHz,highpass*guard);
      appliedCount+=1;
      if(guard>1) insetAppliedCount+=1;
    }
    if(lowpass!==null){
      rawToHz=Math.min(rawToHz,lowpass);
      const guard=transitionGuardRatio(record.lowpass_slope_db_oct,settleDb);
      toHz=Math.min(toHz,lowpass/guard);
      appliedCount+=1;
      if(guard>1) insetAppliedCount+=1;
    }
  }

  return Object.freeze({
    fromHz,
    toHz,
    rawFromHz,
    rawToHz,
    valid:toHz>fromHz,
    appliedCount,
    insetAppliedCount,
    settleDb:Number(settleDb),
    filterCount:records.length,
    history:Object.freeze(records.slice())
  });
}

return Object.freeze({
  HISTORY_KEY,
  SCHEMA_VERSION,
  DEFAULT_PASSBAND_SETTLE_DB,
  recordForFilter,
  history,
  append,
  transitionGuardRatio,
  effectiveRange
});
});
