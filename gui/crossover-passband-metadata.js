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

function effectiveRange(canonical,{minHz=20,maxHz=20000}={}){
  const minimum=positive(minHz)??20;
  const maximum=positive(maxHz)??20000;
  if(!(maximum>minimum)) throw new RangeError('maxHz must be higher than minHz');

  let fromHz=minimum;
  let toHz=maximum;
  let appliedCount=0;
  const records=history(canonical);

  for(const record of records){
    const highpass=positive(record.highpass_cutoff_hz);
    const lowpass=positive(record.lowpass_cutoff_hz);
    if(highpass!==null){
      fromHz=Math.max(fromHz,highpass);
      appliedCount+=1;
    }
    if(lowpass!==null){
      toHz=Math.min(toHz,lowpass);
      appliedCount+=1;
    }
  }

  return Object.freeze({
    fromHz,
    toHz,
    valid:toHz>fromHz,
    appliedCount,
    filterCount:records.length,
    history:Object.freeze(records.slice())
  });
}

return Object.freeze({
  HISTORY_KEY,
  SCHEMA_VERSION,
  recordForFilter,
  history,
  append,
  effectiveRange
});
});
