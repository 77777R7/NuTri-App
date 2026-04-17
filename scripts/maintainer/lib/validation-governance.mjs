import fs from "node:fs/promises";
import path from "node:path";

import {
  GOLDEN_JOURNEY_CATEGORIES,
  GOLDEN_JOURNEY_GATES,
  GOLDEN_JOURNEY_PERSONAS,
  GOLDEN_JOURNEY_SURFACES,
  loadGoldenJourneyPack,
} from "./cross-surface-quality-reporting.mjs";
import { ROOT_DIR, writeJson, writeText } from "./science-validation-reporting.mjs";

export const EXPECTATION_IDENTITY_MODES = [
  "exact_product",
  "canonical_product",
  "brand_family",
];

export const EXPECTATION_ANCHOR_MODES = [
  "exact_anchor",
  "family_anchor",
];

export const EXPECTATION_SCORE_MODES = [
  "exact_score",
  "same_band",
];

export const EXPECTATION_WARNING_MODES = [
  "exact",
  "detail_superset_allowed",
  "no_contradiction",
];

export const PERSONA_MATURITY_LEVELS = [
  "blocker",
  "nightly",
  "discovery",
];

export const TAXONOMY_OVERLAY_TAGS = [
  "source_sensitive",
  "duplicate_stack_prone",
  "stimulant_sensitive",
  "lifecycle",
  "food_boundary",
  "sparse_or_malformed",
  "strong_title_weak_facts",
  "alias_heavy",
  "multi_variant",
];

const CATEGORY_SET = new Set(GOLDEN_JOURNEY_CATEGORIES);
const PERSONA_SET = new Set(GOLDEN_JOURNEY_PERSONAS);
const SURFACE_SET = new Set(GOLDEN_JOURNEY_SURFACES);
const GATE_SET = new Set(GOLDEN_JOURNEY_GATES);
const IDENTITY_MODE_SET = new Set(EXPECTATION_IDENTITY_MODES);
const ANCHOR_MODE_SET = new Set(EXPECTATION_ANCHOR_MODES);
const SCORE_MODE_SET = new Set(EXPECTATION_SCORE_MODES);
const WARNING_MODE_SET = new Set(EXPECTATION_WARNING_MODES);
const MATURITY_SET = new Set(PERSONA_MATURITY_LEVELS);
const OVERLAY_TAG_SET = new Set(TAXONOMY_OVERLAY_TAGS);

const MATURITY_PRIORITY = {
  blocker: 3,
  nightly: 2,
  discovery: 1,
};

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const readJson = async (filePath) => {
  const resolved = path.resolve(ROOT_DIR, filePath);
  return JSON.parse(await fs.readFile(resolved, "utf8"));
};

const countBy = (items, selector) =>
  items.reduce((acc, item) => {
    const key = selector(item) ?? "unknown";
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
    surfaces: countBy(scenarios, (scenario) => scenario?.surface),
    categories: countBy(scenarios, (scenario) => scenario?.category),
    personas: Array.from(personas).sort(),
  };
};

const addValidationError = (errors, field, message) => {
  errors.push({ field, message });
};

const validateStringList = (errors, field, value, allowedSet = null) => {
  if (!Array.isArray(value)) {
    addValidationError(errors, field, "must be an array");
    return;
  }
  for (const item of value) {
    if (!isNonEmptyString(item)) {
      addValidationError(errors, field, "must contain only non-empty strings");
      continue;
    }
    if (allowedSet && !allowedSet.has(item)) {
      addValidationError(errors, field, `unsupported value: ${item}`);
    }
  }
};

const addMatchingScenarios = ({ scenarios, selected, selectedIds, predicate, minimum }) => {
  const desired = Number(minimum);
  if (!Number.isFinite(desired) || desired <= 0) return;

  const countSelected = () => selected.filter(predicate).length;
  for (const scenario of scenarios) {
    if (countSelected() >= desired) break;
    if (!predicate(scenario) || selectedIds.has(scenario.id)) continue;
    selected.push(scenario);
    selectedIds.add(scenario.id);
  }
};

