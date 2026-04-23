# Scan Backend Performance Phase 1-3 Closure

- Date: 2026-04-23
- Branch: `codex/scan-backend-performance-plan-render`
- Staging URL: `https://nutri-app-qn0u.onrender.com`
- Staging commit: `5b380e0a84dd46db47d5d1fa8101d8c1a8c77e8b`

## Scope

This closure covers backend-only scan performance work for Phase 1, Phase 2, and Phase 3.

Frozen scan frontend files were not changed in this wave. The optimization target is faster visibility for the core result, not forcing every deep sidecar or persistence tail to complete before the stream terminal.

## Phase 1: Patch Repair

Status: closed for backend performance release.

Evidence:

- Staging commit matched expected SHA via `scripts/ci/wait-render-commit.mjs`.
- `backend` build passed with `npm run build`.
- Production dependency audit passed with `npm audit --omit=dev --json`.
- Audit result: 0 total vulnerabilities.

## Phase 2: Stream Tail Optimization

Status: closed for backend stream performance release, with an explicit persistence-tail tradeoff.

The event-loop lag guard now uses a short/resettable sampling window so historical lag does not degrade an entire stream batch. The full stream path also avoids blocking high-pressure requests behind the long tail by returning a lightweight core fallback instead of emitting `STREAM_BUSY`.

Concurrency gate evidence:

- Report: `/Users/howard07/NuTriApp/nutri-app/output/enrich-stream-concurrency-gate-1776980892233/report.json`
- Scenario: `parallel9`
- Total: 45
- Terminal counts: `DONE=45`
- Failure class counts: `none=45`
- `STREAM_BUSY=0`
- `HTTP_ERROR=0`
- `CLIENT_TIMEOUT=0`
- `DEGRADED_EVENTLOOP=0`
- `done_ms p95=1312`
- `done_ms max=1519`

Tradeoff:

- `persistedCommitNotCompletedBeforeDoneCount=45` under `parallel9`.
- This is intentional for the current objective: return core results first under pressure, while deep/persist tail work continues outside the first visible result path.

## Phase 3: Sidecar Layering

Status: closed for backend/cache/metrics release.

Implemented backend-only sidecar classification and instrumentation:

- Core: `decision_support`, `scan_facts`
- Deferred: `ingredient_overview`, `scientific_background`, `product_overview_ai`
- Monitor-only: `summary_safety`

Implemented stable sidecar cache key and TTL policy without changing response shape. Reused rev1 inline decision/facts when available to avoid duplicate decision-support recomputation.

Observed sidecar metrics after the passing gate:

- `decision_support`: priority `core`, fetch count 3, cache hits 2, cache misses 1
- `scan_facts`: priority `core`, fetch count 2
- `product_overview_ai`: priority `deferred`, cache miss/write 1
- Decision support digest/input mismatch: 0

## Mobile Smoke

Report:

- `/Users/howard07/NuTriApp/nutri-app/output/mobile-scan-smoke-mini/mobile-scan-smoke-mini-1776981869234.json`
- `/Users/howard07/NuTriApp/nutri-app/output/mobile-scan-smoke-mini/mobile-scan-smoke-mini-1776981869234.md`

Result:

- Pass: 10
- Fail: 1

The only failing gate was `device_preflight_missing`, requiring `nutri://`. Backend scan gates passed:

- `done_seen_rate=100%`
- `score_visible_rate=100%`
- `killer_client_timeout_rate=0%`
- role gates passed for not found, fish oil, algal oil, whey protein, food-like gel, and food-like drink mix
- repeat consistency passed

## Closure Decision

Phase 1, Phase 2, and Phase 3 are closed for backend/staging performance work.

Remaining release caveat:

- Device preflight still needs a real app/device pass before a full mobile release signoff.

