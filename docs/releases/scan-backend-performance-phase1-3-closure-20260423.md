# Scan Backend Performance Phase 1-3 Closure

- Date: 2026-04-23
- Branch: `codex/scan-backend-performance-plan-render`
- Staging URL: `https://nutri-app-qn0u.onrender.com`
- Staging commit: `729caa01c4c89990de2b6c3437937f9bcb95606c`

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

Latest staging commit probe:

- Expected: `729caa01c4c89990de2b6c3437937f9bcb95606c`
- Observed: `729caa01c4c89990de2b6c3437937f9bcb95606c`
- Result: matched on first probe.

## Phase 2: Stream Tail Optimization

Status: closed for backend stream performance release, with an explicit persistence-tail tradeoff.

The event-loop lag guard now uses a short/resettable sampling window so historical lag does not degrade an entire stream batch. The full stream path also avoids blocking high-pressure requests behind the long tail by returning a lightweight core fallback instead of emitting `STREAM_BUSY`.

Latest concurrency gate evidence:

- Report: `/Users/howard07/NuTriApp/nutri-app/output/enrich-stream-concurrency-gate-1776989544372/report.json`
- Generated at: `2026-04-24T00:12:55.037Z`
- Scenario: `parallel9`
- Total: 45
- Terminal counts: `DONE=45`
- Failure class counts: `none=45`
- `STREAM_BUSY=0`
- `HTTP_ERROR=0`
- `CLIENT_TIMEOUT=0`
- `DEGRADED_EVENTLOOP=0`
- `done_ms p95=814`
- `done_ms max=1232`
- `rev1_to_done_ms p95=0`
- Payload budget: max observed 19116 bytes, warn/fail exceeded false.

Tradeoff:

- `persistedCommitNotCompletedBeforeDoneCount=42` under `parallel9`.
- This is intentional for the current objective: return core results first under pressure, while deep/persist tail work continues outside the first visible result path.

## Phase 3: Sidecar Layering

Status: closed for backend/cache/metrics release.

Implemented backend-only sidecar classification and instrumentation:

- Core: `decision_support`, `scan_facts`
- Deferred: `ingredient_overview`, `scientific_background`, `product_overview_ai`
- Monitor-only: `summary_safety`

Implemented stable sidecar cache key and TTL policy without changing response shape. Reused rev1 inline decision/facts when available to avoid duplicate decision-support recomputation.

Observed sidecar metrics from staging `/internal/metrics` after the passing gate:

- Metrics process started at `2026-04-23T23:57:11.020Z`; last flush at `2026-04-24T00:13:11.885Z`.
- `decision_support`: priority `core`, fetch count 36, cache hits 27, cache misses 9, cache writes 9, latency count 36, avg 528 ms, max 5073.8 ms.
- `decision_support_refetch_count_per_scan=0`
- `decision_support_digest_mismatch=0`
- `decision_inputs_hash_mismatch=0`
- The concurrency profile exercised the core decision-support sidecar. Deferred sidecars remain policy/cache instrumented but were not on the hot path for this gate.

## Render Regression

Status: closed for the current backend/staging release gate.

GitHub Actions evidence:

- Workflow: `Render Regression`
- Run: `https://github.com/77777R7/NuTri-App/actions/runs/24864845104`
- Event: `workflow_dispatch`
- Head SHA: `729caa01c4c89990de2b6c3437937f9bcb95606c`
- Status: `completed`
- Conclusion: `success`
- Created: `2026-04-23T23:55:38Z`
- Updated: `2026-04-23T23:57:44Z`

Local rerun note:

- A local rerun without the CI `RENDER_REGRESSION_TOKEN` is not an equivalent gate. It can authenticate with `RENDER_AUTH_DISABLED_HEADER=1`, but cannot enable the regression-only LNHPD/sample debug branch required by the blocking source/form assertions. The official CI run above is the closure evidence for this gate.

## Mobile Smoke

Report:

- `/Users/howard07/NuTriApp/nutri-app/output/mobile-scan-smoke-mini/mobile-scan-smoke-mini-1776990200421.json`
- `/Users/howard07/NuTriApp/nutri-app/output/mobile-scan-smoke-mini/mobile-scan-smoke-mini-1776990200421.md`

Result:

- Pass: 11
- Fail: 0

Device preflight is now closed:

- `device_preflight=pass`
- `preflightTargetUdid=7849BDF1-4677-424B-A26B-DC0CBF2B7EB2`
- `preflightAppUrl=nutri://`
- `popupBlocked=false`
- `popupSignals=none`

Backend scan gates passed:

- `done_seen_rate=100%`
- `score_visible_rate=100%`
- `killer_client_timeout_rate=0%`
- role gates passed for not found, fish oil, algal oil, whey protein, food-like gel, and food-like drink mix
- repeat consistency passed

## Closure Decision

Phase 1, Phase 2, and Phase 3 are closed for backend/staging performance work on commit `729caa01c4c89990de2b6c3437937f9bcb95606c`.

The previous large unresolved block, Render Regression, is closed by the passing GitHub Actions run above.

Release caveats:

- Device preflight is closed by the 11/11 mobile smoke report above.
- Express 5 remains isolated on its dedicated Phase 5 branch and is not mixed into this performance release.
- Expo camera remains gated on real UPC/EAN/QR/code128 device evidence and was not changed in this backend-only closure.