const scenarioMatchesConfigFilters = (scenario, config) => {
  if (Array.isArray(config.includeSurfaces) && config.includeSurfaces.length > 0) {
    if (!config.includeSurfaces.includes(scenario.surface)) return false;
  }
  if (Array.isArray(config.includeCategories) && config.includeCategories.length > 0) {
    if (!config.includeCategories.includes(scenario.category)) return false;
  }
  if (Array.isArray(config.includeAnyGates) && config.includeAnyGates.length > 0) {
    const gates = Array.isArray(scenario.gates) ? scenario.gates : [];
    if (!gates.some((gate) => config.includeAnyGates.includes(gate))) return false;
  }
  if (Array.isArray(config.includeAnyPersonas) && config.includeAnyPersonas.length > 0) {
    const personas = Array.isArray(scenario.personas) ? scenario.personas : [];
    if (!personas.some((persona) => config.includeAnyPersonas.includes(persona))) return false;
  }
  if (Array.isArray(config.excludeScenarioIds) && config.excludeScenarioIds.includes(scenario.id)) {
    return false;
  }
  return true;
};

const selectByExplicitIds = ({ scenarios, config }) => {
  const selected = [];
  const selectedIds = new Set();
  for (const scenarioId of config.scenarioIds ?? []) {
    const scenario = scenarios.find((item) => item.id === scenarioId);
    if (!scenario || selectedIds.has(scenario.id)) continue;
    selected.push(scenario);
    selectedIds.add(scenario.id);
  }
  return selected;
};

const selectByFilters = ({ scenarios, config }) => {
  const candidates = scenarios.filter((scenario) => scenarioMatchesConfigFilters(scenario, config));
  const selected = [];
  const selectedIds = new Set();

  for (const scenarioId of config.pinnedScenarioIds ?? []) {
    const scenario = candidates.find((item) => item.id === scenarioId)
      ?? scenarios.find((item) => item.id === scenarioId);
    if (!scenario || selectedIds.has(scenario.id)) continue;
    selected.push(scenario);
    selectedIds.add(scenario.id);
  }

  for (const [category, minimum] of Object.entries(config.categoryMinimums ?? {})) {
    addMatchingScenarios({
      scenarios: candidates,
      selected,
      selectedIds,
      predicate: (scenario) => scenario.category === category,
      minimum,
    });
  }

  for (const persona of config.requiredPersonas ?? []) {
    addMatchingScenarios({
      scenarios: candidates,
      selected,
      selectedIds,
      predicate: (scenario) => (scenario.personas ?? []).includes(persona),
      minimum: 1,
    });
  }

  for (const [surface, minimum] of Object.entries(config.surfaceMinimums ?? {})) {
    addMatchingScenarios({
      scenarios: candidates,
      selected,
      selectedIds,
      predicate: (scenario) => scenario.surface === surface,
      minimum,
    });
  }

  const targetSize = Number(config.targetSize) || selected.length;
  for (const scenario of candidates) {
    if (selected.length >= targetSize) break;
    if (selectedIds.has(scenario.id)) continue;
    selected.push(scenario);
    selectedIds.add(scenario.id);
  }

  return selected;
};

export const loadStableGateBaseline = async (
  filePath = "data/validation/stable-gate-baseline.v1.json",
) => readJson(filePath);

