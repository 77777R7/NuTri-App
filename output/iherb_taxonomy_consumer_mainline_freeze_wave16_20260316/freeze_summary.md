# iHerb Taxonomy Consumer Mainline Freeze

- frozenAt: 2026-03-16
- baseline: `wave16`
- status: `frozen_for_mainline`

## Mainline Result

- `metabolic_glucose_support`: taxonomy live + consumer copy specialized
- `cholesterol_lipid_support`: taxonomy live + consumer copy specialized
- `liver_bile_support`: taxonomy live + consumer copy specialized

## Validation

- experience pack: `output/iherb_category_experience_validation_pack_wave16_20260316/category_experience_validation_pack.json`
- `weakExperienceCategories = []`
- recommendation: `Consumer experience is strong enough to justify considering a background long-tail cleanup project.`

## Harness State

- `unknownCategoryRate = 0%`
- `deepContentReadyRate = 100%`
- `scoreV2ReadyRate = 100%`

Source:

- `output/iherb_score_category_harness_post_category_expansion_wave13_20260316/quality_summary.json`

## Full Corpus State

- imported rows: `26494`
- `unknownCategoryRate = 14.3%`
- `deepContentReadyRate = 98.0%`
- `highFrequencyUnknownCount = 0`

Source:

- `output/iherb_full_category_census_audit_wave13_20260316/full_category_census_audit.json`

## Freeze Decision

- Mainline taxonomy / consumer-copy work is frozen at this state.
- Next work moves to `background long-tail cleanup`, not continued mainline category framing changes.
- Scan-protected scope was not modified as part of this freeze.
