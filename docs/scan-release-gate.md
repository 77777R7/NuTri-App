# Scan Release Gate

Date established: 2026-03-12

Purpose:
- Gate preview and TestFlight builds for the `Scan barcode` core flow.
- Protect the current Week 1 core 5 stability baseline.

Core barcode set:
- Omega-3: `00023249011835`
- Vitamin C: `00023249090021`
- GI with Phage: `00737870212539`
- Astaxanthin: `00023249012566`
- NAC 600 mg: `00766298001890`

## Must Pass Before Preview/TestFlight

### 1. Contract Consistency
- For each of the 5 core products:
  - `factsDigestHash` from stream `rev1` must match `GET /api/decision-support/v1`
  - `decisionSupportDigest` from stream `rev1` must match `GET /api/decision-support/v1`
  - `decisionInputsHash` from stream `rev1` must match `GET /api/decision-support/v1`

### 2. Score Consistency
- Omega-3: `85 / Strong`
- Vitamin C: `85 / Strong`
- GI with Phage: `60 / Fair`
- Astaxanthin: `85 / Strong`
- NAC 600 mg: `60 / Fair`

### 3. Source Path Safety
- No LNHPD authoritative path for the core 5 US products
- No `stage0Source = "lnhpd"` in logs for the core 5
- No LNHPD-triggered score/content regression for Astaxanthin or NAC

### 4. Recently Scanned
- Delete app
- Reinstall app
- Scan one core product
- `Recently Scanned` must repopulate in the same session

### 5. Core Content
- Product title and brand present
- Nutri Score visible
- 3 deep category cover cards visible
- AI overview ready for the product
- Product image correct when available

## Performance Gate

These thresholds are based on the current production baseline. They are not the final long-term targets; they are the current release protection thresholds.

Per core product:
- `scan-facts(web) <= 400ms`
- `stream rev0 <= 600ms`
- `stream rev1 <= 3000ms`
- `stream done <= 4500ms`

For `GET /api/decision-support/v1`:
- target `<= 600ms`
- temporary tolerated upper bound `<= 1200ms`

Notes:
- A single tolerated outlier is acceptable only if:
  - all 5 products still pass contract consistency
  - no user-facing regression is observed
- repeated outliers across the same product block release

## Telemetry Gate

These counters/timings must be checked during release validation:
- `decision_support_digest_mismatch`
- `decision_inputs_hash_mismatch`
- `decision_support_refetch_count_per_scan`
- `snapshot_bypass_missing_iherb_overlay_rate`
- `bundle_fast_cache_rejected_missing_overlay_rate`
- `stage0_dsld_recovery_rate`
- `stage0_dsld_recovery_ms`
- `time_to_rev0_ms`
- `time_to_rev1_ms`
- `time_to_done_ms`

Frontend scan UX metrics to review:
- `time_to_first_renderable_decision_template`
- `time_to_score_visible`
- `time_to_core_cards_visible`
- `time_to_loading_badge_hidden`
- `decision_support_fetch_count_per_scan`

Monitor-only sidecar metrics:
- `ingredient_overview_ms`
- `scientific_background_ms`
- `product_overview_ai_closed_early_rate`

## Release Checklist

- Run the core 5 production baseline script against Render
- Confirm all digest/hash alignment checks pass
- Confirm all score expectations pass
- Confirm no LNHPD path is used
- Confirm Recently Scanned repopulates after reinstall
- Confirm product images/content/AI are correct on device
- Confirm performance thresholds are within gate
- Confirm telemetry counters do not show a new mismatch spike
- Only after all checks pass: ship preview/TestFlight
