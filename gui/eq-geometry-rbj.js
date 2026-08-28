(()=>{
'use strict';

/*
 * RAPTOR WebApp RBJ Peaking-EQ geometry primitive.
 *
 * This module is deliberately STATELESS. It models the frequency-domain
 * magnitude/phase geometry of a digital peaking EQ; it does not process audio
 * samples and it never mutates RAPTOR Measurement Canonical V1.
 *
 * Editor-specific operation state lives in separate RAPTOR/NGA adapters.
 */

const DEG=180/Math.PI;
const EPS=1e-300;

function finite(name,value){
  const number=Number(value);
  if(!Number.isFinite(number)) throw new TypeError(name+' must be finite');
  return number;
}

function normalizeOperation(operation={},sampleRateHz=null){
  const fs=finite('sampleRateHz',sampleRateHz??operation.sampleRateHz);
  const frequencyHz=finite('frequencyHz',operation.frequencyHz??operation.f0);
  const gainDb=finite('gainDb',operation.gainDb??operation.gain);
  const q=finite('q',operation.q??operation.Q);

  if(fs<=0) throw new RangeError('sampleRateHz must be > 0');
  if(frequencyHz<=0||frequencyHz>=fs/2) throw new RangeError('frequencyHz must satisfy 0 < f0 < Fs/2');
  if(q<=0) throw new RangeError('q must be > 0');

  return Object.freeze({
    id:operation.id??null,
    type:'peaking',
    frequencyHz,
    gainDb,
    q,
    sampleRateHz:fs
  });
}

function coefficients(operation,sampleRateHz=null){
  const op=normalizeOperation(operation,sampleRateHz);
  const A=Math.pow(10,op.gainDb/40);
  const w0=2*Math.PI*op.frequencyHz/op.sampleRateHz;
  const alpha=Math.sin(w0)/(2*op.q);
  const c=Math.cos(w0);

  const b0=1+alpha*A;
  const b1=-2*c;
  const b2=1-alpha*A;
  const a0=1+alpha/A;
  const a1=-2*c;
  const a2=1-alpha/A;

  return Object.freeze({
    ...op,
    b0:b0/a0,
    b1:b1/a0,
    b2:b2/a0,
    a0:1,
    a1:a1/a0,
    a2:a2/a0
  });
}

function responseAt(frequencyHz,operation,sampleRateHz=null){
  const f=finite('frequencyHz',frequencyHz);
  const c=coefficients(operation,sampleRateHz);
  if(f<0||f>c.sampleRateHz/2) throw new RangeError('evaluation frequency must satisfy 0 <= f <= Fs/2');

  const w=2*Math.PI*f/c.sampleRateHz;
  const cos1=Math.cos(w);
  const sin1=Math.sin(w);
  const cos2=Math.cos(2*w);
  const sin2=Math.sin(2*w);

  const nr=c.b0+c.b1*cos1+c.b2*cos2;
  const ni=-(c.b1*sin1+c.b2*sin2);
  const dr=c.a0+c.a1*cos1+c.a2*cos2;
  const di=-(c.a1*sin1+c.a2*sin2);
  const den=dr*dr+di*di;
  if(!(den>0)) throw new RangeError('non-finite/zero EQ denominator');

  const real=(nr*dr+ni*di)/den;
  const imag=(ni*dr-nr*di)/den;
  const magnitude=Math.hypot(real,imag);

  return Object.freeze({
    real,
    imag,
    magnitude,
    magnitudeDb:20*Math.log10(Math.max(EPS,magnitude)),
    phaseDeg:Math.atan2(imag,real)*DEG
  });
}

function deriveViews(baseViews,operations=[],sampleRateHz){
  const frequency=baseViews?.frequency_hz;
  const magnitude=baseViews?.magnitude_db;
  const phase=baseViews?.phase_deg;

  if(!(frequency&&magnitude&&phase)) throw new TypeError('Canonical views frequency_hz/magnitude_db/phase_deg are required');
  if(frequency.length!==magnitude.length||frequency.length!==phase.length) throw new RangeError('Canonical view lengths must match');

  const ops=operations.map(operation=>normalizeOperation(operation,sampleRateHz));
  if(!ops.length) return baseViews;

  const n=frequency.length;
  const outMagnitude=new Float64Array(n);
  const outPhase=new Float64Array(n);

  for(let i=0;i<n;i++){
    const f=finite('frequency_hz['+i+']',frequency[i]);
    if(f<=0||f>sampleRateHz/2) throw new RangeError('frequency_hz['+i+'] is outside 0 < f <= Fs/2');

    let totalReal=1;
    let totalImag=0;
    let deltaMagnitudeDb=0;

    for(const op of ops){
      const h=responseAt(f,op,sampleRateHz);
      const nextReal=totalReal*h.real-totalImag*h.imag;
      const nextImag=totalReal*h.imag+totalImag*h.real;
      totalReal=nextReal;
      totalImag=nextImag;
      deltaMagnitudeDb+=h.magnitudeDb;
    }

    const sourceMagnitude=finite('magnitude_db['+i+']',magnitude[i]);
    const sourcePhase=finite('phase_deg['+i+']',phase[i]);
    const sourceRad=sourcePhase/DEG;
    const sr=Math.cos(sourceRad);
    const si=Math.sin(sourceRad);
    const rr=sr*totalReal-si*totalImag;
    const ri=sr*totalImag+si*totalReal;

    outMagnitude[i]=sourceMagnitude+deltaMagnitudeDb;
    outPhase[i]=Math.atan2(ri,rr)*DEG;
  }

  return Object.freeze({
    ...baseViews,
    magnitude_db:outMagnitude,
    phase_deg:outPhase,
    eq_geometry:Object.freeze({
      model:'RBJ_PEAKING_EQ_GEOMETRY',
      sample_rate_hz:Number(sampleRateHz),
      operation_count:ops.length,
      canonical_mutated:false
    })
  });
}

window.RaptorEqGeometryRBJ=Object.freeze({
  model:'RBJ_PEAKING_EQ_GEOMETRY',
  normalizeOperation,
  coefficients,
  responseAt,
  deriveViews
});
})();