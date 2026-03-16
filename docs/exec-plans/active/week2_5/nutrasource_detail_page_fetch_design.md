# Nutrasource Detail-Page Fetch Design

## Goal
Use Nutrasource product detail pages to turn the current `IFOS` same-bucket flow from:

- brand search confirms brand
- product search confirms product core title
- merge combines both into `verified`

into a stronger path that can also confirm:

- canonical product title
- canonical brand title
- IFOS testing section presence
- lot/batch options
- optional product metadata such as product type and website

## Why This Is Worth Doing
The current `R1` canary already passed after the matching and merge fixes, but it still relies on a two-part inference:

- brand-level official hit
- product-level search hit

That is enough to unlock verified status for the current same-bucket, but a detail-page fetch gives us a cleaner and more scalable proof path for the next wave.

## What We Verified With Agent Browser
Validated on `2026-03-15` using `npx -y agent-browser`.

### Nutrasource detail page
URL tested:

- `https://certifications.nutrasource.ca/certified-products/product?id=BARL0001`

Observed text:

- `Ideal Omega 3 | Barlean's | Certifications by Nutrasource`
- `Product Summary`
- `IFOS Testing Results`
- lot selector entries such as `Lot #: 25003807`

This is enough structure to support a dedicated detail-page parser.

### USP listing
URL tested:

- `https://www.quality-supplements.org/usp_verified_products`

Observed title:

- `Access Denied`

This confirms the main upside of `agent-browser` is on the Nutrasource side, not on USP.

## Proposed Fetch Flow
1. Run Nutrasource brand search.
2. Run Nutrasource product search.
3. If product search returns a `ProductNum` candidate with strong title match, build:
   - `https://certifications.nutrasource.ca/certified-products/product?id=<ProductNum>`
4. Fetch the detail page.
5. Parse detail-page fields.
6. Use detail-page evidence to emit either:
   - direct `verified_registry_match`, or
   - richer `ambiguous_match` with lot-aware/product-aware metadata.

## New Adapter
Add a new adapter kind in quality marks:

- `nutrasource_product_detail`

Expected source shape:

- `programId = ifos`
- `sourceType = official_registry`
- `responseFormat = html`
- `url = https://certifications.nutrasource.ca/certified-products/product?id=<ProductNum>`

## Parser Targets
The detail-page parser should extract:

- page title
- product title
- brand title
- `Product Summary`
- `Product Type`
- `Recommended Daily Allowance`
- `Website`
- `IFOS Testing Results`
- lot selector values

## Matching Rules
When `nutrasource_product_detail` is present:

- require `IFOS Testing Results` or equivalent IFOS cue
- require product title match against normalized product core
- treat brand title as direct brand confirmation
- if lot selector exists, keep a `lot-aware official detail` note for future scoring

This means detail-page evidence can bypass the current `brand-hit + product-hit merge` dependency.

## Fallback Policy
- Default: use normal HTTP fetch first.
- If detail page blocks or returns incomplete content, use `agent-browser` fallback.
- Keep `agent-browser` scoped to Nutrasource detail pages, not the whole registry sweep.

## Expansion Order
Use detail-page fetch first on the newly selected IFOS same-bucket primary brands:

- `Barlean's`
- `Life Extension`
- `Carlson` if new unresolved IFOS rows reappear

Reserve brands:

- `Metagenics`

## Success Criteria
For the first same-bucket expansion wave:

- at least `20%` of detail-page-ready rows upgrade to direct detail-backed verified
- lot selector parsed on at least `70%` of resolved Nutrasource detail pages
- no regression in current `R1` pass behavior

## Implementation Order
1. Add selection builder and cut the first same-bucket batch
2. Add `nutrasource_product_detail` adapter kind
3. Resolve `ProductNum` from product search list
4. Fetch and parse detail page
5. Merge detail-page evidence ahead of brand/product inferred merge
6. Re-run the IFOS same-bucket batch