export const validateStableGateBaseline = (baseline) => {
  const errors = [];
  if (!isPlainObject(baseline)) {
    return [{ field: "baseline", message: "must be an object" }];
  }
  if (!isNonEmptyString(baseline.version)) {
    addValidationError(errors, "version", "must be a non-empty string");
  }
  if (!isNonEmptyString(baseline.baselineId)) {
    addValidationError(errors, "baselineId", "must be a non-empty string");
  }
  if (!isNonEmptyString(baseline.sourcePackPath)) {
    addValidationError(errors, "sourcePackPath", "must be a non-empty string");
  }
  validateStringList(errors, "stablePackPaths", baseline.stablePackPaths);
  if (!isPlainObject(baseline.expectationModesBySurface)) {
    addValidationError(errors, "expectationModesBySurface", "must be an object");
  } else {
    for (const [surface, modes] of Object.entries(baseline.expectationModesBySurface)) {
      if (!SURFACE_SET.has(surface)) {
        addValidationError(errors, `expectationModesBySurface.${surface}`, `unsupported surface: ${surface}`);
        continue;
      }
      if (!isPlainObject(modes)) {
        addValidationError(errors, `expectationModesBySurface.${surface}`, "must be an object");
        continue;
      }
      if (!IDENTITY_MODE_SET.has(modes.identityMode)) {
        addValidationError(errors, `expectationModesBySurface.${surface}.identityMode`, "unsupported identity mode");
      }
      if (!ANCHOR_MODE_SET.has(modes.anchorMode)) {
        addValidationError(errors, `expectationModesBySurface.${surface}.anchorMode`, "unsupported anchor mode");
      }
      if (!SCORE_MODE_SET.has(modes.scoreMode)) {
        addValidationError(errors, `expectationModesBySurface.${surface}.scoreMode`, "unsupported score mode");
      }
      if (!WARNING_MODE_SET.has(modes.warningMode)) {
        addValidationError(errors, `expectationModesBySurface.${surface}.warningMode`, "unsupported warning mode");
      }
    }
  }
  return errors;
};

export const loadTaxonomyConfig = async (
  filePath = "data/validation/taxonomy-v0.json",
) => readJson(filePath);

export const validateTaxonomyConfig = (taxonomy) => {
  const errors = [];
  if (!isPlainObject(taxonomy)) {
    return [{ field: "taxonomy", message: "must be an object" }];
  }
  if (!isNonEmptyString(taxonomy.version)) {
    addValidationError(errors, "version", "must be a non-empty string");
  }
  if (!Array.isArray(taxonomy.families)) {
    addValidationError(errors, "families", "must be an array");
  } else {
    const coveredCategories = new Map();
    for (const family of taxonomy.families) {
      if (!isPlainObject(family)) {
        addValidationError(errors, "families", "must contain only objects");
        continue;
      }
      if (!isNonEmptyString(family.id)) {
        addValidationError(errors, "families.id", "must be a non-empty string");
      }
      if (!isNonEmptyString(family.name)) {
        addValidationError(errors, `families.${family.id}.name`, "must be a non-empty string");
      }
      validateStringList(errors, `families.${family.id}.categories`, family.categories, CATEGORY_SET);
      validateStringList(errors, `families.${family.id}.overlayTags`, family.overlayTags, OVERLAY_TAG_SET);
      for (const category of family.categories ?? []) {
        if (coveredCategories.has(category)) {
          addValidationError(
            errors,
            `families.${family.id}.categories`,
            `category already assigned to ${coveredCategories.get(category)}`,
          );
        } else {
          coveredCategories.set(category, family.id);
        }
      }
    }
    for (const category of GOLDEN_JOURNEY_CATEGORIES) {
      if (!coveredCategories.has(category)) {
        addValidationError(errors, "families.categories", `missing category coverage for ${category}`);
      }
    }
  }

  if (!isPlainObject(taxonomy.personaMaturity)) {
    addValidationError(errors, "personaMaturity", "must be an object");
  } else {
    for (const [persona, maturity] of Object.entries(taxonomy.personaMaturity)) {
      if (!PERSONA_SET.has(persona)) {
        addValidationError(errors, `personaMaturity.${persona}`, `unsupported persona: ${persona}`);
      }
      if (!MATURITY_SET.has(maturity)) {
        addValidationError(errors, `personaMaturity.${persona}`, `unsupported maturity: ${maturity}`);
      }
    }
  }

  return errors;
};

const familyForCategory = (taxonomy, category) =>
  (taxonomy?.families ?? []).find((family) => (family.categories ?? []).includes(category)) ?? null;

