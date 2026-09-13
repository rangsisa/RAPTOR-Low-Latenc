(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.RaptorMagPhaseGdGraphRange=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const DEFAULTS=Object.freeze({
    amplitudeDb:40,
    minFrequencyHz:10,
    maxFrequencyHz:20000
  });
  const LIMITS=Object.freeze({
    minAmplitudeDb:1,
    maxAmplitudeDb:240,
    minFrequencyHz:1,
    maxFrequencyHz:200000
  });
  const NORMALIZED=Symbol('RaptorMagPhaseGdGraphRange.normalized');

  function finite(value,fallback){
    if(value===null||value===undefined||(typeof value==='string'&&value.trim()==='')) return fallback;
    const number=Number(value);
    return Number.isFinite(number)?number:fallback;
  }

  function clamp(value,min,max){
    return Math.max(min,Math.min(max,value));
  }

  function normalize(source={}){
    if(source&&source[NORMALIZED]===true) return source;
    const amplitudeDb=clamp(
      finite(source.amplitudeDb,DEFAULTS.amplitudeDb),
      LIMITS.minAmplitudeDb,
      LIMITS.maxAmplitudeDb
    );
    let minFrequencyHz=clamp(
      finite(source.minFrequencyHz,DEFAULTS.minFrequencyHz),
      LIMITS.minFrequencyHz,
      LIMITS.maxFrequencyHz
    );
    let maxFrequencyHz=clamp(
      finite(source.maxFrequencyHz,DEFAULTS.maxFrequencyHz),
      LIMITS.minFrequencyHz,
      LIMITS.maxFrequencyHz
    );
    if(!(maxFrequencyHz>minFrequencyHz)){
      minFrequencyHz=DEFAULTS.minFrequencyHz;
      maxFrequencyHz=DEFAULTS.maxFrequencyHz;
    }
    const range={amplitudeDb,minFrequencyHz,maxFrequencyHz};
    Object.defineProperty(range,NORMALIZED,{value:true});
    return Object.freeze(range);
  }

  function xOf(frequencyHz,source,width=1000){
    const range=normalize(source);
    const frequency=Number(frequencyHz);
    if(!(Number.isFinite(frequency)&&frequency>0)) return NaN;
    return (Math.log(frequency)-Math.log(range.minFrequencyHz))
      /Math.log(range.maxFrequencyHz/range.minFrequencyHz)*width;
  }

  function frequencyAtRatio(ratio,source){
    const range=normalize(source);
    const t=clamp(finite(ratio,0),0,1);
    return Math.exp(
      Math.log(range.minFrequencyHz)+t*Math.log(range.maxFrequencyHz/range.minFrequencyHz)
    );
  }

  function yMagnitude(valueDb,source,height=220,clampToViewport=true){
    const range=normalize(source);
    let value=finite(valueDb,0);
    if(clampToViewport) value=clamp(value,-range.amplitudeDb,range.amplitudeDb);
    return height-((value+range.amplitudeDb)/(range.amplitudeDb*2))*height;
  }

  function frequencyTicks(source){
    const range=normalize(source);
    const values=[range.minFrequencyHz,range.maxFrequencyHz];
    const minDecade=Math.floor(Math.log10(range.minFrequencyHz))-1;
    const maxDecade=Math.ceil(Math.log10(range.maxFrequencyHz))+1;
    for(let decade=minDecade;decade<=maxDecade;decade++){
      const scale=10**decade;
      for(const multiplier of [1,2,4,8]){
        const value=multiplier*scale;
        if(value>range.minFrequencyHz&&value<range.maxFrequencyHz) values.push(value);
      }
    }
    values.sort((a,b)=>a-b);
    return values.filter((value,index)=>index===0||Math.abs(Math.log(value/values[index-1]))>1e-9);
  }

  function magnitudeTicks(source){
    const amplitude=normalize(source).amplitudeDb;
    return [amplitude,amplitude/2,0,-amplitude/2,-amplitude];
  }

  return Object.freeze({DEFAULTS,LIMITS,normalize,xOf,frequencyAtRatio,yMagnitude,frequencyTicks,magnitudeTicks});
});
