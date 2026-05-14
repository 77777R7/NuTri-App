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
- App root wraps Product Search/Paywall consumers in `SubscriptionProvider` under `AuthProvider`.
- Product Search rejects cached/bootstrap rows without `productId`, so stale non-clickable rows cannot ship as real results.
- Result rows are memoized and use stable FlatList render/key/layout hints; per-row list animations were removed from the large continuation list.

## Verification Already Run

Focused contracts:

```bash
node --import tsx --test tests/search/product-search-ui-contract.test.ts backend/tests/product-search-query-planning.test.ts
```

Result: 47 passed.

Fresh check after legacy-bootstrap guard: 47 passed.

Fresh check after simulator-smoke testID contract: 49 passed.

Fresh check after root-provider, cache, analysis-crash, trust-copy, and FlatList performance fixes: 49 passed.

Post-deploy smoke verifier contract:

```bash
node --test tests/search/product-search-release-smoke.test.mjs
```

Result: 3 passed.

One-command local release verifier:

```bash
npm run search:verify-release
```

Result:

```text
Product Search smoke script syntax: passed
App alias import resolution: checked 736 source files
App root provider contracts: passed
Product Search UI and query-planning contracts: 49 passed
Product Search replay and smoke verifier tests: 22 passed
Backend release build: passed
summary {"status":"pass","passed":6,"total":6,"failed":null}
```

Script syntax check:

```bash
node --check scripts/maintainer/smoke-product-search-release.mjs
```

Result: passed.

Simulator smoke hooks:

- Product Search screen, input, result list, result cards, loading-more footer, retry footer, and end-of-results footer expose stable `testID` hooks.
- Database analysis screen, loading state, error state, retry button, and dashboard wrapper expose stable `testID` hooks.
- The hooks are non-visible and are locked by `tests/search/product-search-ui-contract.test.ts`.

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

Clean release worktree note:

- The isolated `/private/tmp/nutri-product-search-release` worktree does not keep its own `node_modules` or `.env` files.
- For local verification only, tests can use temporary symlinks to the main workspace dependencies and env files.
- Remove those temporary symlinks before checking git status or generating the deploy patch.
- In Codex sandbox, direct `node` is the reliable networked runner. `npm run search:smoke-release` can be blocked by `CODEX_SANDBOX_NETWORK_DISABLED=1`, but the same package script is valid from a normal developer terminal.
- `npm run search:verify-release` is intended for local release verification; it does not hit production and can run with the usual workspace dependencies/env available.

Scan/onboarding guard contracts:

```bash
node --import tsx --test tests/scan/personalized-insights-coach-overlay-contract.test.ts tests/scan/scan-trust-ui-contract.test.ts
```

Result on the current release commit: 4 passed.

## Simulator Smoke On 2026-05-14

Environment used:

- iOS simulator: `NuTri Database Smoke (F24F8B3A-7634-44F1-B2B1-8B06F3F177EE)`.
- Dev build bundle id: `com.nutri-Nige.app`.
- Metro: release worktree on Node 20, port `8081`.
- The app is still pointed at current production API (`https://nutri-app-qn0u.onrender.com`) for this smoke, so backend-contract failures below remain production-deploy issues.

Findings and fixes from real simulator smoke:

- `/search` originally crashed because `SubscriptionProvider` was missing at the app root. Fixed in `app/_layout.tsx` and locked by `scripts/maintainer/check-app-provider-contracts.mjs`.
- Search initially showed a large result count but cards could be non-clickable when stale AsyncStorage bootstrap rows lacked `productId`. Fixed by cache key `product-search-bootstrap-v6`, bootstrap validation, and navigable-row filtering.
- Database analysis crashed on tap because shared scan dashboard helpers/props were missing in the Database route path. Fixed `findGoalCoverageByLabel`, `lowerFirst`, `isOmega3AggregateLineName`, and `secondaryNote` wiring.
- Search list initially emitted `VirtualizedList: large list slow to update` during hand swipes. Fixed by memoizing result rows, making render/key/layout stable, and removing per-row Moti animations from the large continuation list.

Current simulator evidence:

- Search first screen renders `Showing 20 of 1155 results`, not `20 of 20`.
- Repeated hand swipes continue into later catalog rows without immediately falling to `End of results`.
- After the FlatList performance patch, repeated hand swipes produced no new `VirtualizedList` warning in Metro.
- Result tap opens `/search/analysis` directly.
- Database analysis renders without onboarding coach overlay.
- The analysis hero displays `Database label record`, not `Web hint (unverified)`.
- Practical usage and safety sections render real product content rather than `unavailable right now`.

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

Fresh production probe on 2026-05-14 after the release commit was prepared:

```text
/api/search?query=&page=1&limit=20      200 192ms rows=20 total=1155
/api/search?query=&page=2&limit=20      200 862ms rows=20 total=1155
/api/search/bootstrap                   200 39ms  All rows=20
```

The fresh production probe is faster, but it still does not expose the new continuation contract fields and bootstrap still returns only one cached page for `All`.

Fresh production detail probe:

