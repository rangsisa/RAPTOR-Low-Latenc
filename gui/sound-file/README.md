# RAPTOR Web Sound File Port

Status: foundation scaffold, not wired to Pipeline UI yet.

## Purpose

This layer is the browser-side file ecosystem for RAPTOR outputs.

RAPTOR engine remains authoritative for DSP, normalization, delay semantics,
filter ordering, realization, matching, phase/GD processing, and certification.

The web port only serializes already-authorized artifacts into files.

## Boundary

Engine -> canonical artifact -> SoundFilePort -> format adapter -> Blob/file

The web layer MUST NOT:
- redesign or normalize taps
- resample
- change delay
- reorder sections
- realize IIR/AAA/hybrid results as FIR
- alter phase, magnitude, or group delay
- certify an artifact

## Initial adapters

- WAV32F: IEEE float WAV, certified FIR only
- WAV16: PCM16 WAV, certified FIR only

WAV16 is strict: if any sample is outside [-1, 1], export fails instead of
silently clipping or normalizing.

## Canonical FIR artifact contract

```js
{
  authority: 'raptor-engine',
  certified: true,
  representation: 'fir',
  sampleRate: 96000,
  channels: [Float64Array | Float32Array | number[]],
  name: 'front-matched'
}
```

For mono FIR, `channels` contains one channel.

## Public browser API

After loading `sound-file-port.js` and one or more adapters:

```js
RaptorSoundFile.listAdapters()
RaptorSoundFile.create('wav32f', artifact)
RaptorSoundFile.create('wav16', artifact)
RaptorSoundFile.save(result)
RaptorSoundFile.sha256(result.blob)
```

## Next ports

Planned behind the same boundary:
- Engine Package JSON pass-through
- diagnostic TXT
- binary coefficient package
- vendor-specific Output Format Engine adapters

Vendor adapters must remain behind this port and must not mutate the canonical
RAPTOR artifact.
