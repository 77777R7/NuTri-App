# Scrapling Known-Product Lanes

These JSON files are reusable lane configs for `run-scrapling-official-fallback-wave.mjs`.

Usage:

```bash
SCRAPLING_PYTHON_BIN=scripts/maintainer/python/.venv_scrapling/bin/python \
node scripts/maintainer/run-scrapling-official-fallback-wave.mjs \
  --config-json docs/exec-plans/active/p0_p3_product_closure/scrapling_lanes/sports_research_iherb_known_product_lane.v1.json
```

Rules:

- Only use known product URLs already present in staging/source summaries.
- Keep coverage gating unchanged.
- Use merge validation after every lane run.
- Do not use these configs for search discovery.
- NuTri human-supplement scope means only human supplement SKUs should stay in promotable lanes.
- `codeage_iherb_human_supplement_lane.v1.json` is the promotable Codeage iHerb lane.
- Non-human SKUs should be treated as excluded samples, not active fallback lanes.
