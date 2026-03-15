# Week 3 Safety Capability Summary

Generated: 2026-03-14T23:15:45.227Z

## Product-level UL coverage
- Dynamic UL guidance is enabled for Tier 1 whitelist ingredients: Magnesium, Vitamin C, Zinc, Iron, Folate
- Tier 2 fallback ingredients are canonicalized conservatively: Vitamin B12, Omega-3, NAC

## My Saved duplicate warning
- High-confidence duplicate warnings surface only when the ingredient is Tier 1, UL-comparable, and present in at least 2 saved products.
- Daily total uses label daily estimate when available; otherwise it falls back to 1 serving/day and discloses that basis.

## Supported units
- Comparable: mcg, mg, g, IU (only when UL basis is compatible)
- Conservative fallback: CFU, mL, DFE-style ambiguous units

## Known gaps
- No pregnancy/lactation personalization in Week 3.
- Tier 2 ingredients remain fallback-only and never surface as high-confidence UL-over warnings.
- Saved items without cached active rows are skipped and disclosed instead of forced into a comparison.
