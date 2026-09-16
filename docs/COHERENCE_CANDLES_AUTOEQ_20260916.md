# Coherence candles and Auto EQ — 2026-09-16

## Data and display

- Canonical remains four columns, with coherence strictly in 0..1. No silent
  percent import, resampling, magnitude-dependent scaling, or source mutation.
- Shared RAPTOR candle renderer for Mag-Phase-GD and the foundation editor.
  Each frequency bucket uses all source samples: wick = min/max, body = 25th/75th
  percentiles, cross mark = median. These are frequency statistics, not time OHLC.
- Fixed, labelled 0–100% lane. Higher means more coherent. A uniform bucket
  has a flat body rather than invented variation. No connecting coherence curve.
- Hover in Mag-Phase-GD reports the nearest original sample as a percentage;
  candle tooltip reports its bucket frequency range, extrema, median and count.
  The two values intentionally describe different things.
- Density is bounded by display width; magnitude/phase still use their existing
  drawing and editing rules. Light/Dark remain enabled.

## Auto EQ semantics

- UI minimum is 0–100%, default 50%, including decimals. Public JS API remains
  0..1. Invalid API thresholds fail rather than silently clamping to 1.
- Reject zero coherence and samples below threshold. For included samples use
  exactly `w = coherence`. Candidate ranking is `w * correction_dB^2`.
- Accept a band only if the actual RBJ summed response reduces
  `sum(w * residual_dB^2) / sum(w)`. Test full, half and quarter candidate gain.
  This is a bounded greedy fit, not a guarantee of the global optimum.
- Show coherence-weighted RMS before/after; retain trusted-point P95/max in
  the programmatic report. Coherence weighting is not multiplied by magnitude.
- Keep original indices to stop Q width estimation across excluded samples.
  Stop at sparse half-octave jumps too. Real EQ tails can still affect excluded
  regions; this is not a brick-wall protection mask.
- Manual magnitude and phase bands stay; previous Auto EQ contribution is removed
  before refitting. Require Bypass off so subtraction matches the active output.
- Compile RBJ coefficients once per candidate, reuse trig coordinates, and use
  a sliding exact local median for null protection.

## Verification

`node tests/raptor-coherence-autoeq.test.js` covers threshold boundaries,
fractional percentages, zero weight, numerical weighted RMS, center selection,
Q gaps, repeated application, bypass, manual-band preservation, deep-null guard,
compiled/editor response parity, source immutability, candle statistics, dense
extrema, SVG construction and clearing, strict import validation and a dense
16,384-point performance check. Run all `tests/*.test.js` as regression checks.

Live browser visual verification was blocked by the test environment's local
URL policy. SVG construction is tested, but this is not a visual sign-off.

## IP scope

The renderer is implemented in this repository without copying competitor UI,
assets or source code. This is not legal clearance. Copyright generally protects
expression rather than mathematical concepts; patents, trademarks and other
rights require separate assessment. Changing a chart style alone does not
guarantee non-infringement or prevent litigation. Obtain jurisdiction-specific
IP review before commercial launch.

References: [WIPO copyright overview](https://www.wipo.int/en/web/copyright),
[USPTO distinctions](https://www.uspto.gov/trademarks/basics/trademark-patent-copyright).
