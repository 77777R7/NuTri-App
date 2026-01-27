# NuTri Score Pipeline (LNHPD) — End-to-End Workflow

This document explains the full database-to-score pipeline for NuTri Score, from raw LNHPD facts to validated score releases. It is intended for onboarding new teammates and preserving the audit trail of how we move data through parsing, identity resolution, form coverage, and verified promotion.

## 0) High-Level Objective

We want a repeatable, gated pipeline that:
- Normalizes raw facts into stable ingredients and forms.
- Resolves identity gaps without polluting taxonomy.
- Improves form coverage without raising mismatch risk.
- Promotes a small, verified knowledge subset that affects scores in a controlled way.
- Produces evidence packs for audits and rollback.

## 1) Data Flow Overview

**Source**: LNHPD facts (raw labels, ingredient fields, quantities, units).

**Stages**:
1. **Parsing Layer** (no scoring impact)
   - Token normalization, aliasing, form token extraction.
   - Inputs: `form_aliases`, `token_aliases`, `normalization_rules`, `generic_form_tokens`.
2. **Identity Layer** (ingredient_id resolution)
   - Maps raw ingredient names to canonical ingredients and synonyms.
   - Uses alias-first logic; avoids duplicate canonicals.
3. **Forms Layer** (form coverage)
   - Forms and aliases exist, but default to pending unless verified.
4. **Scoring Layer**
   - Uses `product_ingredients` + knowledge layers to compute scores.
   - Writes to `product_scores` (baseline) or `product_scores_shadow` (shadow compare).
5. **Verified Promotion**
   - Small, high-ROI batch of forms/evidence set to verified.
   - Single `datasetVersion` bump only when ready to release.

## 2) Parsing Layer (Form Raw / Taxonomy)

**Goal**: Increase form recognition while keeping taxonomy mismatch under 0.08.

**Characteristics**:
- Parsing patches do **not** bump datasetVersion.
- Imports are run as `--only-parsing --force-pending --skip-dataset-version --strict`.
- Guardrails:
  - `taxonomyMismatchAmongResolved <= 0.08`
  - `changedToEmpty == 0`
  - Write-canary confirms `empty→nonempty` when candidates exist.

**Why it matters**: This reduces `formRawMissing` and `formRawNoMatch` without touching scores.

## 3) Identity Layer (ingredient_id_missing)

**Goal**: Reduce missing ingredient IDs across multiple cohorts (1k, 5kA, 5kB).

**Key Rules**:
- **Alias-first**: If canonical exists, only add synonym; do not create new canonical.
- **Strict Latin binomial** for botanicals:
  - `Genus species` pattern only.
  - Stoplist for protein/oil/oxide/etc.
  - Variants (subsp/var/cv/x) normalized to base binomial.
- **Microbe guard**: if `lactobacillus/bifidobacterium/streptococcus`, do not classify as botanical.
- **Solvent/metal/excipient guard**: do not auto-create canonicals for these.

**Why it matters**: Identity gaps cap form coverage and distort scoring; resolving them first prevents later waste.

## 4) Phase A/B/C Progression

**Phase A**: Ensure identity patch actually works in DB (canary lookups, resolver test, single backfill).

**Phase B**: Strike pack on Top missing keys (alias-first) and targeted rebackfill.

**Phase C**: Stability across cohorts (1k, 5kA, 5kB) with hard gates:
- `ingredientIdMissingRatio <= 0.10` (5kA and 5kB)
- `taxonomyMismatch <= 0.08`
- `failuresLines == 0`
- `changedToEmpty == 0`

**Phase C Output**: evidence_pack.json with all gates and diagnostics.

## 5) Scoring Layer and Shadow Compare

We added `product_scores_shadow` to compare baseline vs promotion without touching production scores.

**Why**: Avoid overwriting baseline, enable safe regression testing.

### Shadow Backfill Modes
- **Baseline**: scoreVersion A (e.g., `v4.0.0-alpha.3`), written to `product_scores_shadow`.
- **Shadow**: scoreVersion B with promotions (e.g., `phaseD-shadow-YYYYMMDD`), also to `product_scores_shadow`.

We compare scores by version, not by table.

## 6) Phase D (Verified Promotion)

**Goal**: Promote a small, high-ROI subset of forms/evidence to verified and ensure score deltas are controlled.

**Hard Gates**:
- `failuresLines == 0`
- `changedToEmpty == 0`
- `taxonomyMismatch <= 0.08`
- `gt20Ratio <= 1%`
- `gt10Ratio <= 5%`

**Risk Budget**:
- We do **not** force Top-20 promotion.
- Instead, we prune promotions until deltas are under budget.

**Outcome**: We only bump `datasetVersion` once gates pass.

## 7) Evidence Pack

Every Phase C/D run produces an evidence pack with:
- run_id
- scoreVersion A/B
- rebackfill summary
- cohort diagnostics
- gt10/gt20 ratios
- changedToEmpty counts

This makes the pipeline auditable and reversible.

## 8) Why the Pipeline Is Safe

- Parsing changes do not affect scoring.
- Identity changes are pending and alias-first.
- Shadow tables isolate regression risk.
- Dataset version bump happens only after passing gates.
- Targeted rebackfill avoids full DB churn.

## 9) Current Operating Assumptions

- LNHPD is the current primary source.
- DSLD will follow once LNHPD gates pass.
- Verified promotions are small batch, evidence-backed.

---

## Quick Reference: Critical Tables

- `product_ingredients`: parsed facts + form_raw
- `ingredients`, `ingredient_synonyms`: identity resolution
- `ingredient_forms`, `ingredient_form_aliases`: forms coverage
- `form_aliases`, `token_aliases`, `normalization_rules`, `generic_form_tokens`: parsing layer
- `product_scores`: baseline scores
- `product_scores_shadow`: shadow scoring for regression

---

## Next Step After Phase D PASS

1. Bump datasetVersion once.
2. Targeted rebackfill on affected canonical_source_ids.
3. Run final regression compare and archive evidence pack.
4. Begin DSLD pipeline.

