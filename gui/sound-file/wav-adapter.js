(()=>{
'use strict';

const port=window.RaptorSoundFile;
if(!port) throw new Error('sound-file-port.js must load before wav-adapter.js');

function isTypedArray(value){
  return value instanceof Float64Array||value instanceof Float32Array;
}

function validateFir(artifact){
  if(!artifact||artifact.authority!=='raptor-engine') throw new Error('RAPTOR engine authority required');
  if(artifact.certified!==true) throw new Error('WAV export requires a certified artifact');
  if(artifact.representation!=='fir') throw new Error('WAV export is available for FIR representation only');
  if(!Number.isInteger(artifact.sampleRate)||artifact.sampleRate<=0) throw new Error('Valid sampleRate required');
  if(!Array.isArray(artifact.channels)||artifact.channels.length<1) throw new Error('At least one FIR channel is required');

  const length=artifact.channels[0]?.length;
  if(!Number.isInteger(length)||length<1) throw new Error('FIR channel is empty');
  for(const channel of artifact.channels){
    if(!(Array.isArray(channel)||isTypedArray(channel))) throw new Error('Unsupported channel buffer');
    if(channel.length!==length) throw new Error('All FIR channels must have equal length');
    for(let i=0;i<channel.length;i++){
      if(!Number.isFinite(channel[i])) throw new Error('FIR contains a non-finite sample');
    }
  }
  return {channels:artifact.channels,frames:length,sampleRate:artifact.sampleRate};
}

function writeAscii(view,offset,text){
  for(let i=0;i<text.length;i++) view.setUint8(offset+i,text.charCodeAt(i));
}

function wavHeader(view,{channels,sampleRate,frames,bits,audioFormat}){
  const bytesPerSample=bits/8;
  const blockAlign=channels*bytesPerSample;
  const byteRate=sampleRate*blockAlign;
  const dataBytes=frames*blockAlign;

  writeAscii(view,0,'RIFF');
  view.setUint32(4,36+dataBytes,true);
  writeAscii(view,8,'WAVE');
  writeAscii(view,12,'fmt ');
  view.setUint32(16,16,true);
  view.setUint16(20,audioFormat,true);
  view.setUint16(22,channels,true);
  view.setUint32(24,sampleRate,true);
  view.setUint32(28,byteRate,true);
  view.setUint16(32,blockAlign,true);
  view.setUint16(34,bits,true);
  writeAscii(view,36,'data');
  view.setUint32(40,dataBytes,true);
  return 44;
}

function encodeFloat32(artifact){
  const {channels,frames,sampleRate}=validateFir(artifact);
  const channelCount=channels.length;
  const buffer=new ArrayBuffer(44+frames*channelCount*4);
  const view=new DataView(buffer);
  let offset=wavHeader(view,{channels:channelCount,sampleRate,frames,bits:32,audioFormat:3});

  for(let frame=0;frame<frames;frame++){
    for(let channel=0;channel<channelCount;channel++){
      view.setFloat32(offset,channels[channel][frame],true);
      offset+=4;
    }
  }
  return new Blob([buffer],{type:'audio/wav'});
}

function encodePcm16(artifact){
  const {channels,frames,sampleRate}=validateFir(artifact);
  const channelCount=channels.length;

  for(const channel of channels){
    for(let i=0;i<channel.length;i++){
      if(channel[i]<-1||channel[i]>1){
        throw new Error('WAV16 refused: FIR sample exceeds [-1, 1]; web port will not clip or normalize');
      }
    }
  }

  const buffer=new ArrayBuffer(44+frames*channelCount*2);
  const view=new DataView(buffer);
  let offset=wavHeader(view,{channels:channelCount,sampleRate,frames,bits:16,audioFormat:1});

  for(let frame=0;frame<frames;frame++){
    for(let channel=0;channel<channelCount;channel++){
      const value=channels[channel][frame];
      const pcm=value<0?Math.round(value*32768):Math.round(value*32767);
      view.setInt16(offset,pcm,true);
      offset+=2;
    }
  }
  return new Blob([buffer],{type:'audio/wav'});
}

const canHandle=artifact=>
  artifact?.authority==='raptor-engine'&&
  artifact?.certified===true&&
  artifact?.representation==='fir';

port.registerAdapter({
  id:'wav32f',
  label:'WAV 32-bit Float',
  extension:'wav',
  mimeType:'audio/wav',
  canHandle,
  create(artifact){
    return {blob:encodeFloat32(artifact),extension:'wav',mimeType:'audio/wav'};
  }
});

port.registerAdapter({
  id:'wav16',
  label:'WAV 16-bit PCM',
  extension:'wav',
  mimeType:'audio/wav',
  canHandle,
  create(artifact){
    return {blob:encodePcm16(artifact),extension:'wav',mimeType:'audio/wav'};
  }
});
})();
