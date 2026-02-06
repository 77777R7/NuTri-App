#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import { buildFactsDigestFromDsld } from "../../backend/dist/factsDigest.js";
import { lookupKbFormExplain } from "../../backend/dist/kbRuntime.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  "sulfate",
  "chloride",
  "ascorbate",
  "picolinate",
];

const TOKENS = FORM_TOKENS.length ? FORM_TOKENS : DEFAULT_TOKENS;
const MAX_LABELS_PER_TOKEN = Number(process.env.DSLD_SCAN_MAX_LABELS_PER_TOKEN || 200);
const MAX_ENRICH = Number(process.env.DSLD_SCAN_MAX_ENRICH || 120);
const MAX_ACTIVES = Number(process.env.DSLD_SCAN_MAX_ACTIVES || 15);
const REQUIRE_EXPLICIT = (process.env.DSLD_SCAN_REQUIRE_EXPLICIT || "1") !== "0";

const INGREDIENT_ALLOWLIST = [
  "calcium",
  "magnesium",
  "zinc",
  "iron",
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

const buildHeaders = () => ({
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
});

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const normalizeText = (value) => String(value ?? "").toLowerCase();

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

const tokenRegex = (token) => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i");

const hasAllowlistedIngredient = (text) => {
  const lower = normalizeText(text);
  return INGREDIENT_ALLOWLIST.some((tok) => lower.includes(tok));
};

const hasExplicitAsToken = (summary, token) => {
  const s = normalizeText(summary);
  if (!s.includes("(as")) return false;
  // Require token inside the (as ...) parenthetical to avoid false positives.
  const re = new RegExp(`\\(as[^)]*\\b${token.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b[^)]*\\)`, "i");
  return re.test(s);
};

const detectEvidenceKind = (name) => {
  const lower = normalizeText(name);
  if (/\(as\s+[^)]+\)/i.test(lower)) return "label_parenthetical";
  if (/\bas\s+[^,;]+(?:,|;|$)/i.test(lower)) return "label_as_phrase";
  if (/\bfrom\s+[^,;]+(?:,|;|$)/i.test(lower)) return "label_from_phrase";
  return "salt_name";
};

async function fetchMetaCandidatesForToken(token) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/dsld_labels_meta`);
  url.searchParams.set(
    "select",
    [
      "dsld_label_id",
      "barcode_normalized_gtin14",
      "dsld_product_version_code",
      "brand",
      "product_name",
      "serving_size_raw",
      "servings_per_container",
      "active_ingredients_summary",
    ].join(","),
  );
  url.searchParams.set("active_ingredients_summary", `ilike.*${token}*`);
  url.searchParams.set("limit", String(MAX_LABELS_PER_TOKEN));

  const res = await fetch(url.toString(), { headers: buildHeaders() });
  if (!res.ok) {
    throw new Error(`meta query failed token=${token} status=${res.status}`);
  }
  return await res.json();
}

async function fetchDsldFactsByLabelId(labelId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resolve_dsld_facts_by_label_id`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ p_label_id: labelId }),
  });
  if (!res.ok) {
    throw new Error(`resolve_dsld_facts_by_label_id failed labelId=${labelId} status=${res.status}`);
  }
  const json = await res.json();
  const record = Array.isArray(json) ? json[0] : json;
  return record ?? null;
}

function scoreCandidate(enriched) {
  // Prefer stable regression-like samples: moderate actives count, clear token evidence, KB sentence hit.
  const activesCount = enriched.activesCount ?? 0;
  const kbHits = enriched.kbSentenceHitCount ?? 0;
  const tokenHits = enriched.matchedActives?.length ?? 0;
  const countScore = activesCount >= 5 && activesCount <= 15 ? 3 : activesCount <= 20 ? 1 : 0;
  return kbHits * 10 + tokenHits * 2 + countScore;
}

