# Product Search Deployment Runbook

Last updated: 2026-05-14

This runbook is for the Product Search release hardening commit at the current release branch HEAD:

```bash
git log --oneline -1
```

## Pre-Deploy

Run the local release verifier before pushing or deploying:

```bash
npm run search:verify-release
```

Expected:

```text
summary {"status":"pass","passed":6,"total":6,"failed":null}
```

If GitHub push is blocked, the release can also be handed off as a patch or bundle generated from the release worktree:

```bash
git format-patch -1 HEAD --output-directory /private/tmp
git bundle create /private/tmp/nutri-product-search-release.bundle HEAD ^568b515c75b8e46ee69850624f76cc9e9d712306
```

## Deploy Backend

Before or during the Render deploy, set:

```text
PRODUCT_SEARCH_WARM_ON_STARTUP=1
```

Deploy the release commit to the backend service that serves:

```text
https://nutri-app-qn0u.onrender.com
```

After deploy, refresh the Product Search index/cache if the deployment did not already run it:

```bash
npm run search:refresh-index
```

## Production Smoke

Run:

```bash
npm run search:smoke-release -- --base-url https://nutri-app-qn0u.onrender.com
```

Pass criteria:

- `status=pass`
- page 1 exposes `hasMore=true`, `nextPage=2`, `shown=20`, `totalIsExact=true`
- page 2 exposes `hasMore=true`, `nextPage=3`, `shown=40`, `totalIsExact=true`
- page 1 and page 2 have no duplicate product ids
- bootstrap exposes `paginationByCategory.All`
- bootstrap `All` cache has continuation rows, not only 20 rows
- product detail has `ingredientOverview` and `scientificBackground`

Current production before deploy is expected to fail this smoke because it still lacks the new pagination contract.

## Simulator / TestFlight Smoke

Run after production smoke passes:

- Open Database / Product Search.
- Confirm the first list shows `Showing 20 of N results`, not `20 of 20`.
- Swipe to page 2 and page 3.
- Confirm footer does not get stuck on `Loading more results`.
- Tap a result.
- Confirm it opens Database analysis directly.
- Confirm no onboarding coach overlay appears.
- Confirm `Ingredient overview` and `Scientific background` show content.
- Confirm trust copy says Database label record / label record framing, not `Web hint (unverified)` or unverified barcode.

## Completion Rule

Do not mark the Product Search release Goal complete until:

- local verifier passes,
- production smoke passes,
- simulator/TestFlight smoke passes,
- and the release commit is actually deployed to the production backend/app path.
