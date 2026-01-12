import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type PlanEntry = {
  canonicalName: string;
  canonicalKey?: string | null;
  synonyms?: string[];
  rawSamples?: string[];
  approved?: boolean;
  action?: "create" | "synonym_only" | null;
};

type PlanFile = {
  source?: string | null;
  candidates?: PlanEntry[];
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const planPath =
  getArg("plan") ?? "output/ingredient-resolution/canonical_create_plan.json";
const reportPath =
  getArg("report") ??
  "output/ingredient-resolution/canonical_create_preflight_report.json";

const normalizeKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const normalizeSynonym = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const chunk = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

const run = async () => {
  const raw = await readFile(planPath, "utf8");
  const payload = JSON.parse(raw) as PlanFile;
  const candidates = payload.candidates ?? [];
  const approved = candidates.filter((entry) => entry.approved);
  const createEntries = approved.filter(
    (entry) => (entry.action ?? "create").toLowerCase() !== "synonym_only",
  );
  const synonymOnlyEntries = approved.filter(
    (entry) => (entry.action ?? "create").toLowerCase() === "synonym_only",
  );

  const createKeys = createEntries
    .map((entry) => entry.canonicalKey?.trim() || normalizeKey(entry.canonicalName))
    .filter(Boolean);
  const synonymOnlyKeys = synonymOnlyEntries
    .map((entry) => entry.canonicalKey?.trim() || normalizeKey(entry.canonicalName))
    .filter(Boolean);

  const synonymTargets = new Map<string, string>();
  const missingCanonicalTargets: Record<string, unknown>[] = [];
  if (synonymOnlyKeys.length) {
    const { data, error } = await supabase
      .from("ingredients")
      .select("id,canonical_key,name")
      .in("canonical_key", synonymOnlyKeys);
    if (error) {
      throw new Error(`[preflight] failed to query synonym targets: ${error.message}`);
    }
    (data ?? []).forEach((row) => {
      if (row?.canonical_key && row?.id) {
        synonymTargets.set(row.canonical_key, row.id);
      }
    });
    synonymOnlyKeys.forEach((key) => {
      if (!synonymTargets.has(key)) {
        missingCanonicalTargets.push({ canonicalKey: key });
      }
    });
  }

  const approvedSynonyms = new Map<string, string>();

  approved.forEach((entry) => {
    const name = entry.canonicalName?.trim();
    const synonyms = new Set<string>();
    if (name) synonyms.add(name);
    (entry.synonyms ?? []).forEach((syn) => synonyms.add(syn));
    (entry.rawSamples ?? []).forEach((syn) => synonyms.add(syn));
    const canonicalKey = entry.canonicalKey?.trim() || normalizeKey(entry.canonicalName);
    synonyms.forEach((syn) => {
      const normalized = normalizeSynonym(syn);
      if (!normalized) return;
      approvedSynonyms.set(normalized, canonicalKey);
    });
  });

  const canonicalKeyCollisions: Record<string, unknown>[] = [];
  if (createKeys.length) {
    const { data, error } = await supabase
      .from("ingredients")
      .select("id,canonical_key,name")
      .in("canonical_key", createKeys);
    if (error) {
      throw new Error(`[preflight] failed to query ingredients: ${error.message}`);
    }
    (data ?? []).forEach((row) => {
      if (!row?.canonical_key) return;
      canonicalKeyCollisions.push({
        canonicalKey: row.canonical_key,
        existingId: row.id,
        existingName: row.name,
      });
    });
  }

  const synonymCollisions: Record<string, unknown>[] = [];
  const synonymValues = Array.from(approvedSynonyms.keys());
  for (const batch of chunk(synonymValues, 200)) {
    if (!batch.length) continue;
    const { data, error } = await supabase
      .from("ingredient_synonyms")
      .select("ingredient_id,synonym")
      .in("synonym", batch);
    if (error) {
      throw new Error(`[preflight] failed to query synonyms: ${error.message}`);
    }
    (data ?? []).forEach((row) => {
      const synonym = typeof row?.synonym === "string" ? row.synonym : null;
      if (!synonym) return;
      const canonicalKey = approvedSynonyms.get(normalizeSynonym(synonym));
      if (!canonicalKey) return;
      if (synonymTargets.size) {
        const expectedId = synonymTargets.get(canonicalKey);
        if (expectedId && expectedId === row.ingredient_id) {
          return;
        }
      }
      synonymCollisions.push({
        synonym,
        canonicalKey,
        existingIngredientId: row.ingredient_id,
      });
    });
  }

  const report = {
    timestamp: new Date().toISOString(),
    approvedCount: approved.length,
    plan: path.resolve(planPath),
    canonicalKeyCollisions,
    synonymCollisions,
    missingCanonicalTargets,
    ok:
      canonicalKeyCollisions.length === 0 &&
      synonymCollisions.length === 0 &&
      missingCanonicalTargets.length === 0,
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(
    `[preflight] approved=${approved.length} canonicalKeyCollisions=${canonicalKeyCollisions.length} synonymCollisions=${synonymCollisions.length} missingCanonicalTargets=${missingCanonicalTargets.length}`,
  );

  if (!report.ok) {
    throw new Error(
      "[preflight] collisions found. See canonical_create_preflight_report.json",
    );
  }
};

run().catch((error) => {
  console.error("[preflight] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
