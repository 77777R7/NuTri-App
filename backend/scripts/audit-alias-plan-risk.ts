import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type PlanAliasRow = {
  ingredient_id?: string | null;
  alias_norm?: string | null;
  form_key?: string | null;
  source_ids?: string[] | null;
  occurrence?: number | null;
};

type PlanPayload = {
  aliases?: PlanAliasRow[] | null;
};

type RiskyRow = {
  ingredient_id: string;
  alias_norm: string;
  alias_norm_basic: string;
  alias_norm_denoised: string;
  form_key: string;
  source_ids: string[];
  occurrence: number;
  riskReasons: string[];
};

type GatePayload = {
  generatedAt: string;
  plan: string;
  pass: boolean;
  riskySingletonCount: number;
  fingerprint: string;
  denylist: string[];
  examples: Array<{
    ingredient_id: string;
    alias_norm: string;
    form_key: string;
    occurrence: number;
    source_ids: string[];
    riskReasons: string[];
  }>;
};

const CONNECTOR_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

// `extract` is common in legitimate supplement aliases and created noisy false positives.
export const RISK_TOKEN_DENYLIST = ["seed", "whole"] as const;
export const GENERIC_SINGLETON_DENYLIST = [
  "blend",
  "complex",
  "formula",
  "support",
  "plus",
  "advanced",
  "max",
] as const;

const args = process.argv.slice(2);

const getArg = (flag: string): string | null => {
  const prefixed = args.find((value) => value.startsWith(`--${flag}=`));
  if (prefixed) return prefixed.slice(`--${flag}=`.length);
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  const next = args[index + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
};

export const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const denoiseAliasNorm = (value: string): string => {
  const basic = normalizeText(value);
  if (!basic) return "";
  const filtered = basic
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !CONNECTOR_STOP_WORDS.has(token));
  return filtered.length > 0 ? filtered.join(" ") : basic;
};

export const tokenizeAliasNorm = (value: string): string[] =>
  denoiseAliasNorm(value).split(/\s+/).filter(Boolean);

const normalizeSourceIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .sort((a, b) => a.localeCompare(b));
};

const toOccurrence = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return 0;
};

export const classifyRiskReasons = (aliasNorm: string): string[] => {
  const reasons = new Set<string>();
  const denoised = denoiseAliasNorm(aliasNorm);
  const tokens = denoised.split(/\s+/).filter(Boolean);
  const tokenSet = new Set(tokens);

  for (const token of RISK_TOKEN_DENYLIST) {
    if (tokenSet.has(token)) reasons.add(`denylist_token:${token}`);
  }

  const vitaminOnly =
    denoised === "vitamin" || (tokens.length === 1 && tokens[0] === "vitamin");
  if (vitaminOnly) reasons.add("denylist_singleton:vitamin");

  const singleton = tokens.length === 1 ? tokens[0] : null;
  if (singleton && GENERIC_SINGLETON_DENYLIST.includes(singleton as (typeof GENERIC_SINGLETON_DENYLIST)[number])) {
    reasons.add(`denylist_singleton:${singleton}`);
  }

  if (singleton && /^[a-z0-9]{1,2}$/i.test(singleton)) {
    const allowedShortSingleton =
      singleton === "a" ||
      singleton === "c" ||
      /^b\d{1,2}$/i.test(singleton) ||
      /^d\d?$/i.test(singleton) ||
      /^k\d?$/i.test(singleton);
    if (!allowedShortSingleton) {
      reasons.add("short_singleton_token");
    }
  }

  return Array.from(reasons).sort((a, b) => a.localeCompare(b));
};

