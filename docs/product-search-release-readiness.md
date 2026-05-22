# Product Search Release Readiness

Last updated: 2026-05-14

## Objective

Ship Database / Product Search as a release-grade Pro surface:

- Fast first result paint and responsive pagination.
- Enough catalog depth for browsing beyond the first screen.
- Stable backend pagination contract: `hasMore`, `nextPage`, `shown`, `totalIsExact`.
- Product Search result taps open Database analysis directly.
- Database analysis does not show scan onboarding coach overlays.
- Database analysis has usable deep-dive content instead of empty AI sections.
- Database records do not present as unverified barcode/web-hint scan results.

## Local Implementation Status

Completed locally:

- Search list uses a virtualized `FlatList` continuation model.
- Result counts use product language: `Showing X of Y results`.
- Footer states cover loading more, retry, end of results, and scroll hint.
- Bootstrap cache version rejects stale one-page payloads.
- Live bootstrap responses without continuation fields are rejected so legacy one-page bootstrap cannot overwrite a correct `/api/search` page with `20 of 20`.
- Backend browse bootstrap now caches continuation rows.
- Backend search response includes pagination contract fields.
- Product Search taps route to `/search/analysis` by `productId`.
- `/search/analysis` builds a Database-specific analysis payload.
- Database analysis hides the scan personalization coach overlay.
- Database analysis seeds `Ingredient overview` and `Scientific background`.
- Database analysis skips the scan-sidecar ingredient/science fallback when prefetched deep-dive content exists.
- Trust copy uses Database label-record framing instead of scan-style `Web hint (unverified)`.

## Verification Already Run

Focused contracts:

```bash
node --import tsx --test tests/search/product-search-ui-contract.test.ts backend/tests/product-search-query-planning.test.ts
```

Result: 47 passed.

Fresh check after legacy-bootstrap guard: 47 passed.

Replay / ranking pack:

```bash
node --test tests/search/search-relevance-golden.test.mjs tests/search/search-golden-replay-runner.test.mjs tests/search/search-p0-release-pack.test.mjs
```

Result: 19 passed.

Fresh check after legacy-bootstrap guard: 19 passed.

Focused lint:

```bash
npx eslint app/search/index.tsx tests/search/product-search-ui-contract.test.ts
```

Result: 0 errors.

Scan/onboarding guard contracts:

```bash
node --import tsx --test tests/scan/personalized-insights-coach-overlay-contract.test.ts tests/scan/scan-trust-ui-contract.test.ts
```

Result: 6 passed.

Search index refresh:

```bash
npm run search:refresh-index
```

Result:

- `refreshedRows`: 32581
- `indexedRows`: 32581
- `homeCategories`: 8
- `durationMs`: 171609

## Production State After Index Refresh

Render production currently has refreshed data/cache, but not the new backend contract.

Latest production probe from this session:

```text
Cold-ish run:
/api/search?query=&page=1&limit=20      200 5168ms rows=20 total=317
/api/search?query=&page=2&limit=20      200 1682ms rows=20 total=317
/api/search/bootstrap                   200 2819ms All rows=20

Warm rerun:
/api/search?query=&page=1&limit=20      200 2507ms rows=20 total=317
/api/search?query=&page=2&limit=20      200 1354ms rows=20 total=317
/api/search/bootstrap                   200 246ms  All rows=20
```

Still missing in production until backend deploy:

- `pagination.hasMore`
- `pagination.nextPage`
- `pagination.shown`
- `pagination.totalIsExact`
- bootstrap `paginationByCategory`
- bootstrap continuation rows beyond the first 20 for `All`

Frontend guard added locally:

- If production still serves legacy one-page bootstrap, the app now keeps the direct `/api/search` result and falls back to ordinary paged search for category changes.
- This prevents the user-facing `Showing 20 of 20 results` dead end while backend deploy is pending.

## Local Release Backend Smoke

The clean release commit was also run against a local backend on `http://127.0.0.1:3031` with the same Supabase data.

```text
/api/search?query=&page=1&limit=20          200 927ms rows=20 total=309 hasMore=true nextPage=2 shown=20
/api/search?query=&page=2&limit=20          200 5ms   rows=20 total=309 hasMore=true nextPage=3 shown=40
/api/search?query=magnesium&page=1&limit=20 200 3ms   rows=20 total=309 hasMore=true nextPage=2 shown=20
/api/search?query=magnesium&page=2&limit=20 200 1ms   rows=20 total=309 hasMore=true nextPage=3 shown=40
/api/search/bootstrap                       200 5ms   All rows=120 total=309 hasMore=true nextPage=2 shown=20
```

Continuation check:

- page 1 rows: 20
- page 2 rows: 20
- duplicate count across page 1 and page 2: 0
- first detail probe: product `1146`, coverage-ready, detail returned both `ingredientOverview` and `scientificBackground`.

Build check:

```bash
npm --prefix backend run build
```

Result: passed; Render runtime wrapper was generated.

Full release replay against the local release backend:

