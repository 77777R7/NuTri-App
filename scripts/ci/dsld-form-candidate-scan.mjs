#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lookupKbFormExplain } from "../../backend/dist/kbRuntime.js";

// Ensure KB paths resolve regardless of the runner cwd.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_KB_DIR = path.join(REPO_ROOT, "backend", "data", "kb");
process.env.KB_RUNTIME_INDEX_PATH =
  process.env.KB_RUNTIME_INDEX_PATH || path.join(DEFAULT_KB_DIR, "kb_runtime_index.json");
process.env.KB_FORM_ALIAS_PATH = process.env.KB_FORM_ALIAS_PATH || path.join(DEFAULT_KB_DIR, "form_alias_map.json");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_READONLY_KEY || process.env.SUPABASE_ANON_KEY;
const SUPABASE_KEY_KIND = process.env.SUPABASE_READONLY_KEY
  ? "readonly"
  : process.env.SUPABASE_ANON_KEY
    ? "anon"
    : "missing";

const DSLD_CANDIDATE_VIEW = process.env.DSLD_CANDIDATE_VIEW || "regression_dsld_form_candidates_v";

const OUT_DIR = process.env.DSLD_CANDIDATE_ARTIFACT_DIR || "artifacts/dsld-form-candidates";
const RUN_ID = process.env.GITHUB_RUN_ID || "local";
const RUN_ATTEMPT = process.env.GITHUB_RUN_ATTEMPT || "1";
const ARTIFACT_DIR = path.join(OUT_DIR, `${RUN_ID}-${RUN_ATTEMPT}`);

const FORM_TOKENS = (process.env.DSLD_FORM_TOKENS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const DEFAULT_TOKENS = [
  "oxide",
  "citrate",
  "glycinate",
  "bisglycinate",
  "ascorbate",
  "picolinate",
  "nicotinate",
  "sulfate",
  "chloride",
  // P1 operational scan: expand beyond the core salt forms so kb_sentence_missing/kb_excerpt_missing
  // surface in the action list and can drive a reviewable KB iteration loop.
  "gluconate",
  "carbonate",
  "malate",
  "tartrate",
  "succinate",
  "fumarate",
  "lactate",
  "acetate",
  "phosphate",
  "orotate",
  "carnosine",
  "bicarbonate",
  "hydrochloride",
  "hcl",
  "monohydrate",
  // Longer-tail forms: increase the chance of surfacing actionable gaps (kb_sentence_missing/kb_excerpt_missing)
  // without having to massively increase MAX_EVALUATE.
  "taurate",
  "aspartate",
  "threonate",
  "polynicotinate",
  "gluceptate",
  "selenate",
  "selenite",
  "monomethionine",
];

const TOKENS = FORM_TOKENS.length ? FORM_TOKENS : DEFAULT_TOKENS;
const MAX_LABELS_PER_TOKEN = Number(process.env.DSLD_SCAN_MAX_LABELS_PER_TOKEN || 200);
const MAX_EVALUATE = Number(process.env.DSLD_SCAN_MAX_EVALUATE || 250);
const MAX_ACTIVES = Number(process.env.DSLD_SCAN_MAX_ACTIVES || 15);
const REQUIRE_EXPLICIT = (process.env.DSLD_SCAN_REQUIRE_EXPLICIT || "1") !== "0";
// Query strategy:
// - per_token: query the view once per token (can be slow/timeout on large datasets without DB indexes)
// - sample: fetch a fixed sample and stratify locally (preferred for CI stability)
// - hybrid: per_token with sample fallback on token failures (recommended)
const META_QUERY_MODE = String(process.env.DSLD_SCAN_META_QUERY_MODE || "hybrid").toLowerCase();
const META_SAMPLE_SIZE = Number(process.env.DSLD_SCAN_META_SAMPLE_SIZE || Math.max(2000, MAX_EVALUATE * 10));
// Keep the per-token sample target feasible when TOKENS expands; prefer coverage over depth.
const MIN_PER_TOKEN = Number(process.env.DSLD_SCAN_MIN_PER_TOKEN || 5);
const OUTPUT_LIMIT = Number(process.env.DSLD_SCAN_OUTPUT_LIMIT || 80);

const INGREDIENT_ALLOWLIST = [
  "calcium",
  "magnesium",
  "zinc",
  "iron",
  "ferrous",
  "ferric",
  "copper",
  "selenium",
  "iodine",
  "chromium",
  "manganese",
  "molybdenum",
  "potassium",
  "vitamin",
  "folate",
  "folic",
  "niacin",
  "riboflavin",
  "thiamin",
  "omega",
  "epa",
  "dha",
  "creatine",
  "coq10",
  "carnitine",
];

const REVERSE_FORM_BLACKLIST = ["dioxide", "peroxide", "antioxidant", "oxidative"];
const SULFATE_CHLORIDE_TOKENS = new Set(["sulfate", "chloride"]);

const guessIngredientForNoise = (value) => {
  const cleaned = normalizeFreeText(stripAmountSuffix(value))
    .replace(/^(as|from)\s+/i, "")
    .replace(/^[^a-z0-9]+/i, "")
    .trim();
  if (!cleaned) return "unknown";
  const first = cleaned.split(/\s+/)[0] || "unknown";
  return first.replace(/[^a-z0-9]+/g, "");
};

const buildHeaders = () => ({
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
});

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const normalizeText = (value) => String(value ?? "").toLowerCase();

const normalizeFreeText = (value) => String(value ?? "").toLowerCase().trim();

const stripAmountSuffix = (value) =>
  String(value ?? "")
    .replace(/\s+\d+(?:\.\d+)?\s*(?:mcg|ug|mg|g|iu|ml|%)(?:\b|\/|\s).*$/i, "")
    .trim();

const countActivesApprox = (summary) => {
  const s = String(summary ?? "").trim();
  if (!s) return 0;
  // Heuristic: meta summaries usually use semicolons or newlines.
  const parts = s.split(/;|\n/g).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.length;
  // Fallback: count commas, but avoid commas in numbers.
  const commaParts = s.split(",").map((p) => p.trim()).filter(Boolean);
  return commaParts.length;
};

const splitActivesSummary = (summary) => {
  const s = String(summary ?? "").trim();
  if (!s) return [];
  // Many DSLD meta summaries are semicolon-separated; newlines also show up.
  return s
    .split(/;|\n/g)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 80);
};

const tokenRegex = (token) => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i");

const hasAllowlistedIngredient = (text) => {
  const lower = normalizeText(text);
  return INGREDIENT_ALLOWLIST.some((tok) => lower.includes(tok));
};

const hasBlacklistToken = (value) => {
  const lower = normalizeText(value);
  return REVERSE_FORM_BLACKLIST.some((tok) => lower.includes(tok));
};

