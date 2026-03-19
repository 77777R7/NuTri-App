## Codeage External Discovery Execution Result

Date executed: `2026-03-17`

### Scope executed

- Read lane context from `queued_brand_execution_lanes_current.json` and `queued_brand_target_match_matrix.json`.
- Re-checked current repo-side queue/high-frequency presence for `Codeage`.
- Ran fresh official-site-led discovery against the live Codeage North America storefront (`https://www.codeage.com/en-ca`) using current sitemap and Shopify collection/product JSON surfaces.
- Kept write scope limited to this result file plus `output/p0_p3_codeage_external_discovery_20260317/`.

### Fresh verification outcome

- `Codeage` remains absent from the current canonical high-frequency recovery surface.
- Older queue evidence still exists, but it is not safe to replay as current truth:
  - Prior RapidAPI brand queue: `19` rows = `1` human supplement, `10` pet, `8` topical beauty.
  - Prior API-fill queue: `25` rows = `7` human supplements, `10` pet, `8` topical beauty.
- Live official NA storefront evidence is current and strong:
  - `49` live product URLs in the `en-ca` product sitemap.
  - `52` live collection URLs in the `en-ca` collection sitemap.
  - Key supplement collections are fresh on `2026-03-17`, including:
    - `vitamins-multivitamins-supplements` (`21` products)
    - `healthy-aging` (`12` products)
    - `top-sellers` (`13` products)
    - `new-arrivals` (`8` products)
    - `fitness-sport-supplements` (`3` products)

### Identity decision

- Brand-level surface is mixed-category, not pure supplement-only.
- Human supplement identity is still stable enough for official-site ingestion because the current NA storefront explicitly exposes supplement-bounded collections and current product pages with `Supplement Facts`, `Suggested Use`, and `Ingredients` signals.
- Decision: `Codeage` is representable only as a fresh official supplement-only queue rebuild.
- Decision: do not reuse the March 13 mixed queue as-is.

### Legacy queue carry-forward check

- Only `2` of the `7` legacy human-supplement queue rows still map cleanly to current live official products:
  - `Codeage, Liposomal Glutathione+, 120 Vegetable Capsules` -> live match to `L-Glutathione CA` and `L-Glutathione Powder CA`
  - `Codeage, Liposomal Urolithin A, Eternal, 60 Capsules` -> live match to `Urolithin A CA`
- The other `5` legacy human-supplement rows did not produce clean current live matches and should stay blocker-classified for this lane:
  - `Miracle Sugar Allulose Powder`
  - `Akkermansia 500 Ultra`
  - `Beauty Tonic`
  - `Skin Vitamins+`
  - `Sport, Creatine Gummies`

### Validated current candidates

Focused current official supplement candidates were built from multi-collection overlap plus live page checks. Highest-priority current candidates:

1. `NMN Platinum CA`
2. `Urolithin A CA`
3. `L-Methylfolate 5-MTHF+ CA`
4. `NAC CA`
5. `Nicotinamide Riboside+ CA`
6. `A D K Vitamins CA`
7. `Immuno Colostrum CA`
8. `L-Glutathione CA`
9. `Magnesium L-Threonate CA`
10. `Men’s Daily Multivitamin CA`
11. `Vitamin C + CA`
12. `L-Glutathione Powder CA`

All focused candidates in the structured evidence bundle returned live product pages with status `200`, plus page-level `Supplement Facts`, `Suggested Use`, and `Ingredients` signals.

### Recommended next execution step

- Rebuild `Codeage` as an official supplement-only queue from the live `/en-ca` collections and product pages.
- Start with the focused candidates in `output/p0_p3_codeage_external_discovery_20260317/codeage_official_discovery_evidence.json`.
- Use official product HTML and supplement-facts assets for fill work.
- Keep pet and topical rows out of scope unless a separate user-approved lane explicitly requests them.
- Keep unmatched legacy supplement rows blocker-classified instead of forcing title-threshold loosening.

### Output written

- `output/p0_p3_codeage_external_discovery_20260317/codeage_official_discovery_evidence.json`
