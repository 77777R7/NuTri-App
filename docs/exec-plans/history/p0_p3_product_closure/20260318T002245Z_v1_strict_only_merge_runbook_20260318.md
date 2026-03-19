# V1 Strict-Only Merge Runbook

Executed: `2026-03-18T00:22:06Z`

## Objective

Create a conservative V1 merge cohort from the current strict-ready pool and stage it for safe canary-based merge execution.

This runbook intentionally does **not** reopen `queued`.

## Cohort Definition

Included only if all of the following are true:

- `completeness.status == full_overlay_ready`
- `sourceSummary.hasUsIherbPage == true`
- `sourceSummary.npnIgnored == false`
- structured `supplementFacts.nutritionalFacts` are present

Excluded if the product still signals a non-V1 category, including:

- pet / dog / cat
- skin-care / topical / body-care
- soap / cleanser / toothpaste / deodorant
- food / snack / tea / packaged-meal style categories

Codeage closures were patched into the base staging before cohort generation:

- `126291`
- `121637`
- `157265`
- `143300`
- `157271`
- `146937`
- `152821`

## Current Cohort Size

- strict-ready base: `26,552`
- V1 strict-only cohort: `22,273`
- excluded from strict-ready: `4,279`
- canary slice: `2,000`
- batch 2 slice: `10,000`
- remainder slice: `10,273`

Primary summary artifact:

- [v1_strict_only_merge_cohort_summary.json](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_merge_cohort_20260318/v1_strict_only_merge_cohort_summary.json)

Primary staging artifacts:

- [v1_strict_only_full_staging.json](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_merge_cohort_20260318/v1_strict_only_full_staging.json)
- [v1_strict_only_canary_2000_staging.json](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_merge_cohort_20260318/v1_strict_only_canary_2000_staging.json)
- [v1_strict_only_batch2_10000_staging.json](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_merge_cohort_20260318/v1_strict_only_batch2_10000_staging.json)
- [v1_strict_only_remainder_10273_staging.json](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_merge_cohort_20260318/v1_strict_only_remainder_10273_staging.json)

## Preconditions

- `SUPABASE_URL` must be set
- `SUPABASE_SERVICE_ROLE_KEY` must be set
- run from repo root: `/Users/howard07/NuTriApp/nutri-app`

The merge script reads env from both shell and `backend/.env`.

## Step 1: Regenerate The Cohort

```bash
node scripts/maintainer/build-v1-strict-only-merge-cohort.mjs
```

## Step 2: Dry-Run The Full Cohort

```bash
node scripts/maintainer/merge-iherb-overlay-bulk-to-supabase.mjs \
  --input-json output/p0_p3_v1_strict_only_merge_cohort_20260318/v1_strict_only_full_staging.json \
  --out-dir output/p0_p3_v1_strict_only_merge_cohort_20260318/dry_run_full
```

Expected result:

- `matched` should track the V1 strict-only pool
- `merged` should remain `0`
- no `queued` rows should appear unless the cohort definition drifted

## Step 3: Dry-Run The Canary

```bash
node scripts/maintainer/merge-iherb-overlay-bulk-to-supabase.mjs \
  --input-json output/p0_p3_v1_strict_only_merge_cohort_20260318/v1_strict_only_canary_2000_staging.json \
  --out-dir output/p0_p3_v1_strict_only_merge_cohort_20260318/dry_run_canary_2000
```

## Step 4: Apply The Canary

```bash
node scripts/maintainer/merge-iherb-overlay-bulk-to-supabase.mjs \
  --input-json output/p0_p3_v1_strict_only_merge_cohort_20260318/v1_strict_only_canary_2000_staging.json \
  --out-dir output/p0_p3_v1_strict_only_merge_cohort_20260318/apply_canary_2000 \
  --apply
```

## Step 5: Smoke Check After Canary

Required checks before batch 2:

- confirm Supabase upsert count matches `2,000`
- spot-check a few brands from the canary on product surfaces
- confirm no scan-surface changes were involved
- confirm Week 3 safety is unaffected

Recommended quick check:

```bash
node scripts/maintainer/merge-iherb-overlay-bulk-to-supabase.mjs \
  --input-json output/p0_p3_v1_strict_only_merge_cohort_20260318/v1_strict_only_canary_2000_staging.json \
  --out-dir output/p0_p3_v1_strict_only_merge_cohort_20260318/post_apply_canary_recount
```

This should now report the canary rows as already matched/merged under the authoritative identity path.

## Step 6: Apply Batch 2

Only after canary smoke checks pass.

```bash
node scripts/maintainer/merge-iherb-overlay-bulk-to-supabase.mjs \
  --input-json output/p0_p3_v1_strict_only_merge_cohort_20260318/v1_strict_only_batch2_10000_staging.json \
  --out-dir output/p0_p3_v1_strict_only_merge_cohort_20260318/apply_batch2_10000 \
  --apply
```

## Step 7: Apply The Remainder

Only after batch 2 looks healthy.

```bash
node scripts/maintainer/merge-iherb-overlay-bulk-to-supabase.mjs \
  --input-json output/p0_p3_v1_strict_only_merge_cohort_20260318/v1_strict_only_remainder_10273_staging.json \
  --out-dir output/p0_p3_v1_strict_only_merge_cohort_20260318/apply_remainder_10273 \
  --apply
```

## Recommended Stop Conditions

Stop and inspect if any of these happen:

- dry-run shows unexpected `queued` rows
- canary apply produces identity mismatches or unexpected blocked rows
- product-surface spot checks show missing `ingredient / dosage / suggested_use / warnings / image`
- any merge batch includes clearly non-supplement categories that should have been filtered out

## Practical Recommendation

For V1, this is the right merge lane:

- merge `strict-only`
- keep `queued` frozen
- keep the product scope conservative
- let later releases reopen broader coverage only after V1 product usage stabilizes