const hasExplicitTokenEvidence = (text, token) => {
  const s = normalizeText(text);
  const safeToken = token.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
  if (!s.includes("as")) return false;
  // Parenthetical: (as ... token ...)
  const parenthetical = new RegExp(`\\(as[^)]*\\b${safeToken}\\b[^)]*\\)`, "i");
  if (parenthetical.test(s)) return true;
  // Phrase: "as ... token ..."
  const asPhrase = new RegExp(`\\bas[^,;]*\\b${safeToken}\\b[^,;]*(?:,|;|$)`, "i");
  if (asPhrase.test(s)) return true;
  // Phrase: "from ... token ..."
  const fromPhrase = new RegExp(`\\bfrom[^,;]*\\b${safeToken}\\b[^,;]*(?:,|;|$)`, "i");
  return fromPhrase.test(s);
};

const detectEvidenceKind = (text) => {
  const lower = normalizeText(text);
  if (/\(as\s+[^)]+\)/i.test(lower)) return "label_parenthetical";
  if (/\bas\s+[^,;]+(?:,|;|$)/i.test(lower)) return "label_as_phrase";
  if (/\bfrom\s+[^,;]+(?:,|;|$)/i.test(lower)) return "label_from_phrase";
  return "salt_name";
};

const getFirstWordToken = (text) => {
  const cleaned = normalizeFreeText(stripAmountSuffix(text)).replace(/^(as|from)\s+/i, "").trim();
  const m = cleaned.match(/^([a-z0-9]+)/i);
  return m?.[1]?.toLowerCase() ?? null;
};

// "salt_name" evidence is only considered strong when the chunk looks like a real salt-form label,
// e.g. "Zinc Citrate", "Creatine Citrate", "Ferrous Bisglycinate". This avoids false positives from
// generic token presence elsewhere in the text.
const hasStrongSaltNameStructure = ({ chunk, ingredientKey, token }) => {
  if (!ingredientKey || !token) return false;
  const first = getFirstWordToken(chunk);
  if (!first) return false;
  // "monohydrate" is highly ambiguous in DSLD meta (e.g. HMB monohydrate, pyridoxal-5-phosphate monohydrate).
  // For CI candidate scanning we only treat it as a relevant form token when it is explicitly a creatine label head
  // (keeps the action list actionable and avoids noise buckets dominating coverage stats).
  if (token === "monohydrate" && first !== "creatine") return false;
  // Use the allowlist on the raw label head token rather than ingredientKey; ingredientKey can be a
  // normalized scope (e.g. vitamin_c) that doesn't appear verbatim in the label text.
  if (!INGREDIENT_ALLOWLIST.includes(first)) return false;
  if (!tokenRegex(token).test(chunk)) return false;

  const safeFirst = first.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
  const safeToken = token.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
  const strong = new RegExp(`^\\s*${safeFirst}\\b[^,;]*\\b${safeToken}\\b`, "i");
  return strong.test(chunk);
};

const isVitaminCChemicalFormName = (value) => {
  const cleaned = normalizeFreeText(value);
  return /\bascorbic\b/.test(cleaned) || /\bascorbate\b/.test(cleaned) || /\bester[-_ ]?c\b/.test(cleaned);
};

const canonicalizeFormTokenForLookup = ({ token, ingredientKey, evidenceText }) => {
  const t = String(token || "").toLowerCase();
  const ig = String(ingredientKey || "").toLowerCase();
  const ex = normalizeText(evidenceText);

  // Keep these canonicalizations extremely narrow and evidence-based so we don't create
  // "fake hits" that paper over real KB gaps.
  if (ig === "creatine" && t === "hydrochloride") return "hcl";

  if (ig === "iron" && t === "fumarate") return "ferrous_fumarate";

  // Riboflavin "phosphate" in DSLD labels commonly refers to FMN (riboflavin-5'-phosphate).
  // Keep this canonicalization narrow: only within riboflavin scope and only when the evidence
  // phrase actually contains "riboflavin" (avoid cross-ingredient phosphate noise).
  if (ig === "riboflavin" && t === "phosphate" && ex.includes("riboflavin")) return "riboflavin_5_phosphate";

  // Vitamin E acetate: labels may say "Vitamin E Acetate" or "alpha-tocopheryl acetate" (sometimes without the
  // explicit "tocopheryl" word). Canonicalize to tocopheryl acetate runtime keys so the scan classifies gaps
  // against the right KB entries (and avoids "no_runtime_entry" false gaps).
  const hasVitEAcetateEvidence =
    ig === "vitamin_e" &&
    t === "acetate" &&
    ex.includes("acetate") &&
    (ex.includes("vitamin e") || ex.includes("tocoph") || ex.includes("tocopher"));
  if (hasVitEAcetateEvidence) {
    if (ex.includes("d-alpha")) return "d_alpha_tocopheryl_acetate";
    if (ex.includes("dl-alpha")) return "dl_alpha_tocopheryl_acetate";
    return "dl_alpha_tocopheryl_acetate";
  }

  if (ig === "vitamin_c" && t === "ascorbate") {
    if (ex.includes("calcium ascorbate")) return "calcium_ascorbate";
    if (ex.includes("sodium ascorbate")) return "sodium_ascorbate";
    if (ex.includes("magnesium ascorbate")) return "magnesium_ascorbate";
    if (ex.includes("ester-c") || ex.includes("ester c")) return "ester_c";
  }

  // Magnesium L-threonate is often written as "Magnesium L-Threonate". Normalize the token so
  // runtime lookups hit the shipped KB key (magnesium|l_threonate).
  if (ig === "magnesium" && t === "threonate" && ex.includes("threonate")) return "l_threonate";

  // Vitamin A palmitate is commonly listed as retinyl palmitate. Normalize to the shipped KB key.
  if (ig === "vitamin_a" && t === "palmitate" && ex.includes("palmitate")) return "retinyl_palmitate";

  // Vitamin A acetate is commonly listed as retinyl acetate. Normalize to the shipped KB key.
  if (ig === "vitamin_a" && t === "acetate" && ex.includes("acetate")) return "retinyl_acetate";

  return null;
};

const expandTokensForLookup = ({ tokensMatched, ingredientKey, evidenceText }) => {
  const out = [];
  for (const tok of tokensMatched || []) {
    const canon = canonicalizeFormTokenForLookup({ token: tok, ingredientKey, evidenceText });
    if (canon && !out.includes(canon)) out.push(canon);
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
};

const normalizeIngredientKey = (text) => {
  const cleaned = stripAmountSuffix(String(text ?? "")).replace(/^(as|from)\s+/i, "").trim();
  const s = normalizeFreeText(cleaned);
  if (!s) return null;

  // Prefer vitamin C scope when the label explicitly indicates vitamin C forms (ascorbic/ascorbate/Ester-C).
  if (isVitaminCChemicalFormName(s)) return "vitamin_c";

  if (s.startsWith("vitamin")) {
    const parts = s.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const second = parts[1];
      const m = second.match(/^([a-z])(\d+)?$/i);
      if (m) {
        const letter = m[1].toLowerCase();
        const num = m[2] ?? "";
        if (letter === "c") return "vitamin_c";
        if (letter === "d") return "vitamin_d";
        if (letter === "e") return "vitamin_e";
        if (letter === "a") return "vitamin_a";
        if (letter === "k") return num === "2" ? "vitamin_k2" : "vitamin_k1";
        if (letter === "b") return `vitamin_b${num || ""}`.replace(/_+$/g, "");
        return `vitamin_${letter}${num}`;
      }
    }
    return "vitamin";
  }

  const words = s.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? null;
  if (!first) return null;
  // Common iron label forms:
  // - "Ferrous bisglycinate" (DSLD meta)
  // - "Ferric citrate" (less common, but same base nutrient)
  if (first === "ferrous" || first === "ferric") return "iron";
  if (INGREDIENT_ALLOWLIST.includes(first)) return first;
  return null;
};

