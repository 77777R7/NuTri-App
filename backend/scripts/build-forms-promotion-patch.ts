import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type PlanCandidate = {
  ingredient_id: string;
  canonical_key: string | null;
  ingredient_name: string | null;
  form_id: string;
  form_key: string;
  form_label: string;
  evidence_grade: string | null;
  confidence: number | null;
  relative_factor: number | null;
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
  "output/ingredient-forms/forms_promotion_patch.json";
const minCitations = Math.max(1, Number(getArg("min-citations") ?? "1"));

if (!planPath) {
  throw new Error("[forms-promotion-patch] --plan is required");
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

const run = async () => {
  const raw = await readFile(planPath, "utf8");
  const payload = JSON.parse(raw) as PlanPayload;
  const candidates = payload.candidates ?? [];
  const eligible = candidates.filter(
    (item) => item.has_citations && item.citations_count >= minCitations,
  );

  const formIds = eligible.map((item) => item.form_id);
  const citationMap = new Map<string, string[]>();
  for (const chunk of chunkArray(formIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_form_citations")
      .select("form_id,citation_id")
      .in("form_id", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      if (!row?.form_id || !row?.citation_id) return;
      const list = citationMap.get(row.form_id) ?? [];
      list.push(row.citation_id);
      citationMap.set(row.form_id, list);
    });
  }

  const ingredientMap = new Map<string, { name: string; forms: PlanCandidate[] }>();
  eligible.forEach((item) => {
    const canonicalKey = item.canonical_key ?? item.ingredient_id;
    if (!canonicalKey) return;
    const bucket = ingredientMap.get(canonicalKey) ?? {
      name: item.ingredient_name ?? canonicalKey.replace(/_/g, " "),
      forms: [],
    };
    bucket.forms.push(item);
    ingredientMap.set(canonicalKey, bucket);
  });

  const ingredients = Array.from(ingredientMap.entries()).map(([canonicalKey, payload]) => ({
    ingredient_id: canonicalKey,
    ingredient: payload.name,
    forms: payload.forms.map((form) => ({
      form_key: form.form_key,
      form_label: form.form_label,
      relative_factor: form.relative_factor ?? 1,
      confidence: form.confidence ?? 0.7,
      evidence_grade: form.evidence_grade ?? null,
      audit_status: "verified",
      reference_ids: citationMap.get(form.form_id) ?? [],
    })),
  }));

  const outputPayload = {
    version: "phaseD_forms_promotion_v1",
    generated_at: new Date().toISOString(),
    ingredients,
  };

  await ensureDir(output);
  await writeFile(output, JSON.stringify(outputPayload, null, 2), "utf8");

  console.log(
    `[forms-promotion-patch] candidates=${candidates.length} eligible=${eligible.length} ingredients=${ingredients.length} output=${output}`,
  );
};

run().catch((error) => {
  console.error("[forms-promotion-patch] failed:", error);
  process.exit(1);
});
