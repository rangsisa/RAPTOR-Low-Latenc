(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.RaptorMagPhaseGdBandLayout=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function finiteInRange(value,min,max){
    const number=Number(value);
    return Number.isFinite(number)&&number>=min&&number<=max?number:null;
  }

  function nextFrequency(existingFrequencies,options={}){
    const min=Math.max(Number.MIN_VALUE,Number(options.minFrequencyHz)||20);
    const max=Math.max(min,Number(options.maxFrequencyHz)||20000);
    const preferred=finiteInRange(options.preferredFrequencyHz??1000,min,max);
    const existing=[...new Set((existingFrequencies||[])
      .map(value=>finiteInRange(value,min,max))
      .filter(value=>value!==null))]
      .sort((a,b)=>a-b);

    if(!existing.length) return preferred??Math.sqrt(min*max);
    if(max===min) return min;

    const anchors=[min,...existing,max];
    let bestLow=min;
    let bestHigh=max;
    let bestSpan=-Infinity;
    for(let i=1;i<anchors.length;i++){
      const low=anchors[i-1];
      const high=anchors[i];
      if(!(high>low)) continue;
      const span=Math.log(high/low);
      if(span>bestSpan){
        bestSpan=span;
        bestLow=low;
        bestHigh=high;
      }
    }
    return Math.sqrt(bestLow*bestHigh);
  }

  return Object.freeze({nextFrequency});
});
