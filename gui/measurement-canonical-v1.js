(()=>{
'use strict';

const FORMAT='raptor.measurement.canonical.v1';
const SCHEMA_VERSION=1;
const DTYPE='float64';
const LAYOUT='column-major';
const SERIAL_ENDIANNESS='little';
const COLUMN_COUNT=4;
const COLUMNS=Object.freeze(['frequency_hz','magnitude_db','phase_deg','coherence']);

function tokenize(line){
  return String(line||'').replace(/^\uFEFF/,'').trim().split(/[\s,;]+/).filter(Boolean);
}

function numericPrefix(tokens){
  const values=[];
  for(const token of tokens){
    const value=Number(token);
    if(!Number.isFinite(value)) break;
    values.push(value);
  }
  return values;
}

function scanDataLines(text){
  const lines=String(text||'').split(/\r?\n/);
  const dataLines=[];

  for(let index=0;index<lines.length;index++){
    const line=lines[index].trim();
    if(!line) continue;

    const tokens=tokenize(line);
    if(!tokens.length) continue;

    const first=Number(tokens[0]);
    if(!Number.isFinite(first)) continue;

    const values=numericPrefix(tokens);
    if(values.length!==COLUMN_COUNT){
      throw new Error(`Canonical V1 requires exactly 4 numeric columns at source line ${index+1}; found ${values.length}`);
    }

    dataLines.push({lineNumber:index+1,line});
  }

  if(!dataLines.length) throw new Error('No 4-column numeric measurement rows found');
  return dataLines;
}

function createEnvelope(points,options={}){
  return {
    format:FORMAT,
    schema_version:SCHEMA_VERSION,
    dtype:DTYPE,
    endianness:SERIAL_ENDIANNESS,
    layout:LAYOUT,
    points,
    column_count:COLUMN_COUNT,
    columns:[...COLUMNS],
    sample_rate_hz:options.sampleRateHz??null,
    base_fft_size:options.baseFftSize??null,
    data_bytes:points*COLUMN_COUNT*8,
    measurement_id:options.measurementId||null,
    payload_sha256:options.payloadSha256||null,
    source_name:options.sourceName||null,
    data:new Float64Array(points*COLUMN_COUNT)
  };
}

function views(canonical){
  validateShape(canonical);
  const N=canonical.points;
  return {
    frequency_hz:canonical.data.subarray(0*N,1*N),
    magnitude_db:canonical.data.subarray(1*N,2*N),
    phase_deg:canonical.data.subarray(2*N,3*N),
    coherence:canonical.data.subarray(3*N,4*N)
  };
}

function validateShape(canonical){
  if(!canonical||typeof canonical!=='object') throw new TypeError('Canonical measurement object required');
  if(canonical.format!==FORMAT) throw new Error(`Unsupported measurement format: ${canonical.format||'missing'}`);
  if(canonical.schema_version!==SCHEMA_VERSION) throw new Error(`Unsupported Canonical V1 schema version: ${canonical.schema_version}`);
  if(canonical.dtype!==DTYPE) throw new Error('Canonical V1 dtype must be float64');
  if(canonical.layout!==LAYOUT) throw new Error('Canonical V1 layout must be column-major');
  if(canonical.endianness!==SERIAL_ENDIANNESS) throw new Error('Canonical V1 serialized endianness must be little');
  if(canonical.column_count!==COLUMN_COUNT) throw new Error('Canonical V1 requires 4 columns');
  if(!Number.isInteger(canonical.points)||canonical.points<=0) throw new Error('Canonical V1 points must be a positive integer');
  if(!(canonical.data instanceof Float64Array)) throw new Error('Canonical V1 browser working data must be Float64Array');
  if(canonical.data.length!==canonical.points*COLUMN_COUNT) throw new Error('Canonical V1 payload length mismatch');
  if(canonical.data_bytes!==canonical.points*COLUMN_COUNT*8) throw new Error('Canonical V1 data_bytes mismatch');
  if(!Array.isArray(canonical.columns)||canonical.columns.length!==COLUMN_COUNT||
     canonical.columns.some((name,index)=>name!==COLUMNS[index])){
    throw new Error('Canonical V1 column descriptor mismatch');
  }
  return true;
}

function validate(canonical){
  validateShape(canonical);
  const {frequency_hz,magnitude_db,phase_deg,coherence}=views(canonical);

  let previous=-Infinity;
  for(let i=0;i<canonical.points;i++){
    const frequency=frequency_hz[i];
    const magnitude=magnitude_db[i];
    const phase=phase_deg[i];
    const coh=coherence[i];

    if(!Number.isFinite(frequency)||frequency<=0){
      throw new Error(`Invalid frequency_hz at point ${i}: expected finite value > 0`);
    }
    if(i>0&&frequency<=previous){
      throw new Error(`Invalid frequency_hz at point ${i}: frequency must be strictly increasing; silent sort is forbidden`);
    }
    if(!Number.isFinite(magnitude)){
      throw new Error(`Invalid magnitude_db at point ${i}: expected finite value`);
    }
    if(!Number.isFinite(phase)){
      throw new Error(`Invalid phase_deg at point ${i}: expected finite wrapped phase in degrees`);
    }
    if(!Number.isFinite(coh)||coh<0||coh>1){
      throw new Error(`Invalid coherence at point ${i}: accepted Canonical V1 range is 0..1`);
    }
    previous=frequency;
  }
  return true;
}

function parseText(text,options={}){
  const dataLines=scanDataLines(text);
  const canonical=createEnvelope(dataLines.length,options);
  const N=canonical.points;

  for(let row=0;row<N;row++){
    const item=dataLines[row];
    const values=numericPrefix(tokenize(item.line));
    for(let column=0;column<COLUMN_COUNT;column++){
      canonical.data[column*N+row]=values[column];
    }
  }

  validate(canonical);
  return canonical;
}

function clone(canonical){
  validate(canonical);
  const copy={
    ...canonical,
    columns:[...COLUMNS],
    data:new Float64Array(canonical.data)
  };
  validate(copy);
  return copy;
}

function serializeLittleEndian(canonical){
  validate(canonical);
  const buffer=new ArrayBuffer(canonical.data_bytes);
  const view=new DataView(buffer);
  for(let i=0;i<canonical.data.length;i++) view.setFloat64(i*8,canonical.data[i],true);
  return buffer;
}

async function sha256(canonical){
  const serialized=serializeLittleEndian(canonical);
  const digest=await crypto.subtle.digest('SHA-256',serialized);
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

function descriptor(canonical){
  validate(canonical);
  const {
    data,
    ...metadata
  }=canonical;
  return {...metadata,columns:[...COLUMNS]};
}

window.RaptorMeasurementCanonicalV1=Object.freeze({
  FORMAT,
  SCHEMA_VERSION,
  COLUMN_COUNT,
  COLUMNS,
  parseText,
  validate,
  views,
  clone,
  serializeLittleEndian,
  sha256,
  descriptor
});
})();