#!/usr/bin/env node
/* eslint-disable no-console */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Build a provenance index (graph-shaped JSON) from the shipped production KB package.
//
// Goal: make audit/tracing cheap without introducing a new database or changing runtime behavior.
// This is intended as an artifact for CI/scorecard/debug, not a user-facing API payload.

const RUNTIME_PATH =
  process.env.KB_RUNTIME_INDEX_PATH || path.join("backend", "data", "kb", "kb_runtime_index.json");
const EVIDENCE_PATH =
  process.env.KB_EVIDENCE_EXCERPTS_PATH || path.join("backend", "data", "kb", "kb_evidence_excerpts.json");
const OUT_PATH =
  process.env.KB_PROV_INDEX_PATH || path.join("artifacts", "kb", "kb_prov_index.json");

const loadJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf-8");
  const sanitized = String(raw).replace(/\bNaN\b/g, "null");
  return JSON.parse(sanitized);
};

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const idSafe = (value) => String(value ?? "").replace(/[^A-Za-z0-9_.:-]+/g, "_");

async function main() {
  const runtimeRaw = await fs.readFile(RUNTIME_PATH, "utf-8");
  const runtime = JSON.parse(String(runtimeRaw).replace(/\bNaN\b/g, "null"));
  const runtimeSha = sha256(runtimeRaw);

  let evidence = null;
  let evidenceSha = null;
  try {
    const evidenceRaw = await fs.readFile(EVIDENCE_PATH, "utf-8");
    evidence = JSON.parse(String(evidenceRaw).replace(/\bNaN\b/g, "null"));
    evidenceSha = sha256(evidenceRaw);
  } catch {
    // evidence file is optional for this index; keep nulls in meta.
  }

  const edges = [];
  const ingredientFormIndex = runtime?.ingredient_form_index ?? {};
  for (const [key, entry] of Object.entries(ingredientFormIndex)) {
    const ingredientId = String(entry?.ingredient_id ?? "").trim() || null;
    const ingredient = String(entry?.ingredient ?? "").trim() || null;
    const formKey = String(entry?.form_key ?? "").trim() || null;
    const formDisplay = String(entry?.form_display ?? "").trim() || null;
    const segments = entry?.segments;
    if (!segments || typeof segments !== "object") continue;

    for (const [segmentName, seg] of Object.entries(segments)) {
      const en = seg?.en;
      if (!Array.isArray(en)) continue;
      for (const s of en) {
        if (!s || typeof s !== "object") continue;
        const sentenceId = String(s.sentence_id ?? "").trim() || null;
        const excerptId = String(s.evidence_snippet_id ?? "").trim() || null;
        const referenceId = String(s.evidence_reference_id ?? "").trim() || null;
        if (!sentenceId || !excerptId || !referenceId) continue;
        edges.push({
          ingredientFormKey: key,
          ingredientId,
          ingredient,
          formKey,
          formDisplay,
          segment: segmentName,
          lang: "en",
          sentenceId,
          excerptId,
          referenceId,
          source: s.source ?? null,
          reviewStatus: s.review_status ?? null,
          evidenceGrade: s.evidence_grade ?? null,
          evidenceExcerptStatus: s.evidence_excerpt_status ?? null,
        });
      }
    }
  }

  // Stable ordering for artifacts: avoid noisy diffs due to object traversal order.
  edges.sort((a, b) => {
    const ak = String(a.ingredientFormKey || "");
    const bk = String(b.ingredientFormKey || "");
    if (ak !== bk) return ak.localeCompare(bk);
    const as = String(a.sentenceId || "");
    const bs = String(b.sentenceId || "");
    if (as !== bs) return as.localeCompare(bs);
    const ax = String(a.excerptId || "");
    const bx = String(b.excerptId || "");
    if (ax !== bx) return ax.localeCompare(bx);
    const ar = String(a.referenceId || "");
    const br = String(b.referenceId || "");
    return ar.localeCompare(br);
  });

  const generatedAt = new Date().toISOString();
  const serverCommitSha =
    process.env.RENDER_GIT_COMMIT ?? process.env.GITHUB_SHA ?? process.env.COMMIT_SHA ?? null;
  const packageSha =
    typeof runtime?.meta?.package_sha256 === "string" && runtime.meta.package_sha256.trim()
      ? runtime.meta.package_sha256.trim()
      : runtimeSha;
  const packageVersion =
    typeof runtime?.meta?.generated_at === "string" && runtime.meta.generated_at
      ? `kb:${runtime.meta.generated_at}`
      : `kb:${packageSha.slice(0, 12)}`;

  const entityById = new Map();
  const activityById = new Map();
  const agentById = new Map();
  const derivations = [];
  const wasGeneratedBy = [];
  const wasAssociatedWith = [];

  const addNode = (store, id, node) => {
    if (!id || store.has(id)) return;
    store.set(id, { id, ...node });
  };

  const scriptAgentId = "agent:script:scripts/kb/build_kb_prov_index.mjs";
  addNode(agentById, scriptAgentId, {
    kind: "Agent",
    role: "script",
    label: "scripts/kb/build_kb_prov_index.mjs",
  });
  if (serverCommitSha) {
    addNode(agentById, `agent:commit:${serverCommitSha}`, {
      kind: "Agent",
      role: "commit",
      label: serverCommitSha,
    });
  }

  const kbBuildActivityId = `activity:kb_build:${idSafe(packageVersion)}`;
  const kbProvExportActivityId = `activity:kb_prov_export:${idSafe(generatedAt)}`;

  addNode(activityById, kbBuildActivityId, {
    kind: "Activity",
    label: "KB Production Build",
    startedAt: runtime?.meta?.generated_at ?? null,
    endedAt: generatedAt,
  });
  addNode(activityById, kbProvExportActivityId, {
    kind: "Activity",
    label: "KB PROV Export",
    startedAt: generatedAt,
    endedAt: generatedAt,
  });

  wasAssociatedWith.push({
    activity: kbProvExportActivityId,
    agent: scriptAgentId,
  });
  if (serverCommitSha) {
    wasAssociatedWith.push({
      activity: kbProvExportActivityId,
      agent: `agent:commit:${serverCommitSha}`,
    });
  }

  const kbPackageEntityId = `entity:kb_package:${packageSha}`;
  addNode(entityById, kbPackageEntityId, {
    kind: "Entity",
    entityType: "kb_package",
    packageVersion,
    packageSha256: packageSha,
    runtimeSha256: runtimeSha,
    evidenceSha256: evidenceSha,
  });
  wasGeneratedBy.push({
    entity: kbPackageEntityId,
    activity: kbProvExportActivityId,
  });

  for (const edge of edges) {
    const ingredientFormId = `entity:ingredient_form_claim:${edge.ingredientFormKey}`;
    const sentenceId = `entity:sentence:${edge.sentenceId}`;
    const excerptId = `entity:excerpt:${edge.excerptId}`;
    const referenceId = `entity:reference:${edge.referenceId}`;

    addNode(entityById, ingredientFormId, {
      kind: "Entity",
      entityType: "ingredient_form_claim",
      ingredientFormKey: edge.ingredientFormKey,
      ingredientId: edge.ingredientId,
      ingredient: edge.ingredient,
      formKey: edge.formKey,
      formDisplay: edge.formDisplay,
      segment: edge.segment,
      lang: edge.lang,
      evidenceGrade: edge.evidenceGrade ?? null,
    });
    addNode(entityById, sentenceId, {
      kind: "Entity",
      entityType: "sentence",
      sentenceId: edge.sentenceId,
      segment: edge.segment,
      lang: edge.lang,
    });
    addNode(entityById, excerptId, {
      kind: "Entity",
      entityType: "excerpt",
      excerptId: edge.excerptId,
      excerptStatus: edge.evidenceExcerptStatus ?? null,
    });
    addNode(entityById, referenceId, {
      kind: "Entity",
      entityType: "reference",
      referenceId: edge.referenceId,
      source: edge.source ?? null,
      reviewStatus: edge.reviewStatus ?? null,
    });

    derivations.push({
      generatedEntity: ingredientFormId,
      usedEntity: sentenceId,
      activity: kbBuildActivityId,
      relation: "wasDerivedFrom",
    });
    derivations.push({
      generatedEntity: sentenceId,
      usedEntity: excerptId,
      activity: kbBuildActivityId,
      relation: "wasDerivedFrom",
    });
    derivations.push({
      generatedEntity: excerptId,
      usedEntity: referenceId,
      activity: kbBuildActivityId,
      relation: "wasDerivedFrom",
    });
    wasGeneratedBy.push({
      entity: ingredientFormId,
      activity: kbProvExportActivityId,
    });
  }

  const sortById = (arr) => [...arr].sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  const sortByKeys = (arr, keyFn) =>
    [...arr].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));

  const prov = {
    meta: {
      generated_at: generatedAt,
      runtime: {
        path: RUNTIME_PATH,
        sha256: runtimeSha,
        production_filter: runtime?.meta?.production_filter ?? null,
        review_policy: runtime?.meta?.review_policy ?? null,
        generated_from: runtime?.meta?.generated_from ?? null,
        source: runtime?.meta?.source ?? null,
      },
      evidence: evidenceSha
        ? {
            path: EVIDENCE_PATH,
            sha256: evidenceSha,
            ref_count: evidence?.meta?.ref_count ?? null,
            source: evidence?.meta?.source ?? null,
          }
        : null,
      anchors: {
        packageVersion,
        packageSha256: packageSha,
        runtimeSha256: runtimeSha,
        evidenceSha256: evidenceSha,
        serverCommitSha,
      },
      note:
        "Graph-shaped provenance index from the shipped production KB. Includes compatibility edges and PROV-style nodes.",
    },
    edges,
    prov: {
      entities: sortById([...entityById.values()]),
      activities: sortById([...activityById.values()]),
      agents: sortById([...agentById.values()]),
      derivations: sortByKeys(derivations, (d) => `${d.generatedEntity}|${d.usedEntity}|${d.activity}`),
      wasGeneratedBy: sortByKeys(wasGeneratedBy, (e) => `${e.entity}|${e.activity}`),
      wasAssociatedWith: sortByKeys(wasAssociatedWith, (e) => `${e.activity}|${e.agent}`),
    },
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(prov, null, 2) + "\n");
  console.log(`[kb] wrote prov index: ${OUT_PATH} (edges=${edges.length})`);
}

main().catch((err) => {
  console.error(`[kb] prov build failed: ${String(err)}`);
  process.exit(1);
});
