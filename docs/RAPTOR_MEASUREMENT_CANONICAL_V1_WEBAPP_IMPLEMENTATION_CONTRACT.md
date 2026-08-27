# RAPTOR MEASUREMENT CANONICAL V1

## WEBAPP IMPLEMENTATION CONTRACT

**Status:** AUTHORITATIVE  
**Authority:** WebApp measurement working-data contract  
**Schema:** `raptor.measurement.canonical.v1`

This contract is the single source of truth for measurement representation across the RAPTOR WebApp.

RAPTOR Measurement Canonical V1 is **not only an Engine/Kernel transport format**. It is the primary working measurement format from the moment a source file is imported and remains authoritative through:

```text
Import
-> Editor
-> Graph
-> Pipeline
-> NGA
-> Matching
-> API
-> Engine / Kernel
```

After import, TXT or row-based string data MUST NOT become working measurement authority again.

---

## 1. SOURCE IMPORT

Source may be:

- TXT
- FRD
- CSV
- DAT
- other supported measurement text formats

The Web Import Parser parses the source once:

```text
TXT / FRD / CSV / DAT
        |
        v
Web Import Parser
        |
        v
RAPTOR Measurement Canonical V1
        |
        +----> Editor
        +----> Graph
        +----> Pipeline
        +----> NGA
        +----> Matching
        +----> API
        +----> Engine / Kernel
```

---

## 2. CANONICAL NUMERIC REPRESENTATION

Canonical representation:

- IEEE-754 Float64
- `Float64Array` in browser RAM
- column-major measurement layout

Base measurement columns:

```text
Column 0 = frequency_hz
Column 1 = magnitude_db
Column 2 = phase_deg
Column 3 = coherence
```

For N points:

```text
[frequency_hz Float64[N]]
[magnitude_db Float64[N]]
[phase_deg    Float64[N]]
[coherence    Float64[N]]
```

Offsets:

```text
offset 0:
    frequency_hz[0 ... N-1]

offset N * 8:
    magnitude_db[0 ... N-1]

offset N * 8 * 2:
    phase_deg[0 ... N-1]

offset N * 8 * 3:
    coherence[0 ... N-1]
```

This is COLUMN-MAJOR.

It is NOT:

```text
freq0, mag0, phase0, coh0,
freq1, mag1, phase1, coh1
```

It IS:

```text
freq0, freq1, freq2, ...
mag0, mag1, mag2, ...
phase0, phase1, phase2, ...
coh0, coh1, coh2, ...
```

Browser access:

```js
const frequency = data.subarray(0 * N, 1 * N);
const magnitude = data.subarray(1 * N, 2 * N);
const phase     = data.subarray(2 * N, 3 * N);
const coherence = data.subarray(3 * N, 4 * N);
```

---

## 3. FREQUENCY ARRAY IS AUTHORITATIVE

The most important invariant is:

```text
frequency_hz[i]
```

This is the authoritative frequency coordinate.

Never reconstruct the frequency axis from:

- index
- sample_rate_hz
- FFT size
- global df
- f0 + i*df

RAPTOR measurements may use a nonuniform / multiresolution frequency grid.

For example, source spacing may be:

```text
1 * df_base
2 * df_base
4 * df_base
8 * df_base
...
128 * df_base
```

Even if metadata contains:

```text
sample_rate_hz = 96000
base_fft_size  = 65536
```

these are provenance / metadata only. They MUST NOT replace the stored `frequency_hz[]`.

---

## 4. PHASE SEMANTICS

Canonical column:

```text
phase_deg
```

stores WRAPPED PHASE IN DEGREES.

Preserve source measurement values or explicit Editor changes.

The import layer MUST NOT:

- unwrap phase
- convert canonical storage to radians
- regenerate phase

If an algorithm needs radians:

```text
phase_deg
    ->
explicit DEG_TO_RAD processing
    ->
derived phase_rad
```

If an algorithm needs unwrapped phase:

```text
phase_deg wrapped
    ->
explicit UNWRAP processing stage
    ->
derived unwrapped phase
```

Do not automatically alter canonical `phase_deg`.

---

## 5. IMPORT MUST PRESERVE SOURCE POINTS

Import responsibilities:

- decode source
- parse numeric rows
- validate
- allocate Float64Array
- fill Canonical V1
- attach metadata / provenance

Import MUST NOT perform implicit transforms such as:

- resample
- interpolate
- unwrap
- smooth
- normalize magnitude
- regenerate missing FFT bins
- change coherence
- change point count
- silently sort / reorder measurement

Principle:

```text
IMPORT = representation conversion
```

NOT:

```text
IMPORT = DSP processing
```

Resampling or interpolation must be an explicit processing operation after import.

---

## 6. EDITOR MUST USE CANONICAL V1

Editor must not convert measurement back to row objects or text before editing.

Operate directly through Float64Array / column views.

Examples:

```text
Magnitude Editor:
    magnitude[i]

Phase Editor:
    phase[i]

Frequency coordinate:
    frequency[i]

Coherence:
    coherence[i]
```

Canonical V1 is the Editor working measurement representation.

---

