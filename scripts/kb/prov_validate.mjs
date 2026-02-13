#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const PROV_PATH =
  process.env.KB_PROV_INDEX_PATH || path.join("artifacts", "kb", "kb_prov_index.json");
const OUT_PATH =
  process.env.KB_PROV_VALIDATE_REPORT_PATH ||
  path.join("artifacts", "kb-integrity", `${Date.now()}`, "prov_validate_report.json");

const modeInput = String(process.env.KB_PROV_VALIDATE_MODE || "fail").toLowerCase();
const mode = modeInput === "warn" ? "warn" : "fail";

const parseJsonFile = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(String(raw).replace(/\bNaN\b/g, "null"));
};

const countBy = (arr, fn) =>
  arr.reduce((acc, item) => {
    const key = fn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

async function main() {
  const provIndex = await parseJsonFile(PROV_PATH);
  const prov = provIndex?.prov && typeof provIndex.prov === "object" ? provIndex.prov : null;

  const violations = [];

  const anchors = provIndex?.meta?.anchors ?? null;
  const requiredAnchors = ["packageSha256", "runtimeSha256", "evidenceSha256"];
  const missingAnchors = requiredAnchors.filter((key) => !anchors || typeof anchors[key] !== "string" || !anchors[key].trim());

  if (missingAnchors.length) {
    violations.push({
      type: "missing_anchor",
      missingAnchors,
    });
  }

  const entities = Array.isArray(prov?.entities) ? prov.entities : [];
  const activities = Array.isArray(prov?.activities) ? prov.activities : [];
  const agents = Array.isArray(prov?.agents) ? prov.agents : [];
  const derivations = Array.isArray(prov?.derivations) ? prov.derivations : [];
  const wasGeneratedBy = Array.isArray(prov?.wasGeneratedBy) ? prov.wasGeneratedBy : [];
  const wasAssociatedWith = Array.isArray(prov?.wasAssociatedWith) ? prov.wasAssociatedWith : [];

  const entityById = new Map();
  for (const e of entities) {
    const id = typeof e?.id === "string" ? e.id : null;
    if (!id) {
      violations.push({ type: "entity_missing_id" });
      continue;
    }
    if (!id.startsWith("entity:")) {
      violations.push({ type: "entity_id_prefix_invalid", id });
    }
    if (entityById.has(id)) {
      violations.push({ type: "duplicate_entity_id", id });
      continue;
    }
    const entityType = typeof e?.entityType === "string" ? e.entityType : null;
    const allowedEntityTypes = new Set([
      "kb_package",
      "ingredient_form_claim",
      "sentence",
      "excerpt",
      "reference",
    ]);
    if (!entityType || !allowedEntityTypes.has(entityType)) {
      violations.push({ type: "entity_type_invalid", id, entityType });
    }
    entityById.set(id, e);
  }

  const activityById = new Map();
  for (const a of activities) {
    const id = typeof a?.id === "string" ? a.id : null;
    if (!id) {
      violations.push({ type: "activity_missing_id" });
      continue;
    }
    if (!id.startsWith("activity:")) {
      violations.push({ type: "activity_id_prefix_invalid", id });
    }
    if (activityById.has(id)) {
      violations.push({ type: "duplicate_activity_id", id });
      continue;
    }
    activityById.set(id, a);
  }

  const agentById = new Map();
  for (const ag of agents) {
    const id = typeof ag?.id === "string" ? ag.id : null;
    if (!id) {
      violations.push({ type: "agent_missing_id" });
      continue;
    }
    if (!id.startsWith("agent:")) {
      violations.push({ type: "agent_id_prefix_invalid", id });
    }
    if (agentById.has(id)) {
      violations.push({ type: "duplicate_agent_id", id });
      continue;
    }
    agentById.set(id, ag);
  }

  for (const d of derivations) {
    const generatedEntity = typeof d?.generatedEntity === "string" ? d.generatedEntity : null;
    const usedEntity = typeof d?.usedEntity === "string" ? d.usedEntity : null;
    const activity = typeof d?.activity === "string" ? d.activity : null;
    if (!generatedEntity || !usedEntity || !activity) {
      violations.push({ type: "derivation_missing_fields", derivation: d });
      continue;
    }
    if (!entityById.has(generatedEntity)) {
      violations.push({ type: "derivation_missing_generated_entity", id: generatedEntity, derivation: d });
    }
    if (!entityById.has(usedEntity)) {
      violations.push({ type: "derivation_missing_used_entity", id: usedEntity, derivation: d });
    }
    if (!activityById.has(activity)) {
      violations.push({ type: "derivation_missing_activity", id: activity, derivation: d });
    }
  }

  for (const wgb of wasGeneratedBy) {
    const entity = typeof wgb?.entity === "string" ? wgb.entity : null;
    const activity = typeof wgb?.activity === "string" ? wgb.activity : null;
    if (!entity || !activity) {
      violations.push({ type: "wasGeneratedBy_missing_fields", edge: wgb });
      continue;
    }
    if (!entityById.has(entity)) {
      violations.push({ type: "wasGeneratedBy_missing_entity", id: entity, edge: wgb });
    }
    if (!activityById.has(activity)) {
      violations.push({ type: "wasGeneratedBy_missing_activity", id: activity, edge: wgb });
    }
  }

  for (const waw of wasAssociatedWith) {
    const activity = typeof waw?.activity === "string" ? waw.activity : null;
    const agent = typeof waw?.agent === "string" ? waw.agent : null;
    if (!activity || !agent) {
      violations.push({ type: "wasAssociatedWith_missing_fields", edge: waw });
      continue;
    }
    if (!activityById.has(activity)) {
      violations.push({ type: "wasAssociatedWith_missing_activity", id: activity, edge: waw });
    }
    if (!agentById.has(agent)) {
      violations.push({ type: "wasAssociatedWith_missing_agent", id: agent, edge: waw });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode,
    inputPath: PROV_PATH,
    outputPath: OUT_PATH,
    totals: {
      entities: entities.length,
      activities: activities.length,
      agents: agents.length,
      derivations: derivations.length,
      wasGeneratedBy: wasGeneratedBy.length,
      wasAssociatedWith: wasAssociatedWith.length,
      violations: violations.length,
    },
    missingAnchors,
    countsByType: countBy(violations, (v) => v.type || "unknown"),
    violations,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`[prov_validate] wrote report: ${OUT_PATH}`);
  console.log(`[prov_validate] mode=${mode} violations=${violations.length}`);

  if (mode === "fail" && violations.length > 0) {
    console.error("[prov_validate] violations detected");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[prov_validate] fatal: ${String(err)}`);
  process.exit(1);
});