```text
/api/search/product-detail?productId=39956   200 ingredientOverview=present scientificBackground=present
/api/search/product-detail?productId=124959  200 ingredientOverview=present scientificBackground=present
```

This means the visible `unavailable right now` screenshot is not explained by the product-detail endpoint lacking content; the local release routes Product Search taps through `/search/analysis` with prefetched detail content so the Database path no longer depends on the old scan-result analysis route.

Reusable production smoke added:

```bash
npm run search:smoke-release -- --base-url https://nutri-app-qn0u.onrender.com
```

Codex direct runner used for fresh production proof:

```bash
node scripts/maintainer/smoke-product-search-release.mjs --base-url https://nutri-app-qn0u.onrender.com
```

Fresh smoke result against current production:

```text
status=fail
pass=22
fail=12
coldPage1Ms=269
warmPage1Ms=39
warmPage2Ms=1042
bootstrapMs=42
detailMs=470
```

The latest production smoke shows first-page, page-2, bootstrap, and product-detail latency are now within the current 1500ms warm budget. It still fails for the expected release blockers: `pagination.hasMore`, `pagination.nextPage`, `pagination.shown`, and `pagination.totalIsExact` are still missing, bootstrap still lacks `paginationByCategory.All`, and bootstrap `All` still has only the first 20 rows.

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

Reusable smoke against the local release backend:

```bash
node scripts/maintainer/smoke-product-search-release.mjs --base-url http://127.0.0.1:3031
```

Result:

```text
status=pass
pass=42
fail=0
coldPage1Ms=870
warmPage1Ms=7
warmPage2Ms=4
bootstrapMs=6
detailMs=372
bootstrap All rows=120
```

This is the same verifier that fails against current production; the difference confirms the release commit fixes the backend contract and cached browse depth locally.

Startup warmup hardening:

- `warmProductSearchIndex()` now also warms a bounded set of common Product Search queries when `PRODUCT_SEARCH_WARM_ON_STARTUP=1`.
- Default warm queries cover the release-critical user intents: magnesium, vitamin D/D3, omega-3/fish oil, probiotic, ashwagandha, B12, selenium thyroid support, gut health, mood support, Doctors Best magnesium, Nordic Naturals omega 3, and Sports Research omega-3.
- Local verification with `PRODUCT_SEARCH_WARM_ON_STARTUP=1` and `PRODUCT_SEARCH_STARTUP_WARM_DELAY_MS=0` warmed 15/15 common queries in about 43 seconds as a background task.
- Recommended production env for the release deploy: `PRODUCT_SEARCH_WARM_ON_STARTUP=1`, with the default startup delay unless Render cold-start behavior requires a shorter delay.

## Completion Audit

Do not mark this Goal complete until every row is verified in production or a simulator/TestFlight build that points at the deployed backend.

| Requirement | Release artifact evidence | Current status | Remaining proof needed |
| --- | --- | --- | --- |
| Fast first result paint | Lightweight search index migrations, `scripts/maintainer/refresh-product-search-index.mjs`, startup warmup in `backend/src/productSearch.ts`, local warm replay slowest `79ms`, `scripts/maintainer/smoke-product-search-release.mjs`, `tests/search/product-search-release-smoke.test.mjs` | Locally release-ready; latest production smoke is within the current 1500ms warm budget but still runs the old contract | Deploy backend, run post-deploy smoke, confirm warm page/search median is comfortably sub-second |
| User can browse beyond first screen | `app/search/index.tsx` uses `FlatList` and `onEndReached`; backend pagination returns `hasMore`, `nextPage`, `shown`, `totalIsExact`; bootstrap caches continuation rows | Locally release-ready; production bootstrap still returns `All rows=20` | Deploy backend and confirm page 2/page 3 plus `paginationByCategory.All` |
| Footer never gets stuck on loading | Footer states are covered by contract strings: `Loading more results`, `Try loading more again`, `End of results` | Locally release-ready by code contract | Simulator/TestFlight swipe smoke against deployed backend |
| Search/result count copy is product-grade | List copy uses `Showing ${shown} of ${total} results`; tests assert no technical `Page X of Y` copy | Locally release-ready | Simulator/TestFlight visual smoke |
| Result tap opens Database analysis directly | `app/search/index.tsx` pushes `/search/analysis` with `productId`; `app/search/analysis.tsx` renders `AnalysisDashboard sourceType="database"` | Locally release-ready | Simulator/TestFlight tap smoke |
| Database analysis does not show onboarding coach overlay | `/search/analysis` passes `personalizedGuideMode="hidden"`; search contract asserts it | Locally release-ready | Simulator/TestFlight tap smoke on Database result |
| Simulator/TestFlight smoke can be automated | Product Search and Database analysis expose stable non-visible `testID` hooks for screen, input, list, result cards, loading/retry/end footer states, and analysis dashboard | Locally release-ready selector hooks are present | Run simulator/TestFlight smoke against deployed backend |
| AI deep-dive sections are usable | `/search/analysis` passes `prefetchedDeepDive`; production detail endpoint probe returns `ingredientOverview=present` and `scientificBackground=present` for tested products | Locally release-ready and API content exists in production | Deploy app path and confirm visible tiles no longer say `unavailable right now` |
| Database records do not present as unverified barcode/web hint | Database bundle uses `productIdentity.sourceAttribution: 'label_record'`; trust UI maps that to `Database label record` and `Web evidence: not used` | Locally release-ready | Simulator/TestFlight analysis smoke |
| Ranking matches P0 user complaints | `backend/tests/product-search-query-planning.test.ts` covers Doctors Best magnesium, Nordic Naturals omega 3, selenium thyroid support, gut health, mood support, Sports Research omega-3 continuation | 49/49 focused contracts passed | Optional post-deploy replay against production |
| Replay pack is broad enough for regression | `data/validation/search-p0-release-pack.v0.json` has 96 scenarios; replay tests enforce pagination, zero-result, category, and relevance contracts | 19/19 replay tests passed | Optional post-deploy replay against production |
| Production is actually fixed | Fresh production smoke still lacks new continuation fields and bootstrap still returns one page | Not achieved | Deploy this release commit, refresh index/cache if needed, then rerun production and simulator smoke |