export const deriveScenarioGovernance = (scenario, taxonomy) => {
  const family = familyForCategory(taxonomy, scenario?.category);
  const personaMaturities = (scenario?.personas ?? [])
    .map((persona) => taxonomy?.personaMaturity?.[persona])
    .filter((value) => MATURITY_SET.has(value));
  const primaryPersonaMaturity = personaMaturities.sort(
    (left, right) => (MATURITY_PRIORITY[right] ?? 0) - (MATURITY_PRIORITY[left] ?? 0),
  )[0] ?? "discovery";

  return {
    familyId: family?.id ?? "unclassified",
    familyName: family?.name ?? "Unclassified",
    primaryPersonaMaturity,
    personaMaturities,
    overlayTags: Array.from(new Set(family?.overlayTags ?? [])).sort(),
  };
};

export const summarizeScenarioGovernance = (scenarios, taxonomy) => {
  const governanceRows = scenarios.map((scenario) => deriveScenarioGovernance(scenario, taxonomy));
  return {
    total: scenarios.length,
    familyCounts: countBy(governanceRows, (row) => row.familyId),
    maturityCounts: countBy(governanceRows, (row) => row.primaryPersonaMaturity),
    overlayTagCounts: countBy(
      governanceRows.flatMap((row) => row.overlayTags.map((overlayTag) => ({ overlayTag }))),
      (row) => row.overlayTag,
    ),
  };
};

export const loadCuratedValidationConfig = async (filePath) => readJson(filePath);

export const validateCuratedValidationConfig = (config) => {
  const errors = [];
  if (!isPlainObject(config)) {
    return [{ field: "config", message: "must be an object" }];
  }
  if (!isNonEmptyString(config.version)) {
    addValidationError(errors, "version", "must be a non-empty string");
  }
  if (!isNonEmptyString(config.sourcePackPath)) {
    addValidationError(errors, "sourcePackPath", "must be a non-empty string");
  }
  if (Array.isArray(config.additionalPackPaths) && config.additionalPackPaths.length > 0) {
    validateStringList(errors, "additionalPackPaths", config.additionalPackPaths);
  }
  if (Array.isArray(config.scenarioIds) && config.scenarioIds.length > 0) {
    validateStringList(errors, "scenarioIds", config.scenarioIds);
  } else {
    if (!Number.isFinite(Number(config.targetSize)) || Number(config.targetSize) <= 0) {
      addValidationError(errors, "targetSize", "must be a positive number when scenarioIds is empty");
    }
    if (Array.isArray(config.includeSurfaces) && config.includeSurfaces.length > 0) {
      validateStringList(errors, "includeSurfaces", config.includeSurfaces, SURFACE_SET);
    }
    if (Array.isArray(config.includeCategories) && config.includeCategories.length > 0) {
      validateStringList(errors, "includeCategories", config.includeCategories, CATEGORY_SET);
    }
    if (Array.isArray(config.includeAnyGates) && config.includeAnyGates.length > 0) {
      validateStringList(errors, "includeAnyGates", config.includeAnyGates, GATE_SET);
    }
    if (Array.isArray(config.includeAnyPersonas) && config.includeAnyPersonas.length > 0) {
      validateStringList(errors, "includeAnyPersonas", config.includeAnyPersonas, PERSONA_SET);
    }
  }
  if (Array.isArray(config.pinnedScenarioIds) && config.pinnedScenarioIds.length > 0) {
    validateStringList(errors, "pinnedScenarioIds", config.pinnedScenarioIds);
  }
  if (Array.isArray(config.requiredPersonas) && config.requiredPersonas.length > 0) {
    validateStringList(errors, "requiredPersonas", config.requiredPersonas, PERSONA_SET);
  }
  if (Array.isArray(config.runtimeProfiles)) {
    for (const [index, profile] of config.runtimeProfiles.entries()) {
      if (!isPlainObject(profile)) {
        addValidationError(errors, `runtimeProfiles.${index}`, "must be an object");
        continue;
      }
      if (!isNonEmptyString(profile.id)) {
        addValidationError(errors, `runtimeProfiles.${index}.id`, "must be a non-empty string");
      }
    }
  }
  return errors;
};