const buildFingerprint = (riskyRows: RiskyRow[]): string => {
  const normalized = riskyRows
    .map((row) => ({
      ingredient_id: row.ingredient_id,
      alias_norm_denoised: row.alias_norm_denoised,
      form_key: row.form_key,
      occurrence: row.occurrence,
      source_ids: row.source_ids,
      riskReasons: row.riskReasons,
    }))
    .sort((a, b) => {
      if (a.ingredient_id !== b.ingredient_id) {
        return a.ingredient_id.localeCompare(b.ingredient_id);
      }
      if (a.alias_norm_denoised !== b.alias_norm_denoised) {
        return a.alias_norm_denoised.localeCompare(b.alias_norm_denoised);
      }
      return a.form_key.localeCompare(b.form_key);
    });
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(filePath);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

export const run = async () => {
  const planArg = getArg("plan");
  const outGateArg = getArg("out-gate");
  const outReviewArg = getArg("out-review");

  if (!planArg) {
    throw new Error("[audit-alias-plan-risk] --plan is required");
  }
  if (!outGateArg) {
    throw new Error("[audit-alias-plan-risk] --out-gate is required");
  }
  if (!outReviewArg) {
    throw new Error("[audit-alias-plan-risk] --out-review is required");
  }

  const planPath = path.resolve(planArg);
  const outGatePath = path.resolve(outGateArg);
  const outReviewPath = path.resolve(outReviewArg);

  const raw = await readFile(planPath, "utf8");
  const plan = JSON.parse(raw) as PlanPayload;
  const aliases = Array.isArray(plan.aliases) ? plan.aliases : [];

  const riskyRows: RiskyRow[] = [];
  for (const alias of aliases) {
    const occurrence = toOccurrence(alias.occurrence);
    if (occurrence !== 1) continue;

    const ingredientId = typeof alias.ingredient_id === "string" ? alias.ingredient_id.trim() : "";
    const aliasNorm = typeof alias.alias_norm === "string" ? alias.alias_norm.trim() : "";
    const formKey = typeof alias.form_key === "string" ? alias.form_key.trim() : "";
    if (!ingredientId || !aliasNorm || !formKey) continue;

    const riskReasons = classifyRiskReasons(aliasNorm);
    if (!riskReasons.length) continue;

    riskyRows.push({
      ingredient_id: ingredientId,
      alias_norm: aliasNorm,
      alias_norm_basic: normalizeText(aliasNorm),
      alias_norm_denoised: denoiseAliasNorm(aliasNorm),
      form_key: formKey,
      source_ids: normalizeSourceIds(alias.source_ids),
      occurrence,
      riskReasons,
    });
  }

  riskyRows.sort((a, b) => {
    if (a.ingredient_id !== b.ingredient_id) {
      return a.ingredient_id.localeCompare(b.ingredient_id);
    }
    if (a.alias_norm_denoised !== b.alias_norm_denoised) {
      return a.alias_norm_denoised.localeCompare(b.alias_norm_denoised);
    }
    return a.form_key.localeCompare(b.form_key);
  });

  const fingerprint = buildFingerprint(riskyRows);
  const reviewPayload = {
    generatedAt: new Date().toISOString(),
    plan: planPath,
    riskySingletonCount: riskyRows.length,
    fingerprint,
    risky: riskyRows,
  };

  const gatePayload: GatePayload = {
    generatedAt: reviewPayload.generatedAt,
    plan: planPath,
    pass: riskyRows.length === 0,
    riskySingletonCount: riskyRows.length,
    fingerprint,
    denylist: [...RISK_TOKEN_DENYLIST, ...GENERIC_SINGLETON_DENYLIST, "vitamin", "short_singleton_token"],
    examples: riskyRows.slice(0, 50).map((row) => ({
      ingredient_id: row.ingredient_id,
      alias_norm: row.alias_norm,
      form_key: row.form_key,
      occurrence: row.occurrence,
      source_ids: row.source_ids,
      riskReasons: row.riskReasons,
    })),
  };

  await writeJson(outReviewPath, reviewPayload);
  await writeJson(outGatePath, gatePayload);

  console.log(
    JSON.stringify(
      {
        outGate: outGatePath,
        outReview: outReviewPath,
        pass: gatePayload.pass,
        riskySingletonCount: gatePayload.riskySingletonCount,
        fingerprint,
      },
      null,
      2,
    ),
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error(
      "[audit-alias-plan-risk] failed:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
