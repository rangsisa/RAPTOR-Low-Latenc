# RAPTOR GUI ROADMAP

**Status:** ACTIVE  
**Source of truth:** GitHub

This roadmap records the current WebApp / Pipeline direction. It is intentionally architecture-first: visual UI work must not silently replace DSP meaning.

---

## 1. PIPELINE DIRECTION

RAPTOR is moving toward a graph-based acoustic / DSP construction environment.

Core interaction:

```text
Measurement
   |
   +--> Filter instance(s)
   |
   +--> Analysis / Monitor
   |
   +--> Multiway system view
```

Each processor/filter instance owns its own ID and local state.

The Pipeline is the primary composition surface. Large permanent editor pages are not the target architecture for processor work.

---

## 2. MAG-PHASE-GD FILTER

Current direction:

- dynamic Pipeline node
- one measurement input
- separate Phase and Magnitude outputs
- per-filter ID/state
- per-filter floating workspace
- Phase Band list and Magnitude Band list
- Band Points display
- Bypass
- Canonical V1 input authority
- Canonical measurement remains unchanged

Processing rule:

```text
Phase Band
    -> Phase only
    -> unity-magnitude phase geometry

Magnitude Band
    -> Magnitude change
    -> coupled phase consequence remains
```

### Response Host V1

Mag-Phase-GD Filter output is carried internally as an in-memory **Response Host V1**, not as a temporary disk file.

```text
Canonical Measurement
    -> Mag-Phase-GD processing
    -> Response Host V1
    -> Phase / Magnitude output projections
    -> downstream Monitor / processor
```

Response Host V1 preserves the source frequency coordinates and carries:

- `frequency_hz`
- `magnitude_db`
- `phase_deg`
- `complex_real / complex_imag`
- coherence
- Sample Rate metadata
- source lineage
- filter/band provenance
- a shared `pairId` for Phase and Magnitude projections

This is a **frequency-response transport object**. It is not silently re-labelled as a uniform FFT grid, and it is not a certified FIR/IIR deployment artifact.

Magnitude RBJ sections can later be realized directly as SOS. Phase-only response geometry requires an explicit realization / engine / certification stage before DSP deployment.

---

# 3. MONITOR / MULTIWAY — COMPLEX SUM PRIORITY LOCK

## NON-NEGOTIABLE ROADMAP PRIORITY

The future **Monitor** node is not merely a multi-trace graph viewer.

**Overlay is useful, but Overlay is NOT Multiway Sum.**

The key RAPTOR Monitor requirement is **complex-domain summation** of multiple signal paths / ways.

Example:

```text
LOW  -------\
MID  --------+--> MONITOR --> OVERLAY + COMPLEX SUM
HIGH -------/
```

Primary multiway equation:

```text
H_sum(f) = H_low(f) + H_mid(f) + H_high(f) + ...
```

where each input response is represented in complex form:

```text
H_k(f) = 10^(Magnitude_k(f)/20) * exp(j * Phase_k(f))
```

### Priority rule

When Monitor development begins:

1. Do not stop at drawing several response curves together.
2. Overlay mode and Complex Sum mode must remain conceptually separate.
3. **Complex Sum is the higher-priority capability.**
4. Never sum dB values directly to represent the acoustic/electrical combined response.
5. Phase must participate in the sum.
6. Delay / phase relationships between ways must not be discarded.
7. The combined result must be derived data with provenance; upstream Canonical measurements remain unchanged.

This requirement is more important than reproducing the common DSP-market pattern of merely stacking or overlaying multiple graphs.

---

## 4. MONITOR NODE — PLANNED ROLE

Monitor is planned as a read-only analysis / summing sink.

Target behavior:

- accept multiple Pipeline inputs
- accept inputs from different processing branches / lines
- preserve input lineage and color identity
- show individual responses
- show/hide individual paths
- support Low / Mid / High and later arbitrary way counts
- provide Overlay mode
- provide Complex Sum mode
- support synchronized Phase / Magnitude inspection
- prepare the architecture for 2-way / 3-way / 4-way / multiway system work

Monitor must not silently modify upstream filters.

---

## 5. RESPONSE PAIRING / DATA AUTHORITY

Complex Sum requires Magnitude and Phase to describe the same response path.

Preferred architecture:

```text
Response Descriptor
    frequency_hz
    magnitude_db
    phase_deg
    coherence / confidence
    sample_rate_hz
    source lineage
    filter / processor provenance
```

UI may expose separate Phase and Magnitude outputs, but Monitor must not guess unrelated Phase and Magnitude streams together.

If inputs do not share the same authoritative frequency coordinates, any common-grid interpolation/resampling used for summation must be an **explicit derived processing step**.

Never rewrite the source Canonical V1 measurement to force grids to match.

---

## 6. MONITOR SUCCESS CRITERION

A first useful Monitor milestone is:

```text
Multiple inputs
    + per-input color / identity
    + Overlay
    + Complex Sum
    + Phase-aware combined Magnitude / Phase result
```

A Monitor that only overlays curves is an incomplete milestone.

---

## 7. REMINDER FOR FUTURE DEVELOPMENT

**Before implementing or declaring Monitor / Multiway complete, re-check Section 3: COMPLEX SUM PRIORITY LOCK.**

The project must explicitly verify that the implementation performs complex-domain summation and is not only a graph-overlay feature.