export const buildCuratedValidationPack = ({ pack, config }) => {
  const scenarios = Array.isArray(pack?.scenarios) ? pack.scenarios : [];
  const selected = Array.isArray(config.scenarioIds) && config.scenarioIds.length > 0
    ? selectByExplicitIds({ scenarios, config })
    : selectByFilters({ scenarios, config });

  return {
    version: config.version,
    sourcePackVersion: pack?.version ?? null,
    sourcePackPath: config.sourcePackPath,
    generatedAt: Date.now(),
    metadata: {
      releaseBlocker: config.releaseBlocker !== false,
      runner: config.runner ?? null,
      packRole: config.packRole ?? null,
      runtimeProfiles: Array.isArray(config.runtimeProfiles) ? config.runtimeProfiles : [],
      notes: config.notes ?? [],
    },
    summary: summarizeScenarios(selected),
    scenarios: selected,
  };
};

export const renderCuratedValidationMarkdown = (curatedPack) => {
  const lines = [
    "# Curated Validation Pack",
    "",
    `- version: ${curatedPack.version}`,
    `- sourcePackVersion: ${curatedPack.sourcePackVersion ?? "unknown"}`,
    `- total: ${curatedPack.summary?.total ?? 0}`,
    `- releaseBlocker: ${curatedPack.metadata?.releaseBlocker === true ? "true" : "false"}`,
  ];

  if (isNonEmptyString(curatedPack.metadata?.runner)) {
    lines.push(`- runner: ${curatedPack.metadata.runner}`);
  }

  lines.push("", "## Surfaces", "");
  for (const [surface, count] of Object.entries(curatedPack.summary?.surfaces ?? {})) {
    lines.push(`- ${surface}: ${count}`);
  }

  lines.push("", "## Categories", "");
  for (const [category, count] of Object.entries(curatedPack.summary?.categories ?? {})) {
    lines.push(`- ${category}: ${count}`);
  }

  if (Array.isArray(curatedPack.metadata?.runtimeProfiles) && curatedPack.metadata.runtimeProfiles.length > 0) {
    lines.push("", "## Runtime Profiles", "");
    for (const profile of curatedPack.metadata.runtimeProfiles) {
      lines.push(`- ${profile.id}`);
    }
  }

  return `${lines.join("\n")}\n`;
};

export const writeCuratedValidationPack = async ({
  curatedPack,
  outDir = "output/validation-curated",
  outputBase = "curated-validation-pack",
}) => {
  const resolvedOutDir = path.resolve(ROOT_DIR, outDir);
  await fs.mkdir(resolvedOutDir, { recursive: true });
  const timestamp = String(curatedPack.generatedAt ?? Date.now());
  const jsonPath = path.join(outDir, `${outputBase}-${timestamp}.json`);
  const mdPath = path.join(outDir, `${outputBase}-${timestamp}.md`);
  await writeJson(jsonPath, curatedPack);
  await writeText(mdPath, renderCuratedValidationMarkdown(curatedPack));
  return { jsonPath, mdPath };
};

const mergePacks = (packs) => {
  const scenarios = [];
  const seenIds = new Set();
  for (const pack of packs) {
    for (const scenario of pack?.scenarios ?? []) {
      if (!scenario?.id || seenIds.has(scenario.id)) continue;
      scenarios.push(scenario);
      seenIds.add(scenario.id);
    }
  }
  return {
    version: packs.map((pack) => pack?.version).filter(Boolean).join("+"),
    scenarios,
  };
};

export const loadCuratedValidationSourcePack = async (config) => {
  const packPaths = [
    config?.sourcePackPath,
    ...(Array.isArray(config?.additionalPackPaths) ? config.additionalPackPaths : []),
  ].filter(Boolean);
  const packs = await Promise.all(packPaths.map((packPath) => loadGoldenJourneyPack(packPath)));
  return mergePacks(packs);
};
