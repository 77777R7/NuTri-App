# Identity Positive Control Rerun

- generatedAt: 2026-03-14T18:55:46.639Z
- concreteFixApplied: Improved iherb_reader_search candidate extraction and ordering to capture markdown links, bare /pr URLs, and prioritize expected-page matches ahead of search-engine fallbacks.
- controlValidity: invalid
- attempted: 8
- discovery_hits: 0
- expected_page_accepts: 6

## Rows

- Healthy Origins | Healthy Origins, Natural, Ubiquinol, 100 mg, 30 Softgels | discovery=expected_only | expected=accepted | locus=search_source_defect
- Healthy Origins | Healthy Origins, Alpha Lipoic Acid, 600 mg, 150 Veggie Caps | discovery=expected_only | expected=accepted | locus=search_source_defect
- Pure Encapsulations | Amino-NR | discovery=expected_seen_rejected | expected=weak_title_overlap, full_normalized_title_mismatch, core_ingredient_title_mismatch | locus=normalization_defect
- Pure Encapsulations | NAC + Glycine Powder | discovery=expected_only | expected=accepted | locus=search_source_defect
- Nature's Bounty | Nature's Bounty, 5-HTP, 60 Capsules | discovery=expected_only | expected=accepted | locus=search_source_defect
- Nature's Bounty | Nature's Bounty, Acidophilus Probiotic, 120 Tablets (0.5 mg per Tablet) | discovery=expected_not_seen | expected=fetch_failed:curl: (28) Operation timed out after 8003 milliseconds with 0 bytes received
 | locus=fetch_defect
- Schiff | Schiff, Digestive Advantage®, Daily Probiotics + Gas Defense, 32 Capsules | discovery=expected_only | expected=accepted | locus=search_source_defect
- Schiff | Schiff, Move Free, Joint Health, 80 Coated Tablets | discovery=expected_only | expected=accepted | locus=search_source_defect