const scoreMetaRow = (row) => {
  const summary = String(row?.active_ingredients_summary ?? "");
  const s = normalizeText(summary);
  let score = 0;

  // Prefer explicit evidence cues so the KB-positive path is testable.
  if (/\(as\s+[^)]+\)/i.test(s)) score += 10;
  if (/\bas\s+[^,;]+/i.test(s)) score += 6;
  if (/\bfrom\s+[^,;]+/i.test(s)) score += 6;

  // Prefer rows that contain any token as a whole word (avoid substring noise like "sesquioxide").
  const tokenWordHits = TOKENS.reduce((acc, t) => acc + (tokenRegex(t).test(s) ? 1 : 0), 0);
  score += tokenWordHits * 3;

  // Prefer rows mentioning allowlisted nutrient families.
  if (hasAllowlistedIngredient(s)) score += 2;

  // Prefer moderate-sized products; penalize very small/very large.
  const approx = countActivesApprox(summary);
  if (approx >= 5 && approx <= 15) score += 2;
  if (approx > 20) score -= 2;

  return score;
};

async function fetchMetaCandidatesForToken(token, opts = {}) {
  const limit = Number(opts.limit || MAX_LABELS_PER_TOKEN);
  const url = new URL(`${SUPABASE_URL}/rest/v1/${DSLD_CANDIDATE_VIEW}`);
  url.searchParams.set(
    "select",
    [
      "dsld_label_id",
      "barcode_normalized_gtin14",
      "dsld_product_version_code",
      "active_ingredients_summary",
    ].join(","),
  );
  url.searchParams.set("active_ingredients_summary", `ilike.*${token}*`);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), { headers: buildHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`meta query failed token=${token} status=${res.status} body=${body.slice(0, 200)}`);
  }
  return await res.json();
}

