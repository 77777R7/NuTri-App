import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type PlanCandidate = {
  ingredient_id: string;
  form_key?: string;
  goal?: string;
  occurrence_count?: number | null;
};

type PlanPayload = {
  summary?: Record<string, unknown>;
  candidates?: PlanCandidate[];
};

type CulpritStats = {
  key: string;
  gt20Count: number;
  gt10Count: number;
};

type CulpritPayload = {
  formStats?: CulpritStats[];
  evidenceStats?: CulpritStats[];
};

type CompareSummary = {
  overallDeltaThresholds?: {
    gt20?: number;
    gt10?: number;
    gt20Ratio?: number;
    gt10Ratio?: number;
  };
  matchedBoth?: number;
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
const comparePath = getArg("compare");
const outForms = getArg("out-forms") ?? "output/forms_promotion_plan_risk.json";
const outEvidence = getArg("out-evidence") ?? "output/evidence_promotion_plan_risk.json";
const outSummary = getArg("out-summary") ?? "output/risk_budget_summary.json";

const budgetGt20 = Number(getArg("budget-gt20") ?? "110");
const budgetGt10 = Number(getArg("budget-gt10") ?? "550");
const maxRelativeFactor = Number(getArg("max-relative-factor") ?? "1.1");
const maxEvidenceMinDose = Number(getArg("max-evidence-min-dose") ?? "100000000");

if (!formsPlanPath || !evidencePlanPath || !culpritsPath || !comparePath) {
  console.error(
    "[risk-budget] --forms-plan --evidence-plan --culprits --compare are required",
  );
  process.exit(1);
}

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const readJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, "utf8"));

const run = async () => {
  const [formsPlan, evidencePlan, culprits, compare] = await Promise.all([
    readJson<PlanPayload>(formsPlanPath),
    readJson<PlanPayload>(evidencePlanPath),
    readJson<CulpritPayload>(culpritsPath),
    readJson<CompareSummary>(comparePath),
  ]);

  const currentGt20 = compare.overallDeltaThresholds?.gt20 ?? 0;
  const currentGt10 = compare.overallDeltaThresholds?.gt10 ?? 0;

  const formCulpritMap = new Map<string, CulpritStats>();
  (culprits.formStats ?? []).forEach((item) => formCulpritMap.set(item.key, item));
  const evidenceCulpritMap = new Map<string, CulpritStats>();
  (culprits.evidenceStats ?? []).forEach((item) => evidenceCulpritMap.set(item.key, item));

  const formsCandidates = formsPlan.candidates ?? [];
  const evidenceCandidates = evidencePlan.candidates ?? [];

  const formsFilteredHard = formsCandidates.filter((item) => {
    const rf = typeof (item as any).relative_factor === "number" ? (item as any).relative_factor : null;
    return rf == null || rf <= maxRelativeFactor;
  });
  const evidenceFilteredHard = evidenceCandidates.filter((item) => {
    const minDose = typeof (item as any).min_effective_dose === "number" ? (item as any).min_effective_dose : null;
    return minDose == null || minDose <= maxEvidenceMinDose;
  });

  const scored = [
    ...formsFilteredHard.map((item) => {
      const key = `${item.ingredient_id}::${item.form_key ?? ""}`;
      const stats = formCulpritMap.get(key);
      return {
        type: "form" as const,
        key,
        candidate: item,
        gt20: stats?.gt20Count ?? 0,
        gt10: stats?.gt10Count ?? 0,
      };
    }),
    ...evidenceFilteredHard.map((item) => {
      const key = `${item.ingredient_id}::${item.goal ?? ""}`;
      const stats = evidenceCulpritMap.get(key);
      return {
        type: "evidence" as const,
        key,
        candidate: item,
        gt20: stats?.gt20Count ?? 0,
        gt10: stats?.gt10Count ?? 0,
      };
    }),
  ];

  const toRemove: typeof scored = [];
  let removedGt20 = 0;
  let removedGt10 = 0;
  const needGt20 = Math.max(0, currentGt20 - budgetGt20);
  const needGt10 = Math.max(0, currentGt10 - budgetGt10);

  const sortedByRisk = scored
    .filter((item) => item.gt20 > 0 || item.gt10 > 0)
    .sort((a, b) => b.gt20 - a.gt20 || b.gt10 - a.gt10);

  for (const item of sortedByRisk) {
    if (removedGt20 >= needGt20 && removedGt10 >= needGt10) break;
    toRemove.push(item);
    removedGt20 += item.gt20;
    removedGt10 += item.gt10;
  }

  const removeKeys = new Set(toRemove.map((item) => `${item.type}::${item.key}`));
  const filteredForms = formsFilteredHard.filter((item) => {
    const key = `${item.ingredient_id}::${item.form_key ?? ""}`;
    return !removeKeys.has(`form::${key}`);
  });
  const filteredEvidence = evidenceFilteredHard.filter((item) => {
    const key = `${item.ingredient_id}::${item.goal ?? ""}`;
    return !removeKeys.has(`evidence::${key}`);
  });

  const summary = {
    budgetGt20,
    budgetGt10,
    currentGt20,
    currentGt10,
    needGt20,
    needGt10,
    removedGt20,
    removedGt10,
    removedCount: toRemove.length,
    hardFilters: {
      maxRelativeFactor,
      maxEvidenceMinDose,
      formsDropped: formsCandidates.length - formsFilteredHard.length,
      evidenceDropped: evidenceCandidates.length - evidenceFilteredHard.length,
    },
    forms: {
      total: formsCandidates.length,
      kept: filteredForms.length,
      removed: formsCandidates.length - filteredForms.length,
    },
    evidence: {
      total: evidenceCandidates.length,
      kept: filteredEvidence.length,
      removed: evidenceCandidates.length - filteredEvidence.length,
    },
    removedItems: toRemove.map((item) => ({
      type: item.type,
      key: item.key,
      gt20: item.gt20,
      gt10: item.gt10,
    })),
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
    `[risk-budget] removed=${summary.removedCount} forms_kept=${filteredForms.length} evidence_kept=${filteredEvidence.length}`,
  );
};

run().catch((error) => {
  console.error(`[risk-budget] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
