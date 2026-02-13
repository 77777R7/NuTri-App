# KB PROV-style Index (PROV-DM Inspired)

This document describes the **KB provenance index** produced by:

- `scripts/kb/build_kb_prov_index.mjs`

and validated by:

- `scripts/kb/prov_validate.mjs`

## Scope and Non-Goals

**Scope**
- Provide a **queryable, auditable provenance graph** for the shipped production KB package.
- Make it cheap to answer: "Why can we say this?" and "Where is the evidence chain?"
- Support CI and regression tooling (artifacts), not user-facing APIs.

**Non-goals**
- This output is **PROV-style** (PROV-DM inspired). It is **not** a strict PROV-JSON / PROV-O (JSON-LD) export.
  - A standards-compliant exporter can be added later without changing IDs/types here.

## Output Shape

The output JSON contains two parallel representations:

1. `edges`: a compatibility list used by existing tooling (kept for backward compatibility).
2. `prov`: a graph-shaped structure:
   - `entities[]`
   - `activities[]`
   - `agents[]`
   - `derivations[]`
   - `wasGeneratedBy[]`
   - `wasAssociatedWith[]`

## Anchors (Version / Hash)

`meta.anchors` must include:
- `packageSha256`
- `runtimeSha256`
- `evidenceSha256`

Optional:
- `serverCommitSha`

These anchors are validated in CI.

## ID Conventions (Stable, Validated)

IDs are strings with stable prefixes:

### Entities
- `entity:kb_package:<packageSha256>`
- `entity:ingredient_form_claim:<ingredientFormKey>`
- `entity:sentence:<sentenceId>`
- `entity:excerpt:<excerptId>`
- `entity:reference:<referenceId>`

### Activities
- `activity:kb_build:<packageVersion>`
- `activity:kb_prov_export:<generatedAt>`

### Agents
- `agent:script:scripts/kb/build_kb_prov_index.mjs`
- `agent:commit:<serverCommitSha>` (optional; may be omitted if unknown)

## Entity Types (Validated Enum)

Each entity has `entityType` and must be one of:
- `kb_package`
- `ingredient_form_claim`
- `sentence`
- `excerpt`
- `reference`

## Provenance Edges

### `derivations[]`

Each derivation edge uses:
- `generatedEntity` (entity id)
- `usedEntity` (entity id)
- `activity` (activity id)
- `relation` (fixed string, currently `"wasDerivedFrom"`)

### `wasGeneratedBy[]`

Each generation edge uses:
- `entity` (entity id)
- `activity` (activity id)

### `wasAssociatedWith[]`

Each association edge uses:
- `activity` (activity id)
- `agent` (agent id)

## Stability Guarantees

To reduce artifact diff noise and support baselines:
- `edges` are sorted deterministically.
- `prov.entities/activities/agents` are sorted by `id`.
- `prov.derivations/wasGeneratedBy/wasAssociatedWith` are sorted deterministically by their key fields.

## CI Validation

CI runs `scripts/kb/prov_validate.mjs` and fails on:
- Missing required anchors
- Duplicate IDs
- Invalid ID prefixes (`entity:` / `activity:` / `agent:`)
- Invalid entity types (outside the enum)
- Broken references (edges referencing missing nodes)

