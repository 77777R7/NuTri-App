# Scan RC Natural Traffic Soak

This is the post-RC watch path for scan backend performance and Express 5 runtime behavior. It observes real traffic from `/internal/metrics`; it does not generate synthetic scan samples.

## Dashboard

Generate the current dashboard from staging:

```sh
node scripts/maintainer/scan-rc-soak-dashboard.mjs \
  --api-base-url https://nutri-app-qn0u.onrender.com \
  --out-dir output/scan-rc-soak-dashboard-current
```

The command writes:

- `metrics-snapshot.json`
- `dashboard.json`
- `dashboard.md`
- `dashboard.html`

Use `--previous-json <path>` with a prior `metrics-snapshot.json` when comparing two snapshots. That enables delta checks for new `STREAM_BUSY`, `STREAM_TIMEOUT`, `HTTP_ERROR`, degraded window growth, and duplicate decision-support fetch events.

## Green Criteria

- Enough natural traffic: at least 100 stream terminal samples and 25 score-visible timing events by default.
- Current-window `STREAM_BUSY`, `STREAM_TIMEOUT`, and `HTTP_ERROR` are all `0`.
- Current-window duplicate decision-support fetch events are `0`.
- Current-window degraded stream count is `0`.
- `time_to_score_visible.recentP95Ms` stays in the current RC target band.
- `time_to_core_cards_visible.recentP95Ms` remains near-immediate.
- Decision-support sidecar fetch count does not climb in a way that suggests repeated recomputation for the same scan.

## Express 5 Soak Boundary

`main` currently carries `express@5.2.1`. Treat this as runtime soak, not a new stream optimization wave:

- Run backend build/tests against the Express 5 branch or current `main`.
- Run mobile scan smoke, enrich-stream concurrency gate, and Render regression against the deployed preview/staging URL.
- Watch the same natural-traffic dashboard for route/middleware/error-handling surprises.
- Do not mix Expo camera or barcode UX changes into this soak.
