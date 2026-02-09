# DSLD Release Switch SOP (Dataset Version + Warm Backfill + Audit Pack)

This runbook defines the *auditable* steps for switching DSLD scoring to a new dataset version and proving the switch is safe and reproducible.

## Definitions

- **Release switch**: updating `public.scoring_dataset_state.version` for `key='ingredient_dataset'`.
- **Warm backfill**: computing scores for a fixed DSLD pool after the switch so production traffic hits cached score rows.
- **Hard gates**:
  - `failuresLines == 0`
  - `changedToEmptyCount == 0`
  - `taxonomyMismatchAmongResolved <= 0.08`
  - `missingRatio <= 0.10`
- **Risk budget (promotion compare)**:
  - `gt20Ratio <= 1%`
  - `gt10Ratio <= 5%`

## 0) Preconditions (Must Be True)

1. You have a complete evidence pack for the candidate dataset version (Phase D release evidence).
2. The dataset change has passed regression compare in `product_scores_shadow` (baseline vs promotion).
3. The target cohort for warm backfill is frozen and saved to disk:
   - Example (release v15): `backend/output/runs/20260205_dsld_phaseD_release_run1/coverage/valid_ids_release_v15.json`

## 1) Confirm Current Dataset Version (Supabase)

In Supabase SQL Editor:

```sql
select key, version, updated_at
from public.scoring_dataset_state
where key = 'ingredient_dataset';
```

Record this value in the release evidence pack under `datasetVersionBefore`.

## 2) Switch Dataset Version (Supabase)

In Supabase SQL Editor, run **exactly one update**:

```sql
update public.scoring_dataset_state
set version = '<NEW_DATASET_VERSION>',
    updated_at = now()
where key = 'ingredient_dataset';
```

Re-run the select from step 1 and record under `datasetVersionAfter`.

Notes:
- Avoid multiple bumps. If you need to roll back, bump back to the previous version (see Rollback).

## 3) Warm Backfill (50k Valid Pool)

From `backend/`:

```bash
npx tsx scripts/backfill-v4-scores.ts \
  --source dsld \
  --source-ids-file output/runs/<RELEASE_RUN>/coverage/valid_ids_release_<TAG>.json \
  --concurrency 2 \
  --batch 200 \
  --summary-json output/runs/<RELEASE_RUN>/rebackfill/release_switch_status.json \
  --failures-file output/runs/<RELEASE_RUN>/rebackfill/release_switch_failures.jsonl
```

Hard expectation:
- `failuresLines == 0`
- `processed == len(valid_ids)`

Record `release_switch_status.json` and failures file path in the evidence pack.

## 4) Runtime Refresh (Render)

After the warm backfill completes, restart the backend service so process-lifetime caches reload cleanly.

Record:
- Render service URL (e.g. `https://nutri-app-qn0u.onrender.com`)
- Restart timestamp window

## 5) Runtime Smoke Test (10–50 IDs)

Pick 10–50 DSLD ids from the warm backfill pool (spread across the range).

Call the v4 score endpoint and verify:
- no `5xx`
- response includes v4 score bundle (or expected `not_found`/`pending`), but never timeouts

Record a minimal log (no tokens):
- `{ sourceId, status, computedAt }[]`

## 6) Archive “Release Evidence Pack”

Create a final JSON that points at:
- Phase D release evidence pack
- scale gate summary (if applicable)
- datasetVersion before/after
- release_switch_status + failures file path
- runtime smoke results

This file becomes the single handoff artifact for audits.

## Rollback Notes (Read Before Releasing)

Rolling back `scoring_dataset_state.version` **does not** undo any knowledge rows that were promoted/modified in the DB.

Therefore, rollback choices:
1. **Version rollback only**: fastest, but only safe if the DB knowledge deltas are backward compatible.
2. **Revert script**: requires an auditable before/after patch log (recommended for future promotions).