## 7. GRAPH / UI MUST NOT CHANGE MEASUREMENT AUTHORITY

Graph rendering may use fewer display points.

Example:

```text
canonical = 100000 points
display   = 2000 points
```

Allowed:

- display decimation
- render cache
- virtualization
- LOD

These are DISPLAY VIEW only.

Never:

- overwrite canonical measurement
- reduce canonical point count
- replace engine input with graph-decimated data

Correct architecture:

```text
Canonical Measurement
        |
        +----> Editor / Engine / Matching = full authoritative data
        |
        +----> Graph display cache = decimated/virtualized view
```

---

## 8. DERIVED DATA MUST REMAIN DERIVED

The following are NOT Canonical source measurement:

- uniform FFT grid
- interpolated grid
- unwrapped phase
- smoothed measurement
- normalized curve
- graph-decimated curve
- derived group delay
- resampled measurement

Create a separate Derived Processing Representation.

Example:

```text
CanonicalMeasurementV1
        |
        | explicit RESAMPLE
        v
DerivedUniformGrid
```

Derived objects should retain provenance to the source canonical measurement.

Never silently overwrite original canonical measurement with a derived result.

---

## 9. API / SERIALIZATION CONTRACT

Recommended metadata:

```json
{
  "format": "raptor.measurement.canonical.v1",
  "dtype": "float64",
  "endianness": "little",
  "layout": "column-major",
  "points": N,
  "column_count": 4,
  "columns": [
    "frequency_hz",
    "magnitude_db",
    "phase_deg",
    "coherence"
  ],
  "sample_rate_hz": 96000,
  "base_fft_size": 65536,
  "data_bytes": N * 4 * 8
}
```

Recommended provenance fields:

- measurement_id
- schema_version
- payload_sha256
- source_name

`sample_rate_hz` and `base_fft_size` are metadata and MUST NOT reconstruct the frequency grid.

---

## 10. BYTE ORDER

Browser RAM working representation:

```text
Float64Array
```

Serialized transport/storage contract:

```text
IEEE-754 binary64
little-endian
column-major
```

Applies to:

- API transport
- persistent binary storage
- cross-runtime transfer

Do not assume native byte order during serialization without an explicit serializer contract.

---

## 11. VALIDATION

Before accepting a measurement as Canonical V1, validate at minimum:

- format/schema supported
- dtype == float64
- layout == column-major
- column_count == 4
- points > 0
- payload bytes == points * 4 * 8
- frequency finite
- frequency > 0
- frequency strictly increasing
- magnitude finite
- phase finite
- coherence finite
- coherence within accepted semantic range

If invalid:

```text
REPORT / FAIL
```

Do not silently repair.

Example: if frequency is not ordered, never silently sort it because sorting is a data transformation.

---

## 12. KERNEL / ENGINE BOUNDARY

Kernel consumes Canonical Measurement directly.

Logical views:

```text
frequency_hz = payload[0*N : 1*N]
magnitude_db = payload[1*N : 2*N]
phase_deg    = payload[2*N : 3*N]
coherence    = payload[3*N : 4*N]
```

Kernel must not need to parse:

- TXT
- FRD
- CSV
- DAT

Source-format parsing belongs to the import layer.

---

## 13. ARCHITECTURAL INVARIANTS

1. Parse source only once.
2. After import, RAPTOR Measurement Canonical V1 is the primary working data.
3. Canonical V1 is not only an API transport format.
4. Editor uses Canonical V1.
5. Pipeline uses Canonical V1.
6. NGA uses Canonical V1.
7. Matching uses Canonical V1.
8. API / Engine / Kernel receive Canonical V1.
9. `frequency_hz[]` is always authoritative.
10. `phase_deg` stores wrapped phase.
11. Import does not unwrap phase.
12. Import does not resample.
13. Import does not smooth.
14. Import does not regenerate missing FFT bins.
15. Graph decimation is display-only.
16. Derived DSP data must not implicitly overwrite Canonical measurement.
17. Serialized binary transport uses Float64 little-endian column-major.
18. Schema is versioned as `raptor.measurement.canonical.v1`.

---

## FINAL ARCHITECTURE

```text
Original Measurement File
TXT / FRD / CSV / DAT
        |
        v
Web Import Parser
        |
        | parse once
        v
+--------------------------------------------------+
| RAPTOR MEASUREMENT CANONICAL V1                  |
| Float64 / Column-Major                           |
|                                                  |
| frequency_hz[N]                                  |
| magnitude_db[N]                                  |
| phase_deg[N]                                     |
| coherence[N]                                     |
+--------------------------------------------------+
        |
        +------> Editor
        |
        +------> Graph / UI
        |
        +------> Pipeline
        |
        +------> NGA
        |
        +------> Matching
        |
        +------> API
        |
        v
Engine / Kernel
```

The WebApp MUST use this contract as the single source of truth for measurement representation.

If existing internal structures use row objects, text rows, interleaved arrays, or compatibility buffers after import, migrate their boundaries progressively so Canonical V1 becomes the authority.

Do not change measurement DSP semantics in the import layer unless the operation is explicitly represented as a processing stage.
