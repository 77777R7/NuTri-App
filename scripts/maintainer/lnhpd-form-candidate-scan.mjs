#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Maintainer utility: discover LNHPD barcode samples with explicit chemical-form evidence.
 *
 * Why:
 * - We want a stable "lnhpd_with_form" regression sample that genuinely discloses a form token
 *   (oxide/citrate/ascorbate/etc) in the LNHPD facts, so KB-first + formGuard can be validated.
 *
 * Notes:
 * - This is NOT intended to run in CI (requires elevated DB access).
 * - It reads LNHPD rows, parses medicinal ingredient names, and links NPN -> barcode via barcode_regulatory_map.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/maintainer/lnhpd-form-candidate-scan.mjs
 *
 * Output:
 * - artifacts/lnhpd-form-candidates/<run>/lnhpd_with_form_candidates.json
 * - artifacts/lnhpd-form-candidates/<run>/lnhpd_with_form_candidates.csv
 */

import fs from "node:fs/promises";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OUT_DIR = process.env.LNHPD_CANDIDATE_ARTIFACT_DIR || "artifacts/lnhpd-form-candidates";
const RUN_ID = process.env.GITHUB_RUN_ID || "local";
const RUN_ATTEMPT = process.env.GITHUB_RUN_ATTEMPT || "1";
const ARTIFACT_DIR = path.join(OUT_DIR, `${RUN_ID}-${RUN_ATTEMPT}`);

const DEFAULT_TOKENS = [
  "oxide",
  "citrate",
  "glycinate",
  "bisglycinate",
  "ascorbate",
  "picolinate",
  "sulfate",
  "chloride",
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
  "hydrochloride",
  "hcl",
];

const TOKENS = (process.env.LNHPD_FORM_TOKENS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const FORM_TOKENS = TOKENS.length ? TOKENS : DEFAULT_TOKENS;

const SAMPLE_LIMIT = Number(process.env.LNHPD_SCAN_LIMIT || 2000);
const PAGE_SIZE = Number(process.env.LNHPD_SCAN_PAGE_SIZE || 200);
const MAX_CANDIDATES = Number(process.env.LNHPD_SCAN_MAX_CANDIDATES || 60);
const MAX_MAP_ROWS = Number(process.env.LNHPD_SCAN_MAX_MAP_ROWS || 3);

const MEDICINAL_NAME_KEYS = [
  "medicinal_ingredient_name",
  "ingredient_name",
  "medicinal_ingredient_name_en",
  "ingredient_name_en",
  "proper_name",
  "substance_name",
  "name",
];

const normalizeFreeText = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const tokenRegex = (token) => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i");

const buildHeaders = () => ({
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
});

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const extractMedicinalNameStrings = (value) => {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object") return;
    for (const key of MEDICINAL_NAME_KEYS) {
      const v = node[key];
      if (typeof v === "string" && v.trim()) out.push(v.trim());
    }
    for (const v of Object.values(node)) {
      if (typeof v === "object" && v) walk(v);
    }
  };
  walk(value);
  return out;
};

const detectEvidenceKind = (text) => {
  const lower = normalizeFreeText(text);
  if (/\(as\s+[^)]+\)/i.test(lower)) return "label_parenthetical";
  if (/\bas\s+[^,;]+(?:,|;|$)/i.test(lower)) return "label_as_phrase";
  if (/\bfrom\s+[^,;]+(?:,|;|$)/i.test(lower)) return "label_from_phrase";
  return "ingredient_name";
};