async function fetchMetaCandidatesSample(limit) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${DSLD_CANDIDATE_VIEW}`);
  url.searchParams.set(
    "select",
    [
      "dsld_label_id",
      "barcode_normalized_gtin14",
      "dsld_product_version_code",
      "active_ingredients_summary",
    ].join(","),
  );
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), { headers: buildHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`meta sample query failed limit=${limit} status=${res.status} body=${body.slice(0, 200)}`);
  }
  return await res.json();
}

function scoreCandidate(candidate) {
  const activesCount = candidate.activesCount ?? 0;
  const kbHits = candidate.kbSentenceHitCount ?? 0;
  const tokenHits = candidate.matchedActives?.length ?? 0;
  const countScore = activesCount >= 5 && activesCount <= 15 ? 3 : activesCount <= 20 ? 1 : 0;
  return kbHits * 10 + tokenHits * 2 + countScore;
}

function toCsvRow(candidate) {
  const kbHitNames = (candidate.kbSentenceHitNames ?? []).slice(0, 5).join(" | ");
  const matched = (candidate.matchedActives ?? [])
    .slice(0, 6)
    .map((m) => `${m.name} [${m.tokens.join("+")}]`)
    .join(" | ");
  const gapTypes = unique((candidate.matchedActives ?? []).map((m) => m.gapType).filter(Boolean)).join("+");
  return {
    barcode_gtin14: candidate.barcodeGtin14 ?? "",
    dsld_label_id: candidate.dsldLabelId ?? "",
    dsld_product_version_code: candidate.dsldProductVersionCode ?? "",
    actives_count: candidate.activesCount ?? "",
    evidence_kinds: (candidate.evidenceKinds ?? []).join("+"),
    kb_sentence_hit_count: candidate.kbSentenceHitCount ?? 0,
    kb_sentence_hit_names: kbHitNames,
    matched_actives: matched,
    gap_types: gapTypes,
    active_ingredients_summary: String(candidate.activeIngredientsSummary ?? "").replace(/\s+/g, " ").trim(),
    score: candidate.score ?? 0,
  };
}

const unique = (arr) => [...new Set(arr)];

const selectStratified = (rows, { kind }) => {
  const selected = [];
  const selectedIds = new Set();
  const perTokenSelected = Object.fromEntries(TOKENS.map((t) => [t, 0]));

  for (const token of TOKENS) {
    const subset = rows
      .filter((r) => (r.tokenMatchCounts?.[token] ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    for (const row of subset) {
      const id = String(row.dsldLabelId ?? "");
      if (!id) continue;
      if (selected.length >= OUTPUT_LIMIT) break;
      if (perTokenSelected[token] >= MIN_PER_TOKEN) break;
      if (selectedIds.has(id)) continue;
      selected.push(row);
      selectedIds.add(id);
      perTokenSelected[token] += 1;
    }
  }

  // Fill remaining slots with best-scoring rows.
  const remainder = rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const row of remainder) {
    if (selected.length >= OUTPUT_LIMIT) break;
    const id = String(row.dsldLabelId ?? "");
    if (!id || selectedIds.has(id)) continue;
    selected.push(row);
    selectedIds.add(id);
  }

  const stratifiedCounts = Object.fromEntries(
    TOKENS.map((t) => [t, selected.filter((r) => (r.tokenMatchCounts?.[t] ?? 0) > 0).length]),
  );

  return { selected, stratifiedCounts, kind };
};

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_READONLY_KEY/SUPABASE_ANON_KEY");
    process.exit(1);
  }

  await ensureDir(ARTIFACT_DIR);
  console.log(
    `[dsld-scan] tokens=${TOKENS.join(",")} view=${DSLD_CANDIDATE_VIEW} auth=${SUPABASE_KEY_KIND} mode=${META_QUERY_MODE} out=${ARTIFACT_DIR}`,
  );

  const metaRows = [];
  const metaQueryErrors = [];
  if (META_QUERY_MODE === "per_token" || META_QUERY_MODE === "hybrid") {
    let hadFailure = false;
    for (const token of TOKENS) {
      // eslint-disable-next-line no-await-in-loop
      try {
        // Retry once on statement timeout with a smaller limit. This keeps the job operational
        // under transient PostgREST/db load while still surfacing actionable gaps.
        let rows = [];
        try {
          rows = await fetchMetaCandidatesForToken(token, { limit: MAX_LABELS_PER_TOKEN });
        } catch (err) {
          const msg = String(err?.message ?? err ?? "unknown_error");
          const isTimeout = msg.includes("statement timeout") || msg.includes("\"57014\"");
          if (isTimeout && MAX_LABELS_PER_TOKEN > 400) {
            rows = await fetchMetaCandidatesForToken(token, { limit: 400 });
          } else {
            throw err;
          }
        }
        console.log(`[dsld-scan] token=${token} meta_rows=${rows.length}`);
        metaRows.push(...rows);
      } catch (err) {
        // Operationally: don't fail the entire scan on one token timeout; record and continue.
        const msg = String(err?.message ?? err ?? "unknown_error");
        console.warn(`[dsld-scan] warn: ${msg}`);
        metaQueryErrors.push({ mode: "per_token", token, error: msg });
        hadFailure = true;
      }
    }
    if (META_QUERY_MODE === "hybrid" && hadFailure) {
      try {
        const rows = await fetchMetaCandidatesSample(META_SAMPLE_SIZE);
        console.log(`[dsld-scan] meta_sample_rows=${rows.length} (limit=${META_SAMPLE_SIZE})`);
        metaRows.push(...rows);
      } catch (err) {
        const msg = String(err?.message ?? err ?? "unknown_error");
        console.warn(`[dsld-scan] warn: meta sample fallback failed: ${msg}`);
        metaQueryErrors.push({ mode: "sample_fallback", token: null, error: msg });
      }
    }
  } else if (META_QUERY_MODE === "sample") {
    try {
      const rows = await fetchMetaCandidatesSample(META_SAMPLE_SIZE);
      console.log(`[dsld-scan] meta_sample_rows=${rows.length} (limit=${META_SAMPLE_SIZE})`);
      metaRows.push(...rows);
    } catch (err) {
      const msg = String(err?.message ?? err ?? "unknown_error");
      console.error(`[dsld-scan] fatal: ${msg}`);
      process.exit(1);
    }
  } else {
    console.error(`Invalid DSLD_SCAN_META_QUERY_MODE=${META_QUERY_MODE} (expected per_token|sample|hybrid)`);
    process.exit(1);
  }

  if (!metaRows.length) {
    console.error("[dsld-scan] fatal: no meta rows fetched (check SUPABASE_* secrets and view performance)");
    await fs.writeFile(path.join(ARTIFACT_DIR, "meta_query_errors.json"), JSON.stringify(metaQueryErrors, null, 2));
    process.exit(1);
  }

  // Deduplicate by label_id; keep first row.
  const byId = new Map();
  for (const row of metaRows) {
    const id = String(row?.dsld_label_id ?? "").trim();
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, row);
  }

  const deduped = [...byId.values()].filter((r) => r?.barcode_normalized_gtin14);
  const filtered = deduped
    .filter((r) => countActivesApprox(r.active_ingredients_summary) <= MAX_ACTIVES)
    .filter((r) => (hasAllowlistedIngredient(r.active_ingredients_summary) ? true : false));

  const ranked = [...filtered].sort((a, b) => scoreMetaRow(b) - scoreMetaRow(a));
  await fs.writeFile(path.join(ARTIFACT_DIR, "candidates_meta_raw.json"), JSON.stringify(ranked, null, 2));

  const enriched = [];
  const sulfateChlorideNoise = [];
  const explicitEvidenceKinds = new Set(["label_parenthetical", "label_as_phrase", "label_from_phrase", "salt_name"]);
  const runtimeIndexPath = process.env.KB_RUNTIME_INDEX_PATH;
  const runtimeRaw = runtimeIndexPath ? await fs.readFile(runtimeIndexPath, "utf-8") : null;
  const runtimeJson = runtimeRaw ? JSON.parse(runtimeRaw.replace(/\bNaN\b/g, "null")) : null;
  const ingredientFormIndex = runtimeJson?.ingredient_form_index ?? {};
  const runtimeSourcePath =
    process.env.KB_RUNTIME_SOURCE_PATH || path.join("kb", "source", "kb_runtime_index.source.json");
  const sourceRaw = await fs.readFile(runtimeSourcePath, "utf-8").catch(() => null);
  const sourceJson = sourceRaw ? JSON.parse(sourceRaw.replace(/\bNaN\b/g, "null")) : null;
  const sourceIngredientFormIndex = sourceJson?.ingredient_form_index ?? {};

  const resolveRuntimeEntry = ({ ingredientKey, token }) => {
    if (!ingredientKey || !token) return { entry: null, runtimeKey: null };
    const candidates = [
      `${ingredientKey}|${token}`,
      // Some salt forms are scoped by ingredient in the KB (e.g. potassium_chloride).
      `${ingredientKey}|${ingredientKey}_${token}`,
    ];
    for (const k of candidates) {
      const entry = ingredientFormIndex[k];
      if (entry) return { entry, runtimeKey: k };
    }
    return { entry: null, runtimeKey: null };
  };

  const resolveSourceEntry = ({ ingredientKey, token }) => {
    if (!ingredientKey || !token) return { entry: null, runtimeKey: null };
    const candidates = [
      `${ingredientKey}|${token}`,
      // Some salt forms are scoped by ingredient in the KB (e.g. potassium_chloride).
      `${ingredientKey}|${ingredientKey}_${token}`,
    ];
    for (const k of candidates) {
      const entry = sourceIngredientFormIndex[k];
      if (entry) return { entry, runtimeKey: k };
    }
    return { entry: null, runtimeKey: null };
  };

  const classifyGapType = ({ ingredientKey, token }) => {
    if (!ingredientKey) return { gapType: "ingredient_unresolved", gapDetail: null };
    if (!token) return { gapType: "form_unresolved", gapDetail: null };
    const { entry, runtimeKey } = resolveRuntimeEntry({ ingredientKey, token });
    if (!entry) {
      // Operational detail: distinguish "truly missing KB runtime entry" from
      // "draft exists in source but filtered out of production" (needs_capture / needs_edit).
      const { entry: sourceEntry, runtimeKey: sourceKey } = resolveSourceEntry({ ingredientKey, token });
      if (!sourceEntry) return { gapType: "kb_sentence_missing", gapDetail: "no_runtime_entry" };

      const segments = sourceEntry?.segments ?? null;
      if (!segments || typeof segments !== "object" || Object.keys(segments).length === 0) {
        return { gapType: "kb_sentence_missing", gapDetail: `draft_missing_segments:${sourceKey ?? "unknown_key"}` };
      }

      const sentences = [];
      for (const seg of Object.values(segments)) {
        const en = seg?.en;
        if (Array.isArray(en)) sentences.push(...en);
      }
      if (!sentences.length) {
        return { gapType: "kb_sentence_missing", gapDetail: `draft_empty_segments:${sourceKey ?? "unknown_key"}` };
      }

      const needsCapture = sentences.some((s) => String(s?.evidence_excerpt_status || "") !== "captured");
      const needsReview = sentences.some((s) => String(s?.review_status || "") !== "approved");

      if (needsCapture && needsReview) {
        return {
          gapType: "kb_excerpt_missing",
          gapDetail: `draft_needs_capture_and_review:${sourceKey ?? "unknown_key"}`,
        };
      }
      if (needsCapture) {
        return { gapType: "kb_excerpt_missing", gapDetail: `draft_needs_capture:${sourceKey ?? "unknown_key"}` };
      }
      if (needsReview) {
        return { gapType: "kb_sentence_missing", gapDetail: `draft_needs_review:${sourceKey ?? "unknown_key"}` };
      }

      // Source appears ready but production is missing it. This is likely a build/filter issue.
      return {
        gapType: "kb_sentence_missing",
        gapDetail: `production_missing_but_source_ready:${sourceKey ?? "unknown_key"}`,
      };
    }
    const segments = entry?.segments ?? null;
    if (!segments || typeof segments !== "object" || Object.keys(segments).length === 0) {
      // Runtime entry exists but has no shipped segments. This often means the source has draft
      // segments that were filtered out (needs_review / needs_capture). Consult the source entry
      // so the action list stays actionable (avoid mislabeling review gaps as excerpt gaps).
      const { entry: sourceEntry, runtimeKey: sourceKey } = resolveSourceEntry({ ingredientKey, token });
      if (sourceEntry) {
        const sourceSegments = sourceEntry?.segments ?? null;
        if (!sourceSegments || typeof sourceSegments !== "object" || Object.keys(sourceSegments).length === 0) {
          return { gapType: "kb_sentence_missing", gapDetail: `draft_missing_segments:${sourceKey ?? runtimeKey ?? "unknown_key"}` };
        }
        const sentences = [];
        for (const seg of Object.values(sourceSegments)) {
          const en = seg?.en;
          if (Array.isArray(en)) sentences.push(...en);
        }
        if (!sentences.length) {
          return { gapType: "kb_sentence_missing", gapDetail: `draft_empty_segments:${sourceKey ?? runtimeKey ?? "unknown_key"}` };
        }
        const needsCapture = sentences.some((s) => String(s?.evidence_excerpt_status || "") !== "captured");
        const needsReview = sentences.some((s) => String(s?.review_status || "") !== "approved");
        if (needsCapture && needsReview) {
          return {
            gapType: "kb_excerpt_missing",
            gapDetail: `draft_needs_capture_and_review:${sourceKey ?? runtimeKey ?? "unknown_key"}`,
          };
        }
        if (needsCapture) {
          return { gapType: "kb_excerpt_missing", gapDetail: `draft_needs_capture:${sourceKey ?? runtimeKey ?? "unknown_key"}` };
        }
        if (needsReview) {
          return { gapType: "kb_sentence_missing", gapDetail: `draft_needs_review:${sourceKey ?? runtimeKey ?? "unknown_key"}` };
        }
        return {
          gapType: "kb_sentence_missing",
          gapDetail: `production_missing_but_source_ready:${sourceKey ?? runtimeKey ?? "unknown_key"}`,
        };
      }

      // Fallback: treat as evidence gap if we have refs, otherwise sentence gap.
      const refs = entry?.reference_ids;
      if (Array.isArray(refs) && refs.length > 0) {
        return { gapType: "kb_excerpt_missing", gapDetail: `segments_missing:${runtimeKey ?? "unknown_key"}` };
      }
      return { gapType: "kb_sentence_missing", gapDetail: `missing_segments:${runtimeKey ?? "unknown_key"}` };
    }
    const sentences = [];
    for (const seg of Object.values(segments)) {
      const en = seg?.en;
      if (Array.isArray(en)) sentences.push(...en);
    }
    if (!sentences.length) return { gapType: "kb_sentence_missing", gapDetail: "empty_segments" };
    const missingEvidence = sentences.some((s) => !s?.evidence_reference_id || !s?.evidence_snippet_id);
    if (missingEvidence) return { gapType: "kb_excerpt_missing", gapDetail: "missing_evidence_ids" };
    // If runtime entry exists (and has sentences with evidence IDs) but we still didn't hit,
    // the gap is usually parsing/alias mismatch, not missing KB content.
    return { gapType: "form_unresolved", gapDetail: "runtime_entry_present" };
  };

  const evaluate = ranked.slice(0, MAX_EVALUATE);
  console.log(`[dsld-scan] deduped=${deduped.length} filtered=${filtered.length} ranked=${ranked.length} eval=${evaluate.length}`);

  for (const meta of evaluate) {
    const summary = String(meta?.active_ingredients_summary ?? "");
    const chunks = splitActivesSummary(summary);
    if (!chunks.length) continue;

    const matchedActives = [];
    const evidenceKinds = new Set();
    const tokenMatchCounts = Object.fromEntries(TOKENS.map((t) => [t, 0]));
    const kbSentenceHitNames = [];

    for (const chunk of chunks) {
      const lower = normalizeText(chunk);
      if (!hasAllowlistedIngredient(lower)) continue;
      if (hasBlacklistToken(lower)) continue;

      const tokensMatched = TOKENS.filter((t) => tokenRegex(t).test(lower));
      if (!tokensMatched.length) continue;

      const evidenceKind = detectEvidenceKind(chunk);
      evidenceKinds.add(evidenceKind);

      // KB runtime expects a stable ingredient string without trailing amounts/units; otherwise
      // reverse-token parsing can include the dose (e.g. "as calcium ascorbate 125 mg") and miss.
      const kbLookupName = stripAmountSuffix(chunk);
      const ingredientKey = normalizeIngredientKey(kbLookupName) ?? normalizeIngredientKey(chunk) ?? null;

      // Noise guard: non-creatine "monohydrate" hits are frequently ingredients like calcium HMB monohydrate.
      // Exclude these from the actionable lists/stats so we don't chase fake salt-form gaps.
      if (
        ingredientKey &&
        ingredientKey !== "creatine" &&
        tokensMatched.includes("monohydrate") &&
        (
          normalizeText(kbLookupName).includes("hydroxymethylbutyrate") ||
          normalizeText(kbLookupName).includes("hydroxymethylbutrate") ||
          normalizeText(kbLookupName).includes("hmb")
        )
      ) {
        continue;
      }

      if (REQUIRE_EXPLICIT) {
        if (!explicitEvidenceKinds.has(evidenceKind)) continue;
        // Two-stage evidence parsing:
        // - label_parenthetical/as/from must contain an explicit token within the evidence phrase
        // - salt_name accepts only the strong "{ingredient} {token}" structure (word-boundary token + allowlist + blacklist already applied)
        const hasStrong =
          evidenceKind === "salt_name"
            ? tokensMatched.some((t) => hasStrongSaltNameStructure({ chunk: kbLookupName, ingredientKey, token: t }))
            : tokensMatched.some((t) => hasExplicitTokenEvidence(chunk, t));
        if (!hasStrong) continue;
      }

      const hasSulfateChloride = tokensMatched.some((t) => SULFATE_CHLORIDE_TOKENS.has(t));
      if (hasSulfateChloride && !ingredientKey) {
        // P1: sulfate/chloride in DSLD meta is often dominated by non-salt "ingredients" like glucosamine sulfate.
        // Capture as noise for triage but exclude from KB hit-rate metrics and regression candidate selection.
        sulfateChlorideNoise.push({
          barcodeGtin14: meta?.barcode_normalized_gtin14 ?? null,
          dsldLabelId: meta?.dsld_label_id ?? null,
          dsldProductVersionCode: meta?.dsld_product_version_code ?? null,
          raw: chunk,
          name: kbLookupName,
          tokens: tokensMatched.filter((t) => SULFATE_CHLORIDE_TOKENS.has(t)),
          evidenceKind,
          ingredientGuess: guessIngredientForNoise(kbLookupName),
        });
        continue;
      }

      for (const t of tokensMatched) tokenMatchCounts[t] += 1;

      const tokensForLookup = expandTokensForLookup({
        tokensMatched,
        ingredientKey,
        evidenceText: kbLookupName,
      });
      const tokenWithRuntime = tokensForLookup.find((t) => resolveRuntimeEntry({ ingredientKey, token: t }).entry);
      const orderedTokens = [
        ...(tokenWithRuntime ? [tokenWithRuntime] : []),
        ...tokensForLookup.filter((t) => t !== tokenWithRuntime),
      ];

      const kbLookupForToken = (token) =>
        lookupKbFormExplain({
          ingredientName: kbLookupName,
          ingredientId: ingredientKey,
          chemicalForm: token,
          // Candidate scan is explicitly looking for labels that disclose the form token.
          chemicalFormConfidence: 1,
          chemicalFormSource:
            evidenceKind === "label_parenthetical" || evidenceKind === "label_as_phrase" || evidenceKind === "label_from_phrase"
              ? evidenceKind
              : "reverse_name_parse",
          chemicalFormEvidence: chunk,
        });

      let kb = null;
      let kbHitToken = null;
      for (const t of orderedTokens) {
        const candidate = kbLookupForToken(t);
        if (candidate?.sentenceId && candidate?.sentence) {
          kb = candidate;
          kbHitToken = t;
          break;
        }
      }
      if (!kb) kb = kbLookupForToken(orderedTokens[0] ?? tokensMatched[0] ?? null);

      const baseName = kbLookupName;
      const isKbHit = Boolean(kb?.sentenceId && kb?.sentence);
      if (isKbHit) kbSentenceHitNames.push(baseName);
      const primaryToken = kbHitToken ?? tokenWithRuntime ?? tokensMatched[0] ?? null;
      const gap = isKbHit ? null : classifyGapType({ ingredientKey, token: primaryToken });

      matchedActives.push({
        name: baseName,
        raw: chunk,
        tokens: tokensMatched,
        evidenceKind,
        formResolveSource: kb?.resolveSource ?? "none",
        sentenceId: kb?.sentenceId ?? null,
        excerptId: kb?.excerptId ?? null,
        referenceId: kb?.referenceId ?? null,
        evidenceText: kb?.evidenceText ?? null,
        ingredientKey,
        primaryToken,
        gapType: gap?.gapType ?? null,
        gapDetail: gap?.gapDetail ?? null,
      });
    }

    if (!matchedActives.length) continue;

    const activesCount = countActivesApprox(summary);
    const row = {
      barcodeGtin14: meta?.barcode_normalized_gtin14 ?? null,
      dsldLabelId: meta?.dsld_label_id ?? null,
      dsldProductVersionCode: meta?.dsld_product_version_code ?? null,
      activesCount,
      activeIngredientsSummary: meta?.active_ingredients_summary ?? null,
      matchedActives,
      evidenceKinds: [...evidenceKinds],
      tokenMatchCounts,
      kbSentenceHitCount: kbSentenceHitNames.length,
      kbSentenceHitNames: unique(kbSentenceHitNames),
    };
    row.score = scoreCandidate(row);
    enriched.push(row);
  }

  enriched.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const hits = enriched.filter((r) => (r.kbSentenceHitCount ?? 0) > 0);
  const gaps = enriched.filter((r) => (r.kbSentenceHitCount ?? 0) === 0);

  await fs.writeFile(path.join(ARTIFACT_DIR, "candidates_enriched.json"), JSON.stringify(enriched, null, 2));
  await fs.writeFile(path.join(ARTIFACT_DIR, "candidates_kb_hits.json"), JSON.stringify(hits, null, 2));
  await fs.writeFile(path.join(ARTIFACT_DIR, "candidates_kb_gaps.json"), JSON.stringify(gaps, null, 2));
  await fs.writeFile(
    path.join(ARTIFACT_DIR, "sulfate_chloride_noise.json"),
    JSON.stringify(sulfateChlorideNoise, null, 2),
  );

  // Operational leaderboards.
  const tokenStats = Object.fromEntries(
    TOKENS.map((t) => {
      const candidatesWithToken = enriched.filter((r) => (r.tokenMatchCounts?.[t] ?? 0) > 0);
      const hitCandidates = candidatesWithToken.filter((r) => (r.kbSentenceHitCount ?? 0) > 0);
      return [
        t,
        {
          candidates: candidatesWithToken.length,
          kbHits: hitCandidates.length,
          kbGaps: candidatesWithToken.length - hitCandidates.length,
        },
      ];
    }),
  );

  const sulfateChlorideNoiseStats = (() => {
    const byIngredientGuess = {};
    const byToken = {};
    for (const row of sulfateChlorideNoise) {
      const ig = String(row.ingredientGuess || "unknown");
      byIngredientGuess[ig] = (byIngredientGuess[ig] ?? 0) + 1;
      for (const t of row.tokens || []) {
        byToken[t] = (byToken[t] ?? 0) + 1;
      }
    }
    const top = (obj, limit = 25) =>
      Object.entries(obj)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .slice(0, limit)
        .map(([k, v]) => ({ key: k, count: v }));
    return {
      total: sulfateChlorideNoise.length,
      byToken: top(byToken, 10),
      byIngredientGuess: top(byIngredientGuess, 15),
    };
  })();

  const ingredientStats = {};
  for (const row of enriched) {
    for (const active of row.matchedActives ?? []) {
      const key = normalizeIngredientKey(active.name) ?? normalizeIngredientKey(active.raw) ?? "unknown";
      if (!ingredientStats[key]) ingredientStats[key] = { matches: 0, kbHits: 0, kbGaps: 0 };
      ingredientStats[key].matches += 1;
      if (active.sentenceId && String(active.sentenceId).startsWith("s_")) ingredientStats[key].kbHits += 1;
      else ingredientStats[key].kbGaps += 1;
    }
  }

  const ingredientLeaderboard = Object.fromEntries(
    Object.entries(ingredientStats)
      .sort((a, b) => (b[1].kbGaps ?? 0) - (a[1].kbGaps ?? 0))
      .slice(0, 50),
  );

  const stratHits = selectStratified(hits, { kind: "kb_hits" });
  const stratGaps = selectStratified(gaps, { kind: "kb_gaps" });

  const gapTypeStats = {};
  const gapTypeByToken = Object.fromEntries(TOKENS.map((t) => [t, {}]));
  const kbSentenceMissingCombos = {};
  const kbExcerptMissingCombos = {};

  for (const row of enriched) {
    for (const active of row.matchedActives ?? []) {
      const gt = active.gapType;
      if (!gt) continue;
      gapTypeStats[gt] = (gapTypeStats[gt] ?? 0) + 1;
      const tok = active.primaryToken;
      if (tok && gapTypeByToken[tok]) {
        gapTypeByToken[tok][gt] = (gapTypeByToken[tok][gt] ?? 0) + 1;
      }

      const comboKey =
        active.ingredientKey && active.primaryToken ? `${active.ingredientKey}|${active.primaryToken}` : null;
      if (!comboKey) continue;
      if (gt === "kb_sentence_missing") {
        kbSentenceMissingCombos[comboKey] = (kbSentenceMissingCombos[comboKey] ?? 0) + 1;
      }
      if (gt === "kb_excerpt_missing") {
        kbExcerptMissingCombos[comboKey] = (kbExcerptMissingCombos[comboKey] ?? 0) + 1;
      }
    }
  }

  const comboTop = (obj, limit = 50) =>
    Object.entries(obj)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .slice(0, limit)
      .map(([k, v]) => {
        const [ingredientKey, formToken] = String(k).split("|");
        return { ingredientKey, formToken, count: v };
      });

  const gapReport = {
    generatedAt: new Date().toISOString(),
    view: DSLD_CANDIDATE_VIEW,
    authKind: SUPABASE_KEY_KIND,
    metaQueryMode: META_QUERY_MODE,
    metaSampleSize: META_QUERY_MODE === "sample" ? META_SAMPLE_SIZE : null,
    metaQueryErrors,
    tokens: TOKENS,
    requireExplicit: REQUIRE_EXPLICIT,
    metaCandidates: filtered.length,
    evaluatedCandidates: evaluate.length,
    enrichedCandidates: enriched.length,
    kbHitCandidates: hits.length,
    kbGapCandidates: gaps.length,
    tokenStats,
    ingredientStatsTopGaps: ingredientLeaderboard,
    gapTypeStats,
    gapTypeByToken,
    kbSentenceMissingTopCombos: comboTop(kbSentenceMissingCombos, 80),
    kbExcerptMissingTopCombos: comboTop(kbExcerptMissingCombos, 80),
    stratifiedSampling: {
      outputLimit: OUTPUT_LIMIT,
      minPerToken: MIN_PER_TOKEN,
      hitsSelected: stratHits.selected.length,
      gapsSelected: stratGaps.selected.length,
      hitsPerToken: stratHits.stratifiedCounts,
      gapsPerToken: stratGaps.stratifiedCounts,
    },
    sulfateChlorideNoiseStats,
  };
  await fs.writeFile(path.join(ARTIFACT_DIR, "kb_gap_report.json"), JSON.stringify(gapReport, null, 2));

  const writeCsv = async (filename, rows) => {
    if (!rows.length) return;
    const top = rows.map(toCsvRow);
    const header = Object.keys(top[0] ?? {});
    const csvLines = [header.join(",")];
    for (const row of top) {
      const values = header.map((key) => {
        const raw = row[key] ?? "";
        const s = String(raw).replace(/\"/g, '""');
        return `"${s}"`;
      });
      csvLines.push(values.join(","));
    }
    await fs.writeFile(path.join(ARTIFACT_DIR, filename), csvLines.join("\n") + "\n");
  };

  const writeSimpleCsv = async (filename, rows, opts = {}) => {
    const header = opts.header || Object.keys(rows[0] ?? {});
    if (!header.length) return;
    const csvLines = [header.join(",")];
    for (const row of rows) {
      const values = header.map((key) => {
        const raw = row[key] ?? "";
        const s = String(raw).replace(/\"/g, '""');
        return `"${s}"`;
      });
      csvLines.push(values.join(","));
    }
    await fs.writeFile(path.join(ARTIFACT_DIR, filename), csvLines.join("\n") + "\n");
  };

  // Workstream B: actionable sulfate/chloride triage list.
  const actionMap = new Map();
  const actionKey = (token, ingredient, gapType) => `${token}|${ingredient}|${gapType}`;
  const actionFor = (token, ingredient, gapType) => {
    if (gapType === "ingredient_unresolved") {
      return "Noise: treat as ingredient (not nutrient salt-form) or add ingredient alias; exclude from form scan stats.";
    }
    if (gapType === "kb_sentence_missing") return `Add KB sentence+excerpt for ${ingredient}+${token}.`;
    if (gapType === "kb_excerpt_missing") return `Capture excerpt/reference IDs for existing ${ingredient}+${token}.`;
    if (gapType === "form_unresolved") return `Parser/alias: improve token extraction for ${ingredient}+${token}.`;
    return "Investigate.";
  };
  const bumpAction = ({ token, ingredient, gapType, example }) => {
    const key = actionKey(token, ingredient, gapType);
    if (!actionMap.has(key)) {
      actionMap.set(key, {
        token,
        ingredient,
        gapType,
        count: 0,
        example_actives_excerpt: example,
        action: actionFor(token, ingredient, gapType),
      });
    }
    const cur = actionMap.get(key);
    cur.count += 1;
    if (!cur.example_actives_excerpt) cur.example_actives_excerpt = example;
  };

  for (const n of sulfateChlorideNoise) {
    for (const token of n.tokens || []) {
      bumpAction({
        token,
        ingredient: String(n.ingredientGuess || "unknown"),
        gapType: "ingredient_unresolved",
        example: String(n.raw || n.name || ""),
      });
    }
  }

  for (const row of enriched) {
    for (const m of row.matchedActives || []) {
      if (!m.gapType) continue;
      const token = (m.tokens || []).find((t) => SULFATE_CHLORIDE_TOKENS.has(t));
      if (!token) continue;
      bumpAction({
        token,
        ingredient: String(m.ingredientKey || "unknown"),
        gapType: String(m.gapType || "unknown"),
        example: String(m.raw || m.name || ""),
      });
    }
  }

  const actionRows = [...actionMap.values()].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  await writeSimpleCsv("sulfate_chloride_action_list.csv", actionRows, {
    header: ["token", "ingredient", "gapType", "count", "example_actives_excerpt", "action"],
  });

  // Workstream B: global actionable gap list (all tokens). This excludes sulfate/chloride noise
  // (captured separately) and focuses on fixable gaps: parser/alias vs KB sentence vs excerpt capture.
  const globalActionMap = new Map();
  const bumpGlobalAction = ({ token, ingredient, gapType, gapDetail, example }) => {
    const key = actionKey(token, ingredient, gapType);
    if (!globalActionMap.has(key)) {
      globalActionMap.set(key, {
        token,
        ingredient,
        gapType,
        triage: "",
        canonical_form_token: "",
        gap_detail: gapDetail ?? "",
        count: 0,
        example_actives_excerpt: example,
        action: actionFor(token, ingredient, gapType),
      });
    }
    const cur = globalActionMap.get(key);
    cur.count += 1;
    if (!cur.example_actives_excerpt) cur.example_actives_excerpt = example;
    if (!cur.gap_detail && gapDetail) cur.gap_detail = gapDetail;
  };

  // kb_sentence_missing triage: classify into 3 buckets so we don't blindly "add KB" when it is
  // actually a parser normalization issue or scan noise.
  const classifySentenceMissing = ({ token, ingredientKey, example }) => {
    const t = String(token || "").toLowerCase();
    const ig = String(ingredientKey || "").toLowerCase();
    const ex = String(example || "").toLowerCase();

    // Noise: "monohydrate" is almost always meaningful for creatine; non-creatine monohydrate
    // hits are frequently ingredients like calcium HMB monohydrate.
    if (t === "monohydrate" && ig && ig !== "creatine") {
      return {
        triage: "noise",
        canonicalFormToken: "",
        action: "Noise: exclude non-creatine monohydrate (often part of an ingredient name, e.g. HMB monohydrate).",
      };
    }

    // Normalization: hydrochloride is commonly abbreviated as HCl in the KB.
    if (t === "hydrochloride" && ig) {
      const { entry } = resolveRuntimeEntry({ ingredientKey: ig, token: "hcl" });
      if (entry) {
        return {
          triage: "parser_normalization",
          canonicalFormToken: "hcl",
          action: `Parser/alias: normalize hydrochloride -> hcl for ${ig} (runtime entry exists).`,
        };
      }
    }

    // Normalization: iron fumarate is usually keyed as ferrous_fumarate in the KB.
    if (ig === "iron" && t === "fumarate") {
      const { entry } = resolveRuntimeEntry({ ingredientKey: ig, token: "ferrous_fumarate" });
      if (entry) {
        return {
          triage: "parser_normalization",
          canonicalFormToken: "ferrous_fumarate",
          action: "Parser/alias: normalize fumarate -> ferrous_fumarate for iron (runtime entry exists).",
        };
      }
    }

    // Normalization: riboflavin 5-phosphate is a vitamin B2 form (often written "Riboflavin 5-Phosphate").
    if (ig === "riboflavin" && t === "phosphate" && (ex.includes("5-phosphate") || ex.includes("5 phosphate"))) {
      // Even if the KB entry is missing today, the correct fix is still "normalize to the canonical token",
      // not "add riboflavin+phosphate". This prevents wasting KB effort on a non-canonical combo.
      return {
        triage: "parser_normalization",
        canonicalFormToken: "riboflavin_5_phosphate",
        action: "Parser/alias: normalize phosphate -> riboflavin_5_phosphate for riboflavin (canonical form).",
      };
    }

    // Normalization: vitamin C ascorbate salts are keyed by the cation (calcium/sodium), not generic "ascorbate".
    if (ig === "vitamin_c" && t === "ascorbate") {
      const canon =
        ex.includes("calcium ascorbate") ? "calcium_ascorbate" :
        ex.includes("sodium ascorbate") ? "sodium_ascorbate" :
        ex.includes("magnesium ascorbate") ? "magnesium_ascorbate" :
        ex.includes("ester-c") || ex.includes("ester c") ? "ester_c" :
        "";
      if (canon) {
        const hasCanon = Boolean(resolveRuntimeEntry({ ingredientKey: ig, token: canon }).entry);
        return hasCanon
          ? {
              triage: "parser_normalization",
              canonicalFormToken: canon,
              action: `Parser/alias: normalize ascorbate -> ${canon} for vitamin_c (runtime entry exists).`,
            }
          : {
              triage: "kb_missing",
              canonicalFormToken: canon,
              action: `Add KB sentence+excerpt for vitamin_c+${canon} (canonical salt form).`,
            };
      }
    }

    // Noise-ish: calcium monohydrate is often calcium HMB monohydrate rather than a mineral salt form.
    if (
      ig === "calcium" &&
      t === "monohydrate" &&
      (ex.includes("hydroxymethylbutyrate") || ex.includes("hydroxymethylbutrate") || ex.includes("hmb"))
    ) {
      return {
        triage: "noise",
        canonicalFormToken: "",
        action: "Noise: treat calcium HMB monohydrate as an ingredient (not a calcium salt form) and exclude from scan stats.",
      };
    }

    return {
      triage: "kb_missing",
      canonicalFormToken: "",
      action: `Add KB sentence+excerpt for ${ig || "unknown"}+${t}.`,
    };
  };

  for (const row of enriched) {
    for (const m of row.matchedActives || []) {
      if (!m.gapType) continue;
      const token = String(m.primaryToken || (m.tokens || [])[0] || "");
      if (!token) continue;
      const ingredientKey = String(m.ingredientKey || "unknown");
      const gapType = String(m.gapType || "unknown");
      const example = String(m.raw || m.name || "");
      bumpGlobalAction({
        token,
        ingredient: ingredientKey,
        gapType,
        gapDetail: m.gapDetail ? String(m.gapDetail) : "",
        example,
      });

      if (gapType === "kb_sentence_missing") {
        const triage = classifySentenceMissing({ token, ingredientKey, example });
        const actionKeyStr = actionKey(token, ingredientKey, gapType);
        const cur = globalActionMap.get(actionKeyStr);
        if (cur) {
          // Multiple examples can map to the same (token, ingredient, gapType) row; keep the
          // highest-priority triage (never downgrade parser_normalization -> kb_missing).
          const priority = (value) => (value === "parser_normalization" ? 2 : value === "noise" ? 1 : 0);
          const curP = priority(String(cur.triage || ""));
          const nextP = priority(String(triage.triage || ""));
          if (nextP > curP || (!cur.triage && triage.triage)) {
            cur.triage = triage.triage;
            cur.canonical_form_token = triage.canonicalFormToken;
            cur.action = triage.action;
          } else if (nextP === curP && nextP === 2 && !cur.canonical_form_token && triage.canonicalFormToken) {
            // Same triage bucket, but new example provides a more specific canonical token.
            cur.canonical_form_token = triage.canonicalFormToken;
          }
        }
      }
    }
  }

  const globalRows = [...globalActionMap.values()].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  await writeSimpleCsv("kb_gap_action_list.csv", globalRows, {
    header: [
      "token",
      "ingredient",
      "gapType",
      "triage",
      "canonical_form_token",
      "gap_detail",
      "count",
      "example_actives_excerpt",
      "action",
    ],
  });

  await writeCsv("candidates_top80_kb_hits.csv", stratHits.selected);
  await writeCsv("candidates_top80_kb_gaps.csv", stratGaps.selected);

  console.log(
    `[dsld-scan] enriched=${enriched.length} kb_hits=${hits.length} kb_gaps=${gaps.length} wrote=${ARTIFACT_DIR}`,
  );
}

main().catch((err) => {
  console.error(`[dsld-scan] fatal: ${String(err)}`);
  process.exit(1);
});
