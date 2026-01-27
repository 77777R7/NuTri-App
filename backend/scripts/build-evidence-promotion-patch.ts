import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type PlanCandidate = {
  evidence_id: string;
  ingredient_id: string;
  canonical_key: string | null;
  ingredient_name: string | null;
  goal: string;
  min_effective_dose: number | null;
  optimal_dose_range: string | null;
  evidence_grade: string | null;
  citations_count: number;
  has_citations: boolean;
};

type PlanPayload = {
  summary?: Record<string, unknown>;
  candidates?: PlanCandidate[];
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const planPath = getArg("plan");
const output =
  getArg("output") ??
  "output/ingredient-evidence/evidence_promotion_patch.json";
const minCitations = Math.max(1, Number(getArg("min-citations") ?? "1"));

if (!planPath) {
  throw new Error("[evidence-promotion-patch] --plan is required");
}

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const parseRange = (value: string | null) => {
  if (!value) return null;
  const match = value.match(/\[(.+?),(.+?)\]/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = Number(match[2]);
  return {
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
  };
};

const run = async () => {
  const raw = await readFile(planPath, "utf8");
  const payload = JSON.parse(raw) as PlanPayload;
  const candidates = payload.candidates ?? [];
  const eligible = candidates.filter(
    (item) => item.has_citations && item.citations_count >= minCitations,
  );

  const evidenceIds = eligible.map((item) => item.evidence_id);
  const citationMap = new Map<string, string[]>();
  for (const chunk of chunkArray(evidenceIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_evidence_citations")
      .select("evidence_id,citation_id")
      .in("evidence_id", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      if (!row?.evidence_id || !row?.citation_id) return;
      const list = citationMap.get(row.evidence_id) ?? [];
      list.push(row.citation_id);
      citationMap.set(row.evidence_id, list);
    });
  }

  const ingredientMap = new Map<
    string,
    { name: string; evidence: PlanCandidate[] }
  >();
  eligible.forEach((item) => {
    const canonicalKey = item.canonical_key ?? item.ingredient_id;
    if (!canonicalKey) return;
    const bucket = ingredientMap.get(canonicalKey) ?? {
      name: item.ingredient_name ?? canonicalKey.replace(/_/g, " "),
      evidence: [],
    };
    bucket.evidence.push(item);
    ingredientMap.set(canonicalKey, bucket);
  });

  const ingredients = Array.from(ingredientMap.entries()).map(([canonicalKey, payload]) => ({
    ingredient_id: canonicalKey,
    ingredient: payload.name,
    evidence_by_goal: payload.evidence.map((row) => ({
      goal: row.goal,
      min_effective_dose: row.min_effective_dose ?? null,
      optimal_range: parseRange(row.optimal_dose_range),
      evidence_grade: row.evidence_grade ?? null,
      audit_status: "verified",
      reference_ids: citationMap.get(row.evidence_id) ?? [],
    })),
  }));

  const outputPayload = {
    version: "phaseD_evidence_promotion_v1",
    generated_at: new Date().toISOString(),
    ingredients,
  };

  await ensureDir(output);
  await writeFile(output, JSON.stringify(outputPayload, null, 2), "utf8");

  console.log(
    `[evidence-promotion-patch] candidates=${candidates.length} eligible=${eligible.length} ingredients=${ingredients.length} output=${output}`,
  );
};

run().catch((error) => {
  console.error("[evidence-promotion-patch] failed:", error);
  process.exit(1);
});