const confidenceBandForEvidenceKind = (kind) => {
  if (kind === "label_parenthetical") return "high";
  if (kind === "label_as_phrase" || kind === "label_from_phrase") return "high";
  return "medium";
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: buildHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${url} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchLnhpdFactsSample() {
  const rows = [];
  const pages = Math.ceil(SAMPLE_LIMIT / PAGE_SIZE);
  for (let i = 0; i < pages; i += 1) {
    const offset = i * PAGE_SIZE;
    const limit = Math.min(PAGE_SIZE, SAMPLE_LIMIT - offset);
    const url =
      `${SUPABASE_URL}/rest/v1/lnhpd_facts_complete` +
      `?select=npn,brand_name,product_name,dataset_version,extracted_at,facts_json` +
      `&order=extracted_at.desc.nullslast` +
      `&limit=${limit}&offset=${offset}`;
    // eslint-disable-next-line no-await-in-loop
    const page = await fetchJson(url);
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    if (rows.length >= SAMPLE_LIMIT) break;
  }
  return rows;
}

async function fetchBarcodeMapForNpn(npn) {
  const safe = encodeURIComponent(String(npn));
  const url =
    `${SUPABASE_URL}/rest/v1/barcode_regulatory_map` +
    `?select=barcode_gtin14,barcode_raw,confidence,source,expires_at,updated_at` +
    `&npn=eq.${safe}&order=confidence.desc.nullslast&limit=${MAX_MAP_ROWS}`;
  const rows = await fetchJson(url);
  return Array.isArray(rows) ? rows : [];
}

function rankCandidate(c) {
  // Prefer explicit "(as ...)" / "as ..." patterns, then more tokens, then more mapping confidence.
  const band = c.bestBand === "high" ? 2 : c.bestBand === "medium" ? 1 : 0;
  const tokenCount = c.tokens?.length ?? 0;
  const mapConf = c.bestMap?.confidence != null ? Number(c.bestMap.confidence) : 0;
  return band * 1000 + tokenCount * 10 + mapConf;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (maintainer-only script).");
    process.exit(1);
  }

  await ensureDir(ARTIFACT_DIR);

  console.log(`[lnhpd-candidates] sample_limit=${SAMPLE_LIMIT} page_size=${PAGE_SIZE} tokens=${FORM_TOKENS.length}`);

  const sample = await fetchLnhpdFactsSample();
  console.log(`[lnhpd-candidates] fetched rows=${sample.length}`);

  const candidates = [];
  for (const row of sample) {
    const npn = String(row?.npn ?? "").trim();
    if (!npn) continue;
    const factsJson = row?.facts_json && typeof row.facts_json === "object" ? row.facts_json : null;
    if (!factsJson) continue;

    const medicinal = factsJson.medicinalIngredients ?? factsJson.medicinal_ingredients ?? null;
    const names = extractMedicinalNameStrings(medicinal);
    if (!names.length) continue;

    const hits = [];
    for (const name of names) {
      const kind = detectEvidenceKind(name);
      const band = confidenceBandForEvidenceKind(kind);
      for (const token of FORM_TOKENS) {
        if (!tokenRegex(token).test(name)) continue;
        hits.push({
          token,
          evidenceText: name,
          evidenceKind: kind,
          confidenceBand: band,
        });
      }
    }
    if (!hits.length) continue;

    // eslint-disable-next-line no-await-in-loop
    const mapRows = await fetchBarcodeMapForNpn(npn).catch(() => []);
    const bestMap = Array.isArray(mapRows) && mapRows.length ? mapRows[0] : null;
    if (!bestMap?.barcode_gtin14) continue;

    const best = hits.sort((a, b) => (a.confidenceBand === b.confidenceBand ? 0 : a.confidenceBand === "high" ? -1 : 1))[0];
    candidates.push({
      barcode_gtin14: String(bestMap.barcode_gtin14),
      barcode_raw: bestMap.barcode_raw ? String(bestMap.barcode_raw) : null,
      npn,
      brand_name: row?.brand_name ?? null,
      product_name: row?.product_name ?? null,
      dataset_version: row?.dataset_version ?? null,
      factsSourceVersion: row?.dataset_version ? `lnhpd:${row.dataset_version}` : null,
      tokens: Array.from(new Set(hits.map((h) => h.token))).sort(),
      bestBand: best.confidenceBand,
      bestEvidence: best.evidenceText,
      bestEvidenceKind: best.evidenceKind,
      bestMap,
      mapRows,
    });
  }

  const ranked = candidates.sort((a, b) => rankCandidate(b) - rankCandidate(a)).slice(0, MAX_CANDIDATES);
  const outJson = {
    generatedAt: new Date().toISOString(),
    sampleLimit: SAMPLE_LIMIT,
    tokens: FORM_TOKENS,
    count: ranked.length,
    candidates: ranked,
  };

  const csvLines = [
    [
      "barcode_gtin14",
      "barcode_raw",
      "npn",
      "dataset_version",
      "factsSourceVersion",
      "brand_name",
      "product_name",
      "tokens",
      "bestBand",
      "bestEvidenceKind",
      "bestEvidence",
      "map_source",
      "map_confidence",
      "map_expires_at",
    ].join(","),
  ];

  for (const c of ranked) {
    const safe = (v) => `"${String(v ?? "").replace(/\"/g, '""')}"`;
    csvLines.push(
      [
        safe(c.barcode_gtin14),
        safe(c.barcode_raw ?? ""),
        safe(c.npn),
        safe(c.dataset_version ?? ""),
        safe(c.factsSourceVersion ?? ""),
        safe(c.brand_name ?? ""),
        safe(c.product_name ?? ""),
        safe((c.tokens ?? []).join("|")),
        safe(c.bestBand ?? ""),
        safe(c.bestEvidenceKind ?? ""),
        safe(c.bestEvidence ?? ""),
        safe(c.bestMap?.source ?? ""),
        safe(c.bestMap?.confidence ?? ""),
        safe(c.bestMap?.expires_at ?? ""),
      ].join(","),
    );
  }

  await fs.writeFile(path.join(ARTIFACT_DIR, "lnhpd_with_form_candidates.json"), JSON.stringify(outJson, null, 2));
  await fs.writeFile(path.join(ARTIFACT_DIR, "lnhpd_with_form_candidates.csv"), csvLines.join("\n") + "\n");

  console.log(`[lnhpd-candidates] wrote candidates=${ranked.length} dir=${ARTIFACT_DIR}`);
  if (!ranked.length) {
    console.log("[lnhpd-candidates] no candidates found; consider increasing LNHPD_SCAN_LIMIT or FORM_TOKENS");
  } else {
    console.log("[lnhpd-candidates] top suggestion:");
    const top = ranked[0];
    console.log(`- barcode_gtin14=${top.barcode_gtin14} npn=${top.npn} tokens=${top.tokens.join("|")} band=${top.bestBand}`);
  }
}

main().catch((err) => {
  console.error(`[lnhpd-candidates] fatal: ${String(err)}`);
  process.exit(1);
});

