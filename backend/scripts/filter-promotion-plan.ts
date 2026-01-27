import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type PlanCandidate = {
  ingredient_id: string;
  form_key?: string;
  goal?: string;
};

type PlanPayload = {
  summary?: Record<string, unknown>;
  candidates?: PlanCandidate[];
};

type CulpritStats = {
  key: string;
  gt20Count: number;
};

type CulpritPayload = {
  formStats?: CulpritStats[];
  evidenceStats?: CulpritStats[];
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const formsPlanPath = getArg("forms-plan");
const evidencePlanPath = getArg("evidence-plan");
const culpritsPath = getArg("culprits");
const outForms = getArg("out-forms") ?? "output/forms_promotion_plan_filtered.json";
const outEvidence = getArg("out-evidence") ?? "output/evidence_promotion_plan_filtered.json";
const outSummary = getArg("out-summary") ?? "output/promotion_filter_summary.json";
const minGt20 = Math.max(1, Number(getArg("min-gt20") ?? "1"));

if (!formsPlanPath || !evidencePlanPath || !culpritsPath) {
  console.error(
    "[filter-promotion-plan] --forms-plan --evidence-plan --culprits are required",
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

const run = async () => {
  const [formsPlan, evidencePlan, culprits] = await Promise.all([
    readPlan(formsPlanPath),
    readPlan(evidencePlanPath),
    readFile(culpritsPath, "utf8").then((raw) => JSON.parse(raw) as CulpritPayload),
  ]);

  const blockedFormKeys = new Set(
    (culprits.formStats ?? [])
      .filter((item) => item.gt20Count >= minGt20)
      .map((item) => item.key),
  );
  const blockedEvidenceKeys = new Set(
    (culprits.evidenceStats ?? [])
      .filter((item) => item.gt20Count >= minGt20)
      .map((item) => item.key),
  );

  const formsCandidates = formsPlan.candidates ?? [];
  const evidenceCandidates = evidencePlan.candidates ?? [];

  const filteredForms = formsCandidates.filter((item) => {
    if (!item.ingredient_id || !item.form_key) return false;
    const key = `${item.ingredient_id}::${item.form_key}`;
    return !blockedFormKeys.has(key);
  });

  const filteredEvidence = evidenceCandidates.filter((item) => {
    if (!item.ingredient_id || !item.goal) return false;
    const key = `${item.ingredient_id}::${item.goal}`;
    return !blockedEvidenceKeys.has(key);
  });

  const summary = {
    forms: {
      input: formsPlanPath,
      total: formsCandidates.length,
      removed: formsCandidates.length - filteredForms.length,
      blockedKeys: blockedFormKeys.size,
    },
    evidence: {
      input: evidencePlanPath,
      total: evidenceCandidates.length,
      removed: evidenceCandidates.length - filteredEvidence.length,
      blockedKeys: blockedEvidenceKeys.size,
    },
    minGt20,
    generatedAt: new Date().toISOString(),
  };

  await Promise.all([ensureDir(outForms), ensureDir(outEvidence), ensureDir(outSummary)]);

  await writeFile(
    outForms,
    JSON.stringify({ summary: formsPlan.summary, candidates: filteredForms }, null, 2),
    "utf8",
  );
  await writeFile(
    outEvidence,
    JSON.stringify({ summary: evidencePlan.summary, candidates: filteredEvidence }, null, 2),
    "utf8",
  );
  await writeFile(outSummary, JSON.stringify(summary, null, 2), "utf8");

  console.log(
    `[filter-promotion-plan] forms kept=${filteredForms.length} evidence kept=${filteredEvidence.length}`,
  );
};

run().catch((error) => {
  console.error(
    `[filter-promotion-plan] ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
