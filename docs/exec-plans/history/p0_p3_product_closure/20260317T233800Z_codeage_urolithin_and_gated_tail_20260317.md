# Codeage Urolithin A And Gated Tail

Executed: 2026-03-17

## Immediate Recovery

- Product: `126291` | `Codeage, Liposomal Urolithin A, Eternal, 60 Capsules`
- Method: targeted official fallback using the live Codeage `/en-ca` product page plus a clean manual section override derived from the current official page content
- Final result: `full_overlay_ready`
- Fields closed in this pass:
  - `suggested_use`
  - `warnings`
- Canonical clean values:
  - Suggested use: `Adults: (19 years and over): 1 capsule(s), 2 times per day.`
  - Warnings: `Ask a health care practitioner/health care provider/health care professional/doctor/physician before use if you are taking blood pressure medication. Ask a health care practitioner/health care provider/health care professional/doctor/physician before use if you are taking medications or any other health products, as resveratrol may alter their effectiveness. Ask a health care practitioner/health care provider prior to use if you have a peptic ulcer or excess stomach acid. Ask a health care practitioner/health care provider prior to use if you have high cholesterol. Contra-indications: Do not use if you are pregnant or breastfeeding.`

Evidence:
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_urolithin_official_recovery_clean_20260317/official_fallback_report.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_urolithin_official_recovery_clean_20260317/staging_products.official_refreshed.json`
- `https://www.codeage.com/en-ca/products/urolithin-a-ca`

## Continue Gated

These rows stay gated for now and should not be blindly promoted:

- `157265` | `Codeage, Liposomal Glutathione+, 120 Vegetable Capsules`
  - reason: current live official matching is still ambiguous across multiple glutathione surfaces
- `143300` | `Codeage, Akkermansia 500 Ultra, 90 Vegetable Capsules`
  - reason: no current live match and still missing `ingredient + dosage`
- `121637` | `Codeage, Beauty Tonic, 90 Vegetable Capsules`
  - reason: no current live match and still missing `suggested_use + warnings`
- `157271` | `Codeage, Skin Vitamins+, 30 Vegetable Capsules`
  - reason: no current live match and still missing `suggested_use + warnings`
- `146937` | `Codeage, Sport, Creatine Gummies, Mixed Berry, 120 Gummies`
  - reason: no current live match and still missing `suggested_use + warnings`
- `152821` | `Codeage, Miracle Sugar Allulose Powder, Unflavored, 35.27 oz (1 kg)`
  - reason: only missing `suggested_use`, but this remains outside the immediate supplement-capsule priority lane and should stay gated until explicitly promoted

## Decision

- `Urolithin A` is worth immediate promotion within the Codeage lane.
- `Glutathione+` and the other five ingestible tail rows remain gated.
