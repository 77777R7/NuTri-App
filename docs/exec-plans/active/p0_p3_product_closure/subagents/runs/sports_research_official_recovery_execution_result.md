# Sports Research Official Recovery Execution Result

Generated at: 2026-03-17T22:41:00Z

## Scope

- Brand: Sports Research
- Objective: close the residual canonical `missing_from_staging` tail with a tightly targeted repo-native replay
- Write scope honored:
  - `docs/exec-plans/active/p0_p3_product_closure/subagents/runs/sports_research_official_recovery_execution_result.md`
  - `output/p0_p3_sports_research_official_recovery_20260317/**`

## Canonical Evidence Inspected

- `docs/exec-plans/active/p0_p3_product_closure/queued_brand_target_match_matrix.json`
  - Sports Research summary: `total=47`, `complete_hit=41`, `active_queue=0`, `missing_from_staging=6`
  - recommended lane: tightly targeted official/iGen replay on the residual tail
- `output/p0_p3_highfreq_schiff_healthy_natures_bounty_nature_made_pure_encapsulations_20260317/high_frequency_hit_details.json`
  - extracted the six canonical residual rows:
    - `00023249011415` | CoQ10 100 mg
    - `00023249010807` | MCT Oil 3000 mg
    - `00023249091561` | NAC 600 mg
    - `00023249004585` | Turmeric Curcumin 500 mg
    - `00023249004387` | Vegan CLA 1250
    - `00023249055679` | Vegan CLA 1250
- Supporting prior artifacts reviewed:
  - `output/sports_research_igen_patch_wave_batch4_retry_20260315/official_fallback_report.json`
  - `output/quality_marks/igen_brand_expansion_wave4_sports_research_final_full_v2_20260315/brand_expansion_wave.json`
  - `output/iherb_partial_wave_plan_week2_remaining_now_batch2_20260313/official_brand_queues/sports-research.json`

## Queue Used

- Built a minimal current queue from canonical evidence only:
  - `output/p0_p3_sports_research_official_recovery_20260317/sports_research_missing_tail_queue.json`
- Queue size: `6`
- Rationale: the older Sports Research official queue did not contain these six residual barcodes, so replaying the 46-row historical queue would have been broader than necessary and still missed the canonical tail.

## Commands Run

1. Built the six-row residual queue:

```bash
node - <<'NODE'
const fs=require('fs');
const path=require('path');
const root=process.cwd();
const outDir=path.join(root,'output','p0_p3_sports_research_official_recovery_20260317');
fs.mkdirSync(outDir,{recursive:true});
const details=JSON.parse(fs.readFileSync(path.join(root,'output','p0_p3_highfreq_schiff_healthy_natures_bounty_nature_made_pure_encapsulations_20260317','high_frequency_hit_details.json'),'utf8'));
const rows=details
  .filter(r=>r.brandName==='Sports Research' && r.validationOutcome==='missing_from_staging')
  .map(r=>({
    candidateId:r.candidateId,
    brandName:r.brandName,
    productName:r.productName,
    barcode_gtin14:r.barcode_gtin14,
    patchPriorityScore:r.patchPriorityScore,
    sourceReasonCode:r.sourceReasonCode,
    canonicalEvidenceSource:'output/p0_p3_highfreq_schiff_healthy_natures_bounty_nature_made_pure_encapsulations_20260317/high_frequency_hit_details.json'
  }));
const payload={
  generatedAt:new Date().toISOString(),
  brandName:'Sports Research',
  rationale:'Canonical six-row missing_from_staging residual tail extracted for narrow brand-specific recovery execution.',
  rows
};
fs.writeFileSync(path.join(outDir,'sports_research_missing_tail_queue.json'), JSON.stringify(payload,null,2)+'\n');
NODE
```

2. Ran a real narrow recovery wave against the six-row queue:

```bash
node scripts/maintainer/recover-missing-from-staging-with-iherb-search.mjs \
  --staging-json output/p0_p3_official_bootstrap_pure_encapsulations_active38_20260317/staging_products.official_refreshed.json \
  --queue-json output/p0_p3_sports_research_official_recovery_20260317/sports_research_missing_tail_queue.json \
  --brands "Sports Research" \
  --sitemap-exact-barcode-first true \
  --search-fallback false \
  --agent-browser-fallback false \
  --out-dir output/p0_p3_sports_research_official_recovery_20260317/exact_barcode_recovery
```

3. First run behavior:
  - the wave processed all six rows, but writing the full staging clone hit `ENOSPC`
  - the oversized partial staging artifact was removed from the same allowed output folder

4. Re-ran the same wave with staging export disabled so the execution report and seed outputs could still be written:

```bash
node scripts/maintainer/recover-missing-from-staging-with-iherb-search.mjs \
  --staging-json output/p0_p3_official_bootstrap_pure_encapsulations_active38_20260317/staging_products.official_refreshed.json \
  --queue-json output/p0_p3_sports_research_official_recovery_20260317/sports_research_missing_tail_queue.json \
  --brands "Sports Research" \
  --sitemap-exact-barcode-first true \
  --search-fallback false \
  --agent-browser-fallback false \
  --write-staging-out false \
  --out-dir output/p0_p3_sports_research_official_recovery_20260317/exact_barcode_recovery
```

## Execution Result

- Output report:
  - `output/p0_p3_sports_research_official_recovery_20260317/exact_barcode_recovery/iherb_search_recovery_report.json`
- Command log:
  - `output/p0_p3_sports_research_official_recovery_20260317/exact_barcode_recovery/command_stderr.log`
  - `output/p0_p3_sports_research_official_recovery_20260317/exact_barcode_recovery/command_stdout.json`

Summary from the successful report write:

- queued: `6`
- processed: `6`
- recovered complete: `0`
- recovered partial: `0`
- identity unresolved: `0`
- no path found: `6`

Improved rows:

- `0`

Processed residual rows:

- `00023249011415` | CoQ10 100 mg | `no_iherb_page_match_after_fetch`
- `00023249010807` | MCT Oil 3000 mg | `no_iherb_page_match_after_fetch`
- `00023249091561` | NAC 600 mg | `no_iherb_page_match_after_fetch`
- `00023249004585` | Turmeric Curcumin 500 mg | `no_iherb_page_match_after_fetch`
- `00023249004387` | Vegan CLA 1250 | `no_iherb_page_match_after_fetch`
- `00023249055679` | Vegan CLA 1250 | `no_iherb_page_match_after_fetch`

## Blocker Classification

Residual Sports Research tail status: `blocker-classified`, not resolved.

Blocker basis:

- The exact-barcode brand-page index scanned `179` Sports Research iHerb brand URLs and found `0` direct exact-barcode matches for the six canonical residual rows.
- The targeted fallback still found nearby sitemap/title candidates and fetched them, but every row failed the repo matcher with `no_iherb_page_match_after_fetch`.
- This means the remaining tail is not a simple replay miss. The canonical residual rows appear to have an identity mismatch between the DSLD-backed residual barcodes and the currently discoverable iHerb Sports Research product pages.
- The earlier Sports Research official/iGen success artifacts remain valid for already-covered rows, but they do not extend to these six residual barcodes.

Operational note:

- A first execution attempt also exposed an environment constraint: full staging clone export currently risks `ENOSPC`. The blocker classification above is not caused by the write-space issue; the successful re-run without staging export still showed `0/6` recoveries.

## Conclusion

- Smallest accurate queue built: yes
- Real brand-specific recovery wave run: yes
- Residual tail resolved: no
- Final disposition: blocker-classified identity mismatch on the remaining six canonical Sports Research rows
