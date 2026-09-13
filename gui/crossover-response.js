(function(root,factory){
'use strict';

const api=factory();
if(typeof module==='object'&&module.exports) module.exports=api;
if(root) root.RaptorCrossoverResponse=api;
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const LR_TYPES=new Set(['lowpass','highpass']);
const SLOPES=Object.freeze([12,24,48,96,192]);

function principalRad(value){
  return Math.atan2(Math.sin(value),Math.cos(value));
}

function compileEdge(type,cutoffHz,slopeDbOct,sampleRateHz){
  if(!LR_TYPES.has(type)) throw new RangeError('Unsupported Linkwitz-Riley edge type');
  if(!SLOPES.includes(slopeDbOct)) throw new RangeError('Unsupported crossover slope');
  if(!(cutoffHz>0&&sampleRateHz>0&&cutoffHz<sampleRateHz/2)){
    throw new RangeError('Invalid crossover geometry');
  }

  const butterworthOrder=slopeDbOct/12;
  const omegaC=2*sampleRateHz*Math.tan(Math.PI*cutoffHz/sampleRateHz);
  const poles=new Float64Array(butterworthOrder*2);
  const lowpassNumeratorPhase=new Float64Array(butterworthOrder);

  // Cutoff warping and pole geometry are invariant for every frequency bin.
  for(let k=0;k<butterworthOrder;k++){
    const theta=Math.PI*(2*k+butterworthOrder+1)/(2*butterworthOrder);
    poles[k*2]=omegaC*Math.cos(theta);
    poles[k*2+1]=omegaC*Math.sin(theta);
    lowpassNumeratorPhase[k]=Math.atan2(-poles[k*2+1],-poles[k*2]);
  }

  return Object.freeze({
    type,
    sampleRateHz,
    nyquistHz:sampleRateHz/2,
    omegaC,
    poles,
    lowpassNumeratorLog:Math.log(omegaC),
    lowpassNumeratorPhase
  });
}

function responseAt(edge,frequencyHz,result=null){
  if(!edge||!(frequencyHz>0)) throw new RangeError('Invalid crossover frequency');
  const f=Math.min(frequencyHz,edge.nyquistHz*(1-1e-12));
  const warped=2*edge.sampleRateHz*Math.tan(Math.PI*f/edge.sampleRateHz);
  const highpass=edge.type==='highpass';
  const numeratorLog=highpass?Math.log(warped):edge.lowpassNumeratorLog;
  let logMagnitude=0;
  let phase=0;

  for(let k=0;k<edge.poles.length;k+=2){
    const poleRe=edge.poles[k];
    const poleIm=edge.poles[k+1];
    const denRe=-poleRe;
    const denIm=warped-poleIm;
    const denMagnitude=Math.hypot(denRe,denIm);

    if(!(denMagnitude>0)){
      const empty=result||{};
      empty.magnitudeDb=-Infinity;
      empty.phaseRad=0;
      return empty;
    }

    logMagnitude+=numeratorLog-Math.log(denMagnitude);
    phase+=(highpass?Math.PI/2:edge.lowpassNumeratorPhase[k/2])-Math.atan2(denIm,denRe);
  }

  const output=result||{};
  // Linkwitz-Riley = two identical Butterworth sections in cascade.
  output.magnitudeDb=(40/Math.LN10)*logMagnitude;
  output.phaseRad=principalRad(2*phase);
  return output;
}

function compileFilter(filter,sampleRateHz){
  if(!filter) throw new TypeError('Crossover filter required');
  if(filter.type==='bandpass'){
    return Object.freeze({
      type:'bandpass',
      highpass:compileEdge('highpass',filter.lowFrequencyHz,filter.highpassSlopeDbOct,sampleRateHz),
      lowpass:compileEdge('lowpass',filter.highFrequencyHz,filter.lowpassSlopeDbOct,sampleRateHz)
    });
  }

  return Object.freeze({
    type:filter.type,
    edge:compileEdge(filter.type,filter.frequencyHz,filter.slopeDbOct,sampleRateHz)
  });
}

function applyToViews(compiled,frequency,magnitude,phase){
  if(!compiled||!frequency||!magnitude||!phase||
     frequency.length!==magnitude.length||frequency.length!==phase.length){
    throw new TypeError('Compatible crossover response views required');
  }

  const first={};
  const second={};
  for(let i=0;i<frequency.length;i++){
    const f=Number(frequency[i]);
    const sourceMagnitude=Number(magnitude[i]);
    const sourcePhase=Number(phase[i]);
    if(!(Number.isFinite(f)&&f>0&&Number.isFinite(sourceMagnitude)&&Number.isFinite(sourcePhase))){
      throw new RangeError('Invalid crossover response point at index '+i);
    }

    if(compiled.type==='bandpass'){
      responseAt(compiled.highpass,f,first);
      responseAt(compiled.lowpass,f,second);
      magnitude[i]=sourceMagnitude+first.magnitudeDb+second.magnitudeDb;
      phase[i]=principalRad(sourcePhase*Math.PI/180+first.phaseRad+second.phaseRad)*180/Math.PI;
    }else{
      responseAt(compiled.edge,f,first);
      magnitude[i]=sourceMagnitude+first.magnitudeDb;
      phase[i]=principalRad(sourcePhase*Math.PI/180+first.phaseRad)*180/Math.PI;
    }
  }

  return true;
}

return Object.freeze({
  SLOPES,
  principalRad,
  compileEdge,
  compileFilter,
  responseAt,
  applyToViews
});
});
