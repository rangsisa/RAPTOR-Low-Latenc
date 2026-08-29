(()=>{
'use strict';

const FORMAT='raptor.monitor.complex-sum.v1';
const ERROR_GRID_MISMATCH='RAPTOR_MONITOR_GRID_MISMATCH';
const ERROR_INVALID_RESPONSE='RAPTOR_MONITOR_INVALID_RESPONSE';

function responseId(response,index){
  return String(
    response?.pairId||
    response?.hostId||
    response?.id||
    response?.filterId||
    response?.sourceMeasurementId||
    ('response-'+(index+1))
  );
}

function arrayLike(values){
  return values&&Number.isInteger(Number(values.length))&&Number(values.length)>0;
}

function validateResponse(response,index=0){
  if(!response||typeof response!=='object'){
    const error=new Error('Monitor response '+(index+1)+' is missing');
    error.code=ERROR_INVALID_RESPONSE;
    throw error;
  }

  const frequency=response.frequency_hz;
  const magnitude=response.magnitude_db;
  const phase=response.phase_deg;
  if(!arrayLike(frequency)||!arrayLike(magnitude)||!arrayLike(phase)){
    const error=new Error('Monitor response '+responseId(response,index)+' requires frequency, magnitude, and phase');
    error.code=ERROR_INVALID_RESPONSE;
    throw error;
  }

  const points=Number(frequency.length);
  if(magnitude.length!==points||phase.length!==points){
    const error=new Error('Monitor response '+responseId(response,index)+' has unequal column lengths');
    error.code=ERROR_INVALID_RESPONSE;
    throw error;
  }

  for(let i=0;i<points;i++){
    const f=Number(frequency[i]);
    const mag=Number(magnitude[i]);
    const deg=Number(phase[i]);
    if(!(Number.isFinite(f)&&f>0&&Number.isFinite(mag)&&Number.isFinite(deg))){
      const error=new Error('Monitor response '+responseId(response,index)+' has invalid data at point '+i);
      error.code=ERROR_INVALID_RESPONSE;
      throw error;
    }
    if(i>0&&!(f>Number(frequency[i-1]))){
      const error=new Error('Monitor response '+responseId(response,index)+' frequency grid must be strictly increasing');
      error.code=ERROR_INVALID_RESPONSE;
      throw error;
    }
  }

  const real=response.complex_real;
  const imag=response.complex_imag;
  if((real||imag)&&!(arrayLike(real)&&arrayLike(imag)&&real.length===points&&imag.length===points)){
    const error=new Error('Monitor response '+responseId(response,index)+' has an incomplete complex projection');
    error.code=ERROR_INVALID_RESPONSE;
    throw error;
  }

  return Object.freeze({
    response,
    id:responseId(response,index),
    points,
    frequency,
    magnitude,
    phase,
    real:real||null,
    imag:imag||null
  });
}

function exactGridMatch(reference,candidate){
  if(reference.points!==candidate.points) return false;
  for(let i=0;i<reference.points;i++){
    if(Number(reference.frequency[i])!==Number(candidate.frequency[i])) return false;
  }
  return true;
}

function complexAt(validated,index){
  if(validated.real&&validated.imag){
    const re=Number(validated.real[index]);
    const im=Number(validated.imag[index]);
    if(Number.isFinite(re)&&Number.isFinite(im)) return [re,im];
  }

  const amplitude=Math.pow(10,Number(validated.magnitude[index])/20);
  const radians=Number(validated.phase[index])*Math.PI/180;
  return [
    amplitude*Math.cos(radians),
    amplitude*Math.sin(radians)
  ];
}

function sum(responses){
  if(!Array.isArray(responses)||responses.length<1){
    const error=new Error('Monitor Complex Sum requires at least one response');
    error.code=ERROR_INVALID_RESPONSE;
    throw error;
  }

  const validated=responses.map((response,index)=>validateResponse(response,index));
  const reference=validated[0];

  for(let i=1;i<validated.length;i++){
    if(!exactGridMatch(reference,validated[i])){
      const error=new Error(
        'Monitor frequency grids differ between '+reference.id+' and '+validated[i].id+
        '; explicit alignment/interpolation is required before Complex Sum'
      );
      error.code=ERROR_GRID_MISMATCH;
      error.referenceId=reference.id;
      error.candidateId=validated[i].id;
      throw error;
    }
  }

  const frequency=new Float64Array(reference.points);
  const real=new Float64Array(reference.points);
  const imag=new Float64Array(reference.points);
  const magnitude=new Float64Array(reference.points);
  const phase=new Float64Array(reference.points);
  const phaseValid=new Uint8Array(reference.points);

  for(let i=0;i<reference.points;i++){
    frequency[i]=Number(reference.frequency[i]);

    let sumRe=0;
    let sumIm=0;
    for(const response of validated){
      const [re,im]=complexAt(response,i);
      sumRe+=re;
      sumIm+=im;
    }

    real[i]=sumRe;
    imag[i]=sumIm;
    const amplitude=Math.hypot(sumRe,sumIm);
    if(amplitude>0&&Number.isFinite(amplitude)){
      magnitude[i]=20*Math.log10(amplitude);
      phase[i]=Math.atan2(sumIm,sumRe)*180/Math.PI;
      phaseValid[i]=1;
    }else{
      magnitude[i]=-Infinity;
      phase[i]=NaN;
      phaseValid[i]=0;
    }
  }

  const sourceIds=validated.map(item=>item.id);
  return Object.freeze({
    format:FORMAT,
    representation:'derived-frequency-response',
    operation:'complex-sum',
    points:reference.points,
    frequency_hz:frequency,
    magnitude_db:magnitude,
    phase_deg:phase,
    phase_valid:phaseValid,
    complex_real:real,
    complex_imag:imag,
    coherence:null,
    sourceIds:Object.freeze(sourceIds),
    sourceCount:sourceIds.length,
    provenance:Object.freeze({
      upstreamMutated:false,
      gridMatch:'exact',
      interpolated:false,
      resampled:false,
      dbSummedDirectly:false,
      phaseParticipates:true,
      coherenceDerived:false
    })
  });
}

function inspectCompatibility(responses){
  if(!Array.isArray(responses)||responses.length<1){
    return Object.freeze({ready:false,reason:'NO_INPUTS',sourceCount:0});
  }

  let validated;
  try{
    validated=responses.map((response,index)=>validateResponse(response,index));
  }catch(error){
    return Object.freeze({
      ready:false,
      reason:'INVALID_RESPONSE',
      sourceCount:responses.length,
      message:error instanceof Error?error.message:String(error)
    });
  }

  const reference=validated[0];
  for(let i=1;i<validated.length;i++){
    if(!exactGridMatch(reference,validated[i])){
      return Object.freeze({
        ready:false,
        reason:'GRID_MISMATCH',
        sourceCount:validated.length,
        referenceId:reference.id,
        candidateId:validated[i].id,
        message:'Explicit grid alignment/interpolation required'
      });
    }
  }

  return Object.freeze({
    ready:true,
    reason:'EXACT_GRID',
    sourceCount:validated.length,
    points:reference.points,
    fMin:Number(reference.frequency[0]),
    fMax:Number(reference.frequency[reference.points-1])
  });
}

window.RaptorMonitorComplexSum=Object.freeze({
  FORMAT,
  ERROR_GRID_MISMATCH,
  ERROR_INVALID_RESPONSE,
  validateResponse,
  exactGridMatch,
  inspectCompatibility,
  sum
});
})();