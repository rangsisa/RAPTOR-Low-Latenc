(()=>{
'use strict';

const FORMAT='raptor.response.host.v1';
const SCHEMA_VERSION=1;
const PROJECTION_SCHEMA_VERSION=1;
const PHASE_FORMAT='raptor.response.phase.v1';
const MAGNITUDE_FORMAT='raptor.response.magnitude.v1';
const COMPLEX_FORMAT='raptor.response.complex.v1';

function copyFloat64(values,name){
  if(values===null||values===undefined) return null;
  const length=Number(values.length);
  if(!Number.isInteger(length)||length<1) throw new Error(name+' is empty');
  const out=new Float64Array(length);
  for(let i=0;i<length;i++){
    const value=Number(values[i]);
    if(!Number.isFinite(value)) throw new Error(name+' contains a non-finite value at '+i);
    out[i]=value;
  }
  return out;
}

function validateFrequency(frequency){
  for(let i=0;i<frequency.length;i++){
    const f=frequency[i];
    if(!(f>0)) throw new Error('frequency_hz must be > 0');
    if(i>0&&!(f>frequency[i-1])) throw new Error('frequency_hz must be strictly increasing');
  }
}

function create({
  id,
  name,
  views,
  sampleRateHz=null,
  color=null,
  source=null,
  processing=null,
  provenance=null
}={}){
  if(!views) throw new Error('views required');

  const frequency=copyFloat64(views.frequency_hz,'frequency_hz');
  const magnitude=copyFloat64(views.magnitude_db,'magnitude_db');
  const phase=copyFloat64(views.phase_deg,'phase_deg');
  const coherence=views.coherence?copyFloat64(views.coherence,'coherence'):null;

  const points=frequency.length;
  if(magnitude.length!==points||phase.length!==points||(coherence&&coherence.length!==points)){
    throw new Error('Response Host columns must have equal length');
  }
  validateFrequency(frequency);

  const real=new Float64Array(points);
  const imag=new Float64Array(points);
  for(let i=0;i<points;i++){
    const amplitude=Math.pow(10,magnitude[i]/20);
    const radians=phase[i]*Math.PI/180;
    real[i]=amplitude*Math.cos(radians);
    imag[i]=amplitude*Math.sin(radians);
  }

  const sr=sampleRateHz===null||sampleRateHz===undefined?null:Number(sampleRateHz);
  if(sr!==null&&(!(Number.isFinite(sr))||sr<=0)) throw new Error('sampleRateHz must be > 0 when present');

  return Object.freeze({
    format:FORMAT,
    schemaVersion:SCHEMA_VERSION,
    id:String(id||('response-'+Date.now().toString(36))),
    name:String(name||'RAPTOR Response'),
    representation:'frequency-response',
    coordinateSystem:'source-authoritative-frequency-hz',
    sampleRateHz:sr,
    points,
    color:color||null,
    frequency_hz:frequency,
    magnitude_db:magnitude,
    phase_deg:phase,
    complex_real:real,
    complex_imag:imag,
    coherence,
    source:Object.freeze({...source}),
    processing:Object.freeze({...processing}),
    provenance:Object.freeze({
      canonicalMutated:false,
      resampled:false,
      interpolated:false,
      fftGrid:false,
      ...provenance
    })
  });
}

function validate(host){
  if(!host||host.format!==FORMAT||host.schemaVersion!==SCHEMA_VERSION){
    throw new Error('Invalid RAPTOR Response Host V1');
  }
  const n=host.points;
  if(!Number.isInteger(n)||n<1) throw new Error('Invalid host point count');
  for(const key of ['frequency_hz','magnitude_db','phase_deg','complex_real','complex_imag']){
    if(!host[key]||host[key].length!==n) throw new Error('Invalid '+key);
  }
  if(host.coherence&&host.coherence.length!==n) throw new Error('Invalid coherence');
  validateFrequency(host.frequency_hz);
  return host;
}

function project(host,kind){
  validate(host);
  if(kind!=='phase'&&kind!=='magnitude'&&kind!=='complex'){
    throw new Error('Unknown Response Host projection: '+kind);
  }

  const common={
    schemaVersion:PROJECTION_SCHEMA_VERSION,
    hostFormat:FORMAT,
    hostId:host.id,
    pairId:host.id,
    kind,
    name:host.name,
    sampleRateHz:host.sampleRateHz,
    color:host.color,
    points:host.points,
    frequency_hz:host.frequency_hz,
    coherence:host.coherence,
    source:host.source,
    processing:host.processing,
    provenance:host.provenance
  };

  if(kind==='phase'){
    return Object.freeze({
      ...common,
      format:PHASE_FORMAT,
      values:host.phase_deg,
      phase_deg:host.phase_deg
    });
  }

  if(kind==='magnitude'){
    return Object.freeze({
      ...common,
      format:MAGNITUDE_FORMAT,
      values:host.magnitude_db,
      magnitude_db:host.magnitude_db
    });
  }

  return Object.freeze({
    ...common,
    format:COMPLEX_FORMAT,
    complex_real:host.complex_real,
    complex_imag:host.complex_imag
  });
}

window.RaptorResponseHostV1=Object.freeze({
  FORMAT,
  SCHEMA_VERSION,
  PROJECTION_SCHEMA_VERSION,
  PHASE_FORMAT,
  MAGNITUDE_FORMAT,
  COMPLEX_FORMAT,
  create,
  validate,
  project
});
})();