## Scope Audit

The release commit was audited for non-Search risk after local verification.

- Scan freeze audit: the release commit does not modify `app/scan/barcode.tsx`, `app/scan/result.tsx`, or `hooks/useStreamAnalysis.ts`. The protected scan-scope change is limited to `components/scan/AnalysisDashboard.tsx` so the Database analysis route can pass prefetched deep-dive content and use Database label-record trust copy without changing barcode capture or post-scan navigation. `app.config.ts` changes are RevenueCat env passthrough, not scan API wiring.
- `contexts/SubscriptionContext.tsx`, `lib/storage/premiumTester.ts`, RevenueCat env passthrough, and the `react-native-purchases` dependency are included because the baseline branch already imports `useSubscription` from `components/paywall/OfficialPaywallPage.tsx` and `components/scan/AnalysisDashboard.tsx`, while the context file itself is absent from the baseline commit. Removing those files makes the release branch fail to compile.
- These subscription files are not used as evidence that Product Search is fixed. Product Search release evidence remains the search UI/backend contracts, replay pack, smoke script, and local/prod smoke comparison above.
- `scripts/maintainer/lib/cross-surface-quality-reporting.mjs`, `scripts/maintainer/lib/science-validation-reporting.mjs`, and the golden journey packs are retained because the search replay tests import them directly.

## Deployment Blocker

Cannot complete production deployment from the current Codex session yet:

- Render MCP can access the workspace and confirms the live `NuTri-App` service points at GitHub branch `main` with `autoDeploy` off.
- Render latest live deploy is still commit `568b515c75b8e46ee69850624f76cc9e9d712306` (`Add waitlist referral trial bonus entitlement (#200)`), not the release commit.
- The current local release commit is the `codex/product-search-release` branch `HEAD`; use `git rev-parse HEAD` in the release worktree before deploy because amending this handoff commit changes the SHA.
- `git ls-remote origin refs/heads/codex/product-search-release refs/heads/main` shows only remote `main=568b515c75b8e46ee69850624f76cc9e9d712306`; the release branch is not on GitHub yet.
- Local `gh auth status` reports the GitHub token for `77777R7` is invalid.
- A direct `git push origin codex/product-search-release` requires explicit user approval because it exports the release branch to the external GitHub remote `https://github.com/77777R7/NuTri-App.git`.

Need one of:

- Explicitly approve pushing `codex/product-search-release` to `https://github.com/77777R7/NuTri-App.git`; then deploy/merge that commit into the Render `main` branch path.
- Provide the Render deploy hook URL after the release commit is available on GitHub.
- Re-authenticate GitHub CLI with `gh auth login -h github.com` and then approve PR creation/merge.

Operational handoff:

- Short deploy checklist: `docs/product-search-deployment-runbook.md`
- Patch artifact generated locally: `/private/tmp/0001-Ship-Product-Search-release-hardening.patch`
- Git bundle artifact generated locally: `/private/tmp/nutri-product-search-release.bundle`

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
- `tests/search/product-search-release-smoke.test.mjs`
- `data/validation/search-p0-release-pack.v0.json`
- `tests/scan/personalized-insights-coach-overlay-contract.test.ts`
- `tests/scan/scan-trust-ui-contract.test.ts`

Index/migration support:

- `scripts/maintainer/refresh-product-search-index.mjs`
- `scripts/maintainer/smoke-product-search-release.mjs`
- `scripts/maintainer/verify-product-search-release.mjs`
- `supabase/migrations/20260512165918_product_search_index.sql`
- `supabase/migrations/20260512171345_product_search_index_refresh_timeout.sql`
- `supabase/migrations/20260512172155_product_search_index_batch_refresh.sql`
- `supabase/migrations/20260512180044_product_search_index_runtime_acceleration.sql`
- `supabase/migrations/20260512180912_product_search_home_cache.sql`

## Post-Deploy Smoke

Run after Render deploy:

```bash
npm run search:smoke-release -- --base-url https://nutri-app-qn0u.onrender.com
```

Equivalent inline probe:

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
