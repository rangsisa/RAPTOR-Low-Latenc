# RAPTOR GUI

Current working GUI: `gui/matching/`

## Matching v0.6
- Field Light theme for outdoor/touring use
- 65% dual graph workspace / 35% matching tools
- Phase and magnitude graphs
- Phase positive/negative background tint
- Magnitude area fill
- Phase wrap markers
- Synchronized crosshair
- Wheel zoom
- Shift+drag pan
- Alt+drag frequency band ruler
- Fit 20 Hz–20 kHz / clear band controls

Source of truth: GitHub.
Backup/checkpoints: Google Drive `/Rapter GUI`.


## Measurement data contract

The authoritative WebApp working-measurement contract is:

`docs/RAPTOR_MEASUREMENT_CANONICAL_V1_WEBAPP_IMPLEMENTATION_CONTRACT.md`

RAPTOR Measurement Canonical V1 is the single source of truth from import through Editor, Graph, Pipeline, NGA, Matching, API, and Engine/Kernel.


## Roadmap

Active GUI / Pipeline roadmap:

`docs/RAPTOR_GUI_ROADMAP.md`

**Monitor / Multiway priority lock:** Overlay is not Multiway Sum. The Monitor milestone must include phase-aware **complex-domain summation** of multiple paths; drawing several curves together is not sufficient.