```text
Pack: data/validation/search-p0-release-pack.v0.json
Total scenarios: 96
Pass: 96
Warn: 0
Fail: 0

Cold-ish first pass latency:
p50 704ms
p90 1342ms
p95 1628ms
max 3645ms

Warm replay latency:
slowest 79ms
queries over 1000ms: 0
```

The slow tail in the first pass is first-touch cold query/cache work; the same pack is sub-100ms once the runtime cache is warm. The refresh script writes `product_search_home_cache`, so production should run `npm run search:refresh-index` after backend deployment to keep the first browse screen on the warm path.

Startup warmup hardening:

- `warmProductSearchIndex()` now also warms a bounded set of common Product Search queries when `PRODUCT_SEARCH_WARM_ON_STARTUP=1`.
- Default warm queries cover the release-critical user intents: magnesium, vitamin D/D3, omega-3/fish oil, probiotic, ashwagandha, B12, selenium thyroid support, gut health, mood support, Doctors Best magnesium, Nordic Naturals omega 3, and Sports Research omega-3.
- Local verification with `PRODUCT_SEARCH_WARM_ON_STARTUP=1` and `PRODUCT_SEARCH_STARTUP_WARM_DELAY_MS=0` warmed 15/15 common queries in about 43 seconds as a background task.
- Recommended production env for the release deploy: `PRODUCT_SEARCH_WARM_ON_STARTUP=1`, with the default startup delay unless Render cold-start behavior requires a shorter delay.

## Deployment Blocker

Cannot complete production deployment from the current Codex session yet:

- Render MCP returns `no workspace set`.
- Local `gh auth status` reports the GitHub token for `77777R7` is invalid.

Need one of:

- Select the NuTri Render workspace in the Render connector.
- Provide the Render deploy hook URL.
- Re-authenticate GitHub CLI with `gh auth login -h github.com`.

## Deploy-Ready File Set

Primary Product Search release files:

- `app/search/index.tsx`
- `app/search/analysis.tsx`
- `lib/search/databaseAnalysis.ts`
- `lib/api-client.ts`
- `backend/src/productSearch.ts`
- `backend/src/server.ts`
- `components/scan/AnalysisDashboard.tsx`

Tests and validation data:

- `tests/search/product-search-ui-contract.test.ts`
- `backend/tests/product-search-query-planning.test.ts`
- `tests/search/search-relevance-golden.test.mjs`
- `tests/search/search-golden-replay-runner.test.mjs`
- `tests/search/search-p0-release-pack.test.mjs`
- `data/validation/search-p0-release-pack.v0.json`
- `tests/scan/personalized-insights-coach-overlay-contract.test.ts`
- `tests/scan/scan-trust-ui-contract.test.ts`

Index/migration support:

- `scripts/maintainer/refresh-product-search-index.mjs`
- `supabase/migrations/20260512165918_product_search_index.sql`
- `supabase/migrations/20260512171345_product_search_index_refresh_timeout.sql`
- `supabase/migrations/20260512172155_product_search_index_batch_refresh.sql`
- `supabase/migrations/20260512180044_product_search_index_runtime_acceleration.sql`
- `supabase/migrations/20260512180912_product_search_home_cache.sql`

## Post-Deploy Smoke

Run after Render deploy:

```bash
node -e "const base='https://nutri-app-qn0u.onrender.com'; const paths=['/api/search?query=&page=1&limit=20','/api/search?query=&page=2&limit=20','/api/search/bootstrap']; const rowsOf=j=>j.data?.supplements||j.results||[]; const pOf=j=>j.data?.pagination||j.pagination||{}; (async()=>{for(const path of paths){const t=Date.now(); const r=await fetch(base+path); const j=await r.json(); const p=pOf(j); const rows=rowsOf(j); const all=j.data?.categories?.All||[]; const allP=j.data?.paginationByCategory?.All||{}; console.log({path,status:r.status,ms:Date.now()-t,rows:rows.length,allRows:all.length,total:p.total??allP.total,hasMore:p.hasMore??allP.hasMore,nextPage:p.nextPage??allP.nextPage,shown:p.shown??allP.shown,totalIsExact:p.totalIsExact??allP.totalIsExact});}})()"
```

Expected:

- Page 1 returns `rows=20`, `hasMore=true`, `nextPage=2`, `shown=20`, `totalIsExact=true`.
- Page 2 returns `rows=20`, `hasMore=true`, `nextPage=3`, `shown=40`, no duplicates with page 1.
- Bootstrap returns `paginationByCategory.All` and cached `All` rows beyond the first page.
- Median response should be comfortably sub-second on warm production.

Then smoke in simulator/TestFlight:

- Open Product Search.
- Confirm first page says `Showing 20 of N results`, where `N` is the deployed backend total rather than `20`.
- Swipe to load page 2 and page 3.
- Confirm footer never gets stuck on `Loading more results`.
- Confirm result tap opens Analysis directly.
- Confirm no onboarding coach overlay appears.
- Confirm deep-dive tiles show content, not `unavailable right now`.
- Confirm trust copy says label/database record, not unverified barcode/web hint.
