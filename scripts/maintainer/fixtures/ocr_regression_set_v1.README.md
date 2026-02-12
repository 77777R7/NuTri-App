# OCR Regression Set v1

Manifest file: `scripts/maintainer/fixtures/ocr_regression_set_v1.json`

## Storage Contract

- Provider: Supabase Storage
- Bucket: `ocr-regression-v1`
- Object key format: `images/<image_id>__<sha256>.jpg`
- Immutability: append-only (never overwrite an existing key)

## Required Sample Fields (v1.1)

- `image_id`
- `bucket`
- `ingredient_count_gt`
- `key_ingredients_gt`
- `has_two_lane_gt`
- `storage_uri`
- `sha256`
- `panel_type` (`supplement_facts | ingredients_list | nutrition_facts | front_non_target`)
- `eval_target` (boolean)
- `expected_behavior` (`parse_supplement_facts | parse_ingredients_list | should_warn_or_abstain`)
- `has_table_evidence_gt` (boolean or null)
- `source.product_url`
- `source.image_url`
- `source.retrieved_at`
- `source.license`
- `source.attribution`

## How to use

1. Populate manifest samples with immutable storage URIs.
2. Download and hash-verify:

```bash
node scripts/maintainer/fetch-ocr-regression-set.mjs
```

3. Run parser-required regression gate (frozen OCR outputs):

```bash
node scripts/maintainer/ocr-regression-runner.mjs --mode parser --ocr-fixtures scripts/maintainer/fixtures/ocr_outputs_v1
```

4. Run full API replay against local backend (observe mode):

```bash
node scripts/maintainer/ocr-regression-runner.mjs --mode e2e --api-base http://127.0.0.1:3001
```
