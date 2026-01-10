import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type CandidateEntry = {
  ingredientName: string;
  normalized: string;
  count: number;
  samples?: string[];
  reasons?: string[];
  estimatedCategory?: string | null;
  estimatedBaseUnit?: string | null;
  latinBinomial?: boolean;
};

type CandidateFile = {
  source: string;
  timestamp: string;
  total: number;
  candidates: CandidateEntry[];
};

type PlanEntry = {
  canonicalName: string;
  canonicalKey: string;
  category: string | null;
  baseUnit: string | null;
  synonyms: string[];
  rawSamples: string[];
  count: number;
  reasons: string[];
  excludeReasons: string[];
  approved: boolean;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const inputPath =
  getArg("input") ??
  "output/ingredient-resolution/canonical_missing_create_candidates_lnhpd.json";
const outputPath =
  getArg("output") ?? "output/ingredient-resolution/canonical_create_plan.json";
const limit = Number.parseInt(getArg("limit") ?? "50", 10);

const normalizeKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const NON_SCORING_PATTERNS: { reason: string; pattern: RegExp }[] = [
  {
    reason: "non_scoring_solvent",
    pattern: /\b(ethyl alcohol|ethanol|aqua|water|purified water|glycerin|glycerine)\b/,
  },
  {
    reason: "non_scoring_animal_source",
    pattern: /\b(rabbit|porcine|sus scrofa|oryctolagus cuniculus)\b/,
  },
  {
    reason: "non_scoring_dosage_form",
    pattern: /\b(capsule|capsules|tablet|tablets|softgel|softgels)\b/,
  },
];

const SPECIAL_HANDLING_PATTERNS: { reason: string; pattern: RegExp }[] = [
  {
    reason: "special_handling_homeopathy",
    pattern:
      /\b(homeopathic|homeopathy|natrum muriaticum|kali muriaticum|apis mellifica|mercurius corrosivus)\b/,
  },
  {
    reason: "special_handling_enzyme",
    pattern: /\b(lipase|amylase|protease|lactase|cellulase|bromelain|papain|enzyme|enzymes)\b/,
  },
];

const matchPatterns = (value: string, patterns: { reason: string; pattern: RegExp }[]): string[] =>
  patterns.filter((rule) => rule.pattern.test(value)).map((rule) => rule.reason);

const buildPlanEntry = (entry: CandidateEntry): PlanEntry => {
  const canonicalName = entry.ingredientName.trim();
  const normalized = normalizeText(canonicalName);
  const rawSamples = (entry.samples ?? []).filter(Boolean);
  const synonyms = Array.from(new Set(rawSamples.filter(Boolean)));
  const excludeReasons = [
    ...matchPatterns(normalized, NON_SCORING_PATTERNS),
    ...matchPatterns(normalized, SPECIAL_HANDLING_PATTERNS),
  ];

  return {
    canonicalName,
    canonicalKey: normalizeKey(canonicalName),
    category: entry.estimatedCategory ?? null,
    baseUnit: entry.estimatedBaseUnit ?? null,
    synonyms,
    rawSamples,
    count: entry.count,
    reasons: entry.reasons ?? [],
    excludeReasons,
    approved: false,
  };
};

const run = async () => {
  const raw = await readFile(inputPath, "utf8");
  const payload = JSON.parse(raw) as CandidateFile;
  const candidates = payload.candidates ?? [];

  const planned = candidates.slice(0, limit).map(buildPlanEntry);

  const output = {
    source: payload.source ?? "unknown",
    timestamp: new Date().toISOString(),
    total: planned.length,
    candidates: planned,
  };

  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log(
    `[canonical-plan] wrote ${planned.length} entries to ${path.resolve(outputPath)}`,
  );
};

run().catch((error) => {
  console.error("[canonical-plan] failed:", error);
  process.exit(1);
});
