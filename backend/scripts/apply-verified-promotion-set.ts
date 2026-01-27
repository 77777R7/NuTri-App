import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type PlanCandidate = {
  ingredient_id: string;
  form_key?: string;
  goal?: string;
};

type PlanPayload = {
  candidates?: PlanCandidate[];
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const formsSelectedPath = getArg("forms-selected");
const evidenceSelectedPath = getArg("evidence-selected");
const formsUniversePath = getArg("forms-universe");
const evidenceUniversePath = getArg("evidence-universe");
const summaryPath = getArg("summary-json") ?? "output/verified_promotion_apply_summary.json";

if (!formsSelectedPath || !evidenceSelectedPath || !formsUniversePath || !evidenceUniversePath) {
  console.error(
    "[apply-verified-promotion-set] --forms-selected --evidence-selected --forms-universe --evidence-universe are required",
  );
  process.exit(1);
}

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const readPlan = async (filePath: string): Promise<PlanPayload> =>
  JSON.parse(await readFile(filePath, "utf8"));

const keyFor = (candidate: PlanCandidate, type: "form" | "evidence") => {
  if (type === "form") {
    return `${candidate.ingredient_id}::${candidate.form_key ?? ""}`;
  }
  return `${candidate.ingredient_id}::${candidate.goal ?? ""}`;
};

const applyForms = async (
  selected: PlanCandidate[],
  universe: PlanCandidate[],
) => {
  const selectedKeys = new Set(
    selected.filter((c) => c.form_key).map((c) => keyFor(c, "form")),
  );

  const updates = universe
    .filter((c) => c.form_key)
    .map((c) => ({
      ingredient_id: c.ingredient_id,
      form_key: c.form_key as string,
      audit_status: selectedKeys.has(keyFor(c, "form")) ? "verified" : "needs_review",
    }));

  let updated = 0;
  for (const row of updates) {
    const { error, data } = await supabase
      .from("ingredient_forms")
      .update({ audit_status: row.audit_status })
      .eq("ingredient_id", row.ingredient_id)
      .eq("form_key", row.form_key)
      .select("id");
    if (error) {
      throw new Error(`[apply-verified-promotion-set] form update failed: ${error.message}`);
    }
    updated += data?.length ?? 0;
  }
  return {
    total: updates.length,
    verified: updates.filter((row) => row.audit_status === "verified").length,
    demoted: updates.filter((row) => row.audit_status !== "verified").length,
    updated,
  };
};

const applyEvidence = async (
  selected: PlanCandidate[],
  universe: PlanCandidate[],
) => {
  const selectedKeys = new Set(
    selected.filter((c) => c.goal).map((c) => keyFor(c, "evidence")),
  );

  const updates = universe
    .filter((c) => c.goal)
    .map((c) => ({
      ingredient_id: c.ingredient_id,
      goal: c.goal as string,
      audit_status: selectedKeys.has(keyFor(c, "evidence")) ? "verified" : "needs_review",
    }));

  let updated = 0;
  for (const row of updates) {
    const { error, data } = await supabase
      .from("ingredient_evidence")
      .update({ audit_status: row.audit_status })
      .eq("ingredient_id", row.ingredient_id)
      .eq("goal", row.goal)
      .select("id");
    if (error) {
      throw new Error(`[apply-verified-promotion-set] evidence update failed: ${error.message}`);
    }
    updated += data?.length ?? 0;
  }
  return {
    total: updates.length,
    verified: updates.filter((row) => row.audit_status === "verified").length,
    demoted: updates.filter((row) => row.audit_status !== "verified").length,
    updated,
  };
};

const run = async () => {
  const [formsSelected, evidenceSelected, formsUniverse, evidenceUniverse] = await Promise.all([
    readPlan(formsSelectedPath),
    readPlan(evidenceSelectedPath),
    readPlan(formsUniversePath),
    readPlan(evidenceUniversePath),
  ]);

  const formsResult = await applyForms(
    formsSelected.candidates ?? [],
    formsUniverse.candidates ?? [],
  );
  const evidenceResult = await applyEvidence(
    evidenceSelected.candidates ?? [],
    evidenceUniverse.candidates ?? [],
  );

  const summary = {
    forms: formsResult,
    evidence: evidenceResult,
    formsSelectedPath,
    evidenceSelectedPath,
    formsUniversePath,
    evidenceUniversePath,
    generatedAt: new Date().toISOString(),
  };

  await ensureDir(summaryPath);
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`[apply-verified-promotion-set] wrote ${summaryPath}`);
};

run().catch((error) => {
  console.error(
    `[apply-verified-promotion-set] ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
