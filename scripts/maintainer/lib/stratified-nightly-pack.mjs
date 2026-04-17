import fs from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR, writeJson, writeText } from "./science-validation-reporting.mjs";
import { loadGoldenJourneyPack } from "./cross-surface-quality-reporting.mjs";

const countBy = (scenarios, field) =>
  scenarios.reduce((acc, scenario) => {
    const key = scenario?.[field] ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

const summarizeScenarios = (scenarios) => {
  const personas = new Set();
  for (const scenario of scenarios) {
    for (const persona of scenario?.personas ?? []) {
      personas.add(persona);
    }
  }
  return {
    total: scenarios.length,
    surfaces: countBy(scenarios, "surface"),
    categories: countBy(scenarios, "category"),
    personas: Array.from(personas).sort(),
  };
};

const mergeScenarioPacks = (packs) => {
  const mergedScenarios = [];
  const seenIds = new Set();

  for (const pack of packs) {
    for (const scenario of pack?.scenarios ?? []) {
      if (!scenario?.id || seenIds.has(scenario.id)) continue;
      mergedScenarios.push(scenario);
      seenIds.add(scenario.id);
    }
  }

  return {
    version: packs.map((pack) => pack?.version).filter(Boolean).join("+"),
    scenarios: mergedScenarios,
  };
};

const addMatchingScenarios = ({ scenarios, selected, selectedIds, predicate, minimum }) => {
  const countMatchingSelected = () => selected.filter(predicate).length;
  if (!Number.isFinite(Number(minimum)) || Number(minimum) <= 0) return;

  for (const scenario of scenarios) {
    if (countMatchingSelected() >= Number(minimum)) break;
    if (!predicate(scenario) || selectedIds.has(scenario.id)) continue;
    selected.push(scenario);
    selectedIds.add(scenario.id);
  }
};

export const loadStratifiedNightlyConfig = async (
  filePath = "data/validation/stratified-nightly-pack.v1.json",
) => {
  const resolved = path.resolve(ROOT_DIR, filePath);
  return JSON.parse(await fs.readFile(resolved, "utf8"));
};

export const loadStratifiedNightlySourcePack = async (config) => {
  const packPaths = [
    config?.sourcePackPath,
    ...(Array.isArray(config?.additionalPackPaths) ? config.additionalPackPaths : []),
  ].filter(Boolean);

  const packs = await Promise.all(packPaths.map((packPath) => loadGoldenJourneyPack(packPath)));
  return mergeScenarioPacks(packs);
};

export const buildStratifiedNightlyPack = ({ pack, config }) => {
  const scenarios = Array.isArray(pack?.scenarios) ? pack.scenarios : [];
  const selected = [];
  const selectedIds = new Set();

  for (const scenarioId of config?.pinnedScenarioIds ?? []) {
    const scenario = scenarios.find((item) => item.id === scenarioId);
    if (!scenario || selectedIds.has(scenario.id)) continue;
    selected.push(scenario);
    selectedIds.add(scenario.id);
  }

  for (const [category, minimum] of Object.entries(config?.categoryMinimums ?? {})) {
    addMatchingScenarios({
      scenarios,
      selected,
      selectedIds,
      predicate: (scenario) => scenario.category === category,
      minimum,
    });
  }

  for (const persona of config?.requiredPersonas ?? []) {
    addMatchingScenarios({
      scenarios,
      selected,
      selectedIds,
      predicate: (scenario) => (scenario.personas ?? []).includes(persona),
      minimum: 1,
    });
  }

  for (const [surface, minimum] of Object.entries(config?.surfaceMinimums ?? {})) {
    addMatchingScenarios({
      scenarios,
      selected,
      selectedIds,
      predicate: (scenario) => scenario.surface === surface,
      minimum,
    });
  }

  const targetSize = Number(config?.targetSize) || selected.length;
  for (const scenario of scenarios) {
    if (selected.length >= targetSize) break;
    if (selectedIds.has(scenario.id)) continue;
    selected.push(scenario);
    selectedIds.add(scenario.id);
  }

  const hiddenHoldoutFraction = Number(config?.hiddenHoldoutFraction);
  const remaining = scenarios.filter((scenario) => !selectedIds.has(scenario.id));
  const hiddenHoldoutTarget =
    Number.isFinite(hiddenHoldoutFraction) && hiddenHoldoutFraction > 0
      ? Math.min(remaining.length, Math.floor(scenarios.length * hiddenHoldoutFraction))
      : 0;
  const hiddenHoldout = hiddenHoldoutTarget > 0
    ? remaining.slice(0, hiddenHoldoutTarget)
    : [];

  return {
    version: config?.version ?? "stratified-nightly-pack",
    sourcePackVersion: pack?.version ?? null,
    sourcePackPath: config?.sourcePackPath ?? null,
    additionalPackPaths: config?.additionalPackPaths ?? [],
    targetSize,
    discoveryOnly: config?.discoveryOnly === true,
    releaseBlocker: config?.releaseBlocker !== false,
    hiddenHoldoutFraction: Number.isFinite(hiddenHoldoutFraction) ? hiddenHoldoutFraction : 0,
    generatedAt: Date.now(),
    summary: summarizeScenarios(selected),
    hiddenHoldoutSummary: summarizeScenarios(hiddenHoldout),
    hiddenHoldout,
    scenarios: selected,
  };
};

export const renderStratifiedNightlyMarkdown = (nightlyPack) => {
  const lines = [
    "# Stratified Nightly Pack",
    "",
    `- sourcePackVersion: ${nightlyPack.sourcePackVersion ?? "unknown"}`,
    `- targetSize: ${nightlyPack.targetSize ?? 0}`,
    `- selected: ${nightlyPack.summary?.total ?? 0}`,
    `- discoveryOnly: ${nightlyPack.discoveryOnly === true ? "true" : "false"}`,
    `- releaseBlocker: ${nightlyPack.releaseBlocker === true ? "true" : "false"}`,
    "",
    "## Surfaces",
    "",
  ];

  for (const [surface, count] of Object.entries(nightlyPack.summary?.surfaces ?? {})) {
    lines.push(`- ${surface}: ${count}`);
  }

  lines.push("", "## Categories", "");
  for (const [category, count] of Object.entries(nightlyPack.summary?.categories ?? {})) {
    lines.push(`- ${category}: ${count}`);
  }

  lines.push("", "## Personas", "");
  for (const persona of nightlyPack.summary?.personas ?? []) {
    lines.push(`- ${persona}`);
  }

  if ((nightlyPack.hiddenHoldoutSummary?.total ?? 0) > 0) {
    lines.push(
      "",
      "## Hidden Holdout",
      "",
      `- total: ${nightlyPack.hiddenHoldoutSummary.total}`,
    );
    for (const [category, count] of Object.entries(nightlyPack.hiddenHoldoutSummary.categories ?? {})) {
      lines.push(`- ${category}: ${count}`);
    }
  }

  return `${lines.join("\n")}\n`;
};

export const writeStratifiedNightlyPack = async ({
  nightlyPack,
  outDir = "output/validation-nightly",
  outputBase = "stratified-nightly-pack",
}) => {
  const resolvedOutDir = path.resolve(ROOT_DIR, outDir);
  await fs.mkdir(resolvedOutDir, { recursive: true });
  const timestamp = String(nightlyPack.generatedAt ?? Date.now());
  const jsonPath = path.join(outDir, `${outputBase}-${timestamp}.json`);
  const mdPath = path.join(outDir, `${outputBase}-${timestamp}.md`);
  await writeJson(jsonPath, nightlyPack);
  await writeText(mdPath, renderStratifiedNightlyMarkdown(nightlyPack));
  return { jsonPath, mdPath };
};
