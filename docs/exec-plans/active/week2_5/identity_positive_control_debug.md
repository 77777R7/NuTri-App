# Identity Positive Control Debug

- generatedAt: 2026-03-14T17:05:18.823Z
- controlValidity: invalid
- attempted: 8
- discovery_hits: 0
- expected_page_accepts: 5
- primaryFailureLocus: search_source_defect
- secondaryFailureLocus: normalization_defect

## Brand Notes


## Rows

- Healthy Origins | Healthy Origins, Natural, Ubiquinol, 100 mg, 30 Softgels | barcode_sensitive | discovery=expected_only | expected=accepted | locus=search_source_defect
- Healthy Origins | Healthy Origins, Alpha Lipoic Acid, 600 mg, 150 Veggie Caps | title_sensitive | discovery=expected_only | expected=accepted | locus=search_source_defect
- Pure Encapsulations | Amino-NR | barcode_sensitive | discovery=expected_only | expected=accepted | locus=search_source_defect
- Pure Encapsulations | NAC + Glycine Powder | title_sensitive | discovery=expected_seen_rejected | expected=weak_title_overlap, full_normalized_title_mismatch, core_ingredient_title_mismatch | locus=normalization_defect
- Nature's Bounty | Nature's Bounty, 5-HTP, 60 Capsules | barcode_sensitive | discovery=expected_only | expected=accepted | locus=search_source_defect
- Nature's Bounty | Nature's Bounty, Acidophilus Probiotic, 120 Tablets (0.5 mg per Tablet) | title_sensitive | discovery=expected_only | expected=accepted | locus=search_source_defect
- Schiff | Schiff, Digestive Advantage®, Daily Probiotics + Gas Defense, 32 Capsules | barcode_sensitive | discovery=expected_not_seen | expected=fetch_failed:This operation was aborted | locus=fetch_defect
- Schiff | Schiff, Move Free, Joint Health, 80 Coated Tablets | title_sensitive | discovery=expected_seen_rejected | expected=weak_title_overlap, full_normalized_title_mismatch, core_ingredient_title_mismatch | locus=normalization_defect
