# OCR Frozen Outputs v1

This directory stores parser-regression fixtures for `ocr-regression-runner.mjs --mode parser`.

## Contract

- File name: `<image_id>.json`
- Source sample must exist in `scripts/maintainer/fixtures/ocr_regression_set_v1.json`
- Payload should be a frozen OCR/parser artifact with at least one of:
  - `draft.ingredients[]`
  - `analysis.draft.ingredients[]`
  - `result.draft.ingredients[]`

The parser-required gate uses these files to avoid flaky upstream OCR/provider drift.
Do not place raw source images in this directory.
