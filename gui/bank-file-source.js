(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.RaptorBankFileSource=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const POINTS=591;
  // Matching FFT sizes keep the first usable bin identical at every rate.
  const MIN_FREQUENCY_HZ=96000/65536;
  const SPECS=Object.freeze([
    Object.freeze({id:'bank-file-48k',label:'48K',sampleRateHz:48000,fftSize:32768,maxFrequencyHz:24000,color:'#FF8A00'}),
    Object.freeze({id:'bank-file-96k',label:'96K',sampleRateHz:96000,fftSize:65536,maxFrequencyHz:48000,color:'#8EDB57'}),
    Object.freeze({id:'bank-file-192k',label:'192K',sampleRateHz:192000,fftSize:131072,maxFrequencyHz:96000,color:'#EF3E4A'})
  ]);

  function buildCanonical(spec){
    if(!spec||!(spec.sampleRateHz>0)||!(spec.fftSize>0)||!(spec.maxFrequencyHz>spec.sampleRateHz/spec.fftSize)){
      throw new TypeError('Valid Bank File specification required');
    }
    const minimumFrequencyHz=spec.sampleRateHz/spec.fftSize;
    const data=new Float64Array(POINTS*4);
    const logMin=Math.log(minimumFrequencyHz);
    const logSpan=Math.log(spec.maxFrequencyHz/minimumFrequencyHz);
    for(let i=0;i<POINTS;i++){
      data[i]=Math.exp(logMin+logSpan*i/(POINTS-1));
      data[POINTS+i]=0;
      data[POINTS*2+i]=0;
      data[POINTS*3+i]=1;
    }
    // Pin both endpoints so metadata and plotted range remain exact despite
    // floating-point exponential rounding.
    data[0]=minimumFrequencyHz;
    data[POINTS-1]=spec.maxFrequencyHz;

    return {
      format:'raptor.measurement.canonical.v1',
      schema_version:1,
      dtype:'float64',
      endianness:'little',
      layout:'column-major',
      points:POINTS,
      column_count:4,
      columns:['frequency_hz','magnitude_db','phase_deg','coherence'],
      sample_rate_hz:spec.sampleRateHz,
      base_fft_size:spec.fftSize,
      data_bytes:POINTS*4*8,
      measurement_id:spec.id,
      payload_sha256:null,
      source_name:'Bank File '+spec.label,
      data
    };
  }

  function buildEntry(spec){
    const canonical=buildCanonical(spec);
    return Object.freeze({
      id:spec.id,
      name:spec.label,
      color:spec.color,
      status:'ready',
      sampleRate:spec.sampleRateHz,
      sampleRateSource:'bank-file',
      fftSize:spec.fftSize,
      binHz:spec.sampleRateHz/spec.fftSize,
      fMin:canonical.data[0],
      fMax:spec.maxFrequencyHz,
      points:POINTS,
      columns:4,
      size:canonical.data_bytes,
      canonical,
      buffer:canonical.data.buffer,
      error:''
    });
  }

  function buildEntries(){
    return SPECS.map(buildEntry);
  }

  return Object.freeze({POINTS,MIN_FREQUENCY_HZ,SPECS,buildCanonical,buildEntry,buildEntries});
});