function toCsvRow(enriched) {
  const kbHitNames = (enriched.kbSentenceHitNames ?? []).slice(0, 5).join(" | ");
  const matched = (enriched.matchedActives ?? [])
    .slice(0, 6)
    .map((m) => `${m.name} [${m.tokens.join("+")}]`)
    .join(" | ");
  return {
    barcode_gtin14: enriched.barcodeGtin14 ?? "",
    dsld_label_id: enriched.dsldLabelId ?? "",
    dataset_version: enriched.datasetVersion ?? "",
    dsld_product_version_code: enriched.dsldProductVersionCode ?? "",
    actives_count: enriched.activesCount ?? "",
    evidence_kinds: (enriched.evidenceKinds ?? []).join("+"),
    kb_sentence_hit_count: enriched.kbSentenceHitCount ?? 0,
    kb_sentence_hit_names: kbHitNames,
    matched_actives: matched,
    active_ingredients_summary: String(enriched.activeIngredientsSummary ?? "").replace(/\s+/g, " ").trim(),
    score: enriched.score ?? 0,
  };
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  await ensureDir(ARTIFACT_DIR);
  console.log(`[dsld-scan] tokens=${TOKENS.join(",")} out=${ARTIFACT_DIR}`);

  const metaRows = [];
  for (const token of TOKENS) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await fetchMetaCandidatesForToken(token);
    console.log(`[dsld-scan] token=${token} meta_rows=${rows.length}`);
    metaRows.push(...rows);
  }

  // Deduplicate by label_id; keep first row.
  const byId = new Map();
  for (const row of metaRows) {
    const id = String(row?.dsld_label_id ?? "").trim();
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, row);
  }

  const deduped = [...byId.values()].filter((r) => r?.barcode_normalized_gtin14);
  // Light filter: avoid huge multi-actives labels.
  const filtered = deduped
    .filter((r) => countActivesApprox(r.active_ingredients_summary) <= MAX_ACTIVES)
    .filter((r) => {
      if (!REQUIRE_EXPLICIT) return true;
      const summary = r.active_ingredients_summary;
      // Require at least one token to appear inside (as ...) to avoid noisy candidates.
      return TOKENS.some((t) => hasExplicitAsToken(summary, t));
    });

  await fs.writeFile(path.join(ARTIFACT_DIR, "candidates_meta_raw.json"), JSON.stringify(filtered, null, 2));

  const enriched = [];
  const labelIds = filtered.map((r) => Number(r.dsld_label_id)).filter((n) => Number.isFinite(n)).slice(0, MAX_ENRICH);
  console.log(`[dsld-scan] deduped=${deduped.length} filtered=${filtered.length} enrich=${labelIds.length}`);

  for (const labelId of labelIds) {
    // eslint-disable-next-line no-await-in-loop
    const record = await fetchDsldFactsByLabelId(labelId).catch(() => null);
    if (!record?.facts_json) continue;
    const facts = record.facts_json;

    const meta = byId.get(String(labelId)) ?? null;
    const digest = buildFactsDigestFromDsld({ facts, identityValue: String(labelId) });

    const matchedActives = [];
    const evidenceKinds = new Set();
    const kbSentenceHitNames = [];
    const tokenMatchCounts = Object.fromEntries(TOKENS.map((t) => [t, 0]));

    const explicitSources = new Set(["label_parenthetical", "label_as_phrase", "label_from_phrase"]);

    for (const active of digest.actives) {
      const name = active.name;
      const lowerName = normalizeText(name);
      const chemicalForm = normalizeText(active.chemicalForm);
      const evidenceText = normalizeText(active.chemicalFormEvidence);
      const haystack = `${lowerName} ${chemicalForm} ${evidenceText}`.trim();

      const tokensMatched = TOKENS.filter((t) => tokenRegex(t).test(haystack));
      if (tokensMatched.length === 0) continue;
      if (!hasAllowlistedIngredient(lowerName)) continue;
      if (REQUIRE_EXPLICIT && !explicitSources.has(active.chemicalFormSource ?? "none")) continue;

      const kb = lookupKbFormExplain({
        ingredientName: active.name,
        chemicalForm: active.chemicalForm ?? null,
        chemicalFormConfidence: active.chemicalFormConfidence ?? null,
        chemicalFormSource: active.chemicalFormSource ?? "none",
        chemicalFormEvidence: active.chemicalFormEvidence ?? null,
        ingredientId: null,
      });
      if (kb?.sentenceId && kb?.sentence) {
        kbSentenceHitNames.push(active.name);
      }

      const evidenceKind = detectEvidenceKind(active.chemicalFormEvidence ?? name);
      evidenceKinds.add(evidenceKind);
      for (const t of tokensMatched) tokenMatchCounts[t] += 1;
      matchedActives.push({
        name: active.name,
        tokens: tokensMatched,
        evidenceKind,
        chemicalForm: active.chemicalForm ?? null,
        chemicalFormSource: active.chemicalFormSource ?? "none",
        chemicalFormEvidence: active.chemicalFormEvidence ?? null,
        formResolveSource: kb?.resolveSource ?? "none",
        sentenceId: kb?.sentenceId ?? null,
      });
    }

    const activesCount = Array.isArray(digest.actives) ? digest.actives.length : 0;
    const row = {
      barcodeGtin14: meta?.barcode_normalized_gtin14 ?? null,
      dsldLabelId: labelId,
      datasetVersion: record.dataset_version ?? facts.datasetVersion ?? null,
      dsldProductVersionCode: meta?.dsld_product_version_code ?? null,
      brand: meta?.brand ?? facts.brandName ?? null,
      productName: meta?.product_name ?? facts.productName ?? null,
      servingSize: meta?.serving_size_raw ?? facts.servingSize ?? null,
      activesCount,
      activeIngredientsSummary: meta?.active_ingredients_summary ?? null,
      matchedActives,
      evidenceKinds: [...evidenceKinds],
      tokenMatchCounts,
      kbSentenceHitCount: kbSentenceHitNames.length,
      kbSentenceHitNames: [...new Set(kbSentenceHitNames)],
    };
    row.score = scoreCandidate(row);
    if (row.matchedActives.length > 0) enriched.push(row);
  }

  enriched.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const hits = enriched.filter((r) => (r.kbSentenceHitCount ?? 0) > 0);
  const gaps = enriched.filter((r) => (r.kbSentenceHitCount ?? 0) === 0);

  await fs.writeFile(path.join(ARTIFACT_DIR, "candidates_enriched.json"), JSON.stringify(enriched, null, 2));
  await fs.writeFile(path.join(ARTIFACT_DIR, "candidates_kb_hits.json"), JSON.stringify(hits, null, 2));
  await fs.writeFile(path.join(ARTIFACT_DIR, "candidates_kb_gaps.json"), JSON.stringify(gaps, null, 2));

  const gapReport = {
    generatedAt: new Date().toISOString(),
    tokens: TOKENS,
    requireExplicit: REQUIRE_EXPLICIT,
    metaCandidates: filtered.length,
    enrichedCandidates: enriched.length,
    kbHitCandidates: hits.length,
    kbGapCandidates: gaps.length,
    tokenStats: Object.fromEntries(
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
    ),
  };
  await fs.writeFile(path.join(ARTIFACT_DIR, "kb_gap_report.json"), JSON.stringify(gapReport, null, 2));

  // CSV output for quick triage.
  const writeCsv = async (filename, rows) => {
    const top = rows.slice(0, 80).map(toCsvRow);
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

  await writeCsv("candidates_top80_kb_hits.csv", hits);
  await writeCsv("candidates_top80_kb_gaps.csv", gaps);

  console.log(
    `[dsld-scan] enriched=${enriched.length} kb_hits=${hits.length} kb_gaps=${gaps.length} wrote=${ARTIFACT_DIR}`,
  );
}

main().catch((err) => {
  console.error(`[dsld-scan] fatal: ${String(err)}`);
  process.exit(1);
});
