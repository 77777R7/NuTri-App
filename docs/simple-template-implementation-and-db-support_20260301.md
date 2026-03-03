# Simple Template Rollout + DB Support Audit

Date: 2026-02-28 (PST)

## 1) What was implemented (your 6-point direction)

### Added
1. **Top trust micro-panel** on each sheet (`Overview/Science/Usage/Safety`):
   - Verified source
   - Retrieved date
   - Web evidence used/not used
   - Record completeness (x/6)
   - Reason for limited completeness
   - `View sources` expandable drawer
2. **Overview simplified to customer-first structure**:
   - `Verified product summary`
   - `Dose and directions (verified)`
   - `Missing info` with one clear CTA
3. **Science simplified**:
   - `General science (NIH ODS)` with collapsed details
   - `Verified ingredient snapshot`
   - `AI summary (grounded)` copy updated to non-technical wording
4. **Usage simplified**:
   - Removed repeated dose emphasis from Usage section
   - Kept directions + conservative guidance + timing tip
5. **Safety reshaped to 3 buckets**:
   - `Label warnings`
   - `Upper limit (UL) guidance`
   - `Interactions and watch-outs (general)`
6. **Repeated Data Status removed from non-overview sheets**:
   - Data status card now shown in Overview only

### Removed / downgraded in default Simple view
1. No mandatory display of internal-style technical fragments in default copy (e.g. `match score` / `RBF` style lines are filtered in customer summary bullets).
2. Removed large ODS safety wall-of-text from default safety module.
3. Removed repeated “missing info” echo pattern from every sheet.

## 2) Code locations touched

- `/Users/howard07/NuTriApp/nutri-app/components/scan/AnalysisDashboard.tsx`

Validation run:
- `npx tsc -p /Users/howard07/NuTriApp/nutri-app/tsconfig.scan-gate.json --noEmit` ✅

---

## 3) Database support audit for the new template

Audit artifact:
- `/Users/howard07/NuTriApp/nutri-app/output/ux-template-data-support-2026-02-28.json`

Sampling method:
- LNHPD sample: **20,000** rows from `lnhpd_facts_complete`
- DSLD sample: **20,000** rows from `dsld_label_facts` (+ `dsld_labels_meta` join by `dsld_label_id`)
- Table sizes:
  - `lnhpd_facts_complete` (facts_json non-null): **101,515**
  - `dsld_label_facts` (facts_json non-null): **120,304**
  - `dsld_labels_meta`: **120,304**

### Field support matrix (sample-based)

| Template field | LNHPD support | DSLD support | Verdict |
|---|---:|---:|---|
| Product name | 100.00% | 100.00% | Strong |
| Brand | 100.00% | 100.00% | Strong |
| Active ingredient exists | 100.00% | 99.98% | Strong |
| Ingredient + dose + unit | 99.39% | 96.13% | Strong |
| Directions (record-level) | 99.94% | 0.00% | **Asymmetric** |
| Dosage form | 100.00% | 100.00% | Strong |
| Serving size | 0.00% | 100.00% | **Asymmetric** |
| Label-specific warnings | 0.01% | 0.00% | **Very weak** |
| Source identity for linking | 100.00% | 100.00% | Strong |
| Package size | N/A in sampled facts | 99.87% | Strong (DSLD) |
| PDF evidence present | N/A | 63.67% | Partial |

---

## 4) Can current DB support this new customer template?

### Yes (fully supportable now)
1. Trust panel source identity + freshness
2. Verified product summary (name/brand)
3. Ingredient snapshot with dose
4. Dosage form display
5. DSLD serving size + package details

### Partially supportable (needs source-specific fallback)
1. **Directions**:
   - LNHPD: strong
   - DSLD: generally absent in current facts
2. **Serving size**:
   - DSLD: strong
   - LNHPD: generally absent in current facts
3. **Safety warnings**:
   - Both datasets: label-specific warnings are near-zero, so safety must rely on general ODS/UL guidance unless label scan provides warning panel

### Not supportable as “always product-specific” today
1. Label-specific warning narrative for most records (both LNHPD/DSLD)

Reference from latest available soak artifact:
- `/Users/howard07/NuTriApp/nutri-app/output/v1.6.9-newcal-s50-run2/rounds_summary.json`
  - `ulReferenceCoverageVerified = 27.91%`
  - `ulEligibleRateVerified = 25.58%`
  - Top miss reason: `NO_UL_CANDIDATE`

---

## 5) Required runtime fallback policy (already aligned with new UI)

1. If warnings missing:
   - Show `Label-specific warnings: not available yet`
   - Show one CTA to scan Supplement Facts + Warnings panel
2. If DSLD directions missing:
   - Show conservative general usage guidance; do not fabricate product-specific directions
3. If LNHPD serving size missing:
   - Do not fake serving-size line; show only available structured fields
4. Keep “general” vs “verified” labels explicit in Science/Safety

---

## 6) Recommended next data-layer upgrades (to make template even stronger)

1. **Warnings ingestion priority P0**
   - Add/expand warning extraction into canonical facts for LNHPD + DSLD pipelines
2. **DSLD directions enrichment**
   - Parse structured direction/use fields from label source where available
3. **LNHPD serving-size derivation policy**
   - Introduce deterministic serving-size normalization where source gives equivalent quantity info
4. **Evidence quality flags per section**
   - Persist per-section completeness flags so UI can avoid runtime heuristics
