# High-Frequency Recovery Wave Status

- generatedAt: 2026-03-17T11:23:36.883Z
- phase: P0-B-recovery-wave
- phaseOutcomeStatus: blocker_isolation

## After-Carlson Base

- stagingPath: `output/week2_p0_rescue_executor/week2-p0-rescue-20260317-warnings_only-carlson-2026-03-17-035746/staging_products.official_refreshed.json`
- stagingSha1: `6f374076c03f268e86b554d4077b2505ccfe5b0c`
- mergeReportPath: `output/p0_p3_merge_after_carlson_20260317/overlay_merge_coverage_report.json`
- highFrequencyValidationPath: `output/p0_p3_highfreq_after_carlson_20260317/high_frequency_hit_validation.json`
- highFrequencyCompleteHitCount: `665`
- highFrequencyCompleteHitRatePct: `40.3`
- highFrequencyMissingOrQueuedCount: `986`

## Brand Recovery Wave

- Healthy Origins: `minimal_signal_non_incremental` | queued=50 | recovered_complete=1 | no_path_found=49
- Schiff: `no_signal` | queued=46 | recovered_complete=0 | no_path_found=46
- Nature's Bounty: `no_signal` | queued=33 | recovered_complete=0 | no_path_found=33
- Pure Encapsulations: `no_signal` | queued=38 | recovered_complete=0 | no_path_found=38
- Natrol: `no_signal` | queued=41 | recovered_complete=0 | no_path_found=41
  Natrol remains consistent with the earlier `rapidapi_identity_only` / no-signal risk classification.

## Combined Wave Effect

- combinedReportPath: `output/p0_p3_combined_recovery_all_v2_20260317/combined_recovery_report.json`
- combinedStagingPath: `output/p0_p3_combined_recovery_all_v2_20260317/staging_products.combined_recovered.json`
- combinedStagingSha1: `6f374076c03f268e86b554d4077b2505ccfe5b0c`
- changedExistingRows: `0`
- addedRows: `0`
- netNewIncrementalUpliftVsAfterCarlsonBase: `false`
- classification: `no_signal_after_carlson_base`

## Final Call

- scaleThisWave: `false`
- reason: Across the full top-gap recovery wave, the combined recovered staging is byte-identical to the after-Carlson base, so this wave produced no net new product-level uplift beyond the Carlson rescue.
