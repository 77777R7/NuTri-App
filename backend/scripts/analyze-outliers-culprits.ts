import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

type VerifiedForm = {
  ingredientId?: string | null;
  ingredient_id?: string | null;
  formKey?: string | null;
  form_key?: string | null;
  ingredientName?: string | null;
};

type VerifiedEvidence = {
  ingredientId?: string | null;
  ingredient_id?: string | null;
  goal?: string | null;
  ingredientName?: string | null;
};

type OutlierRow = {
  sourceId: string;
  overallDelta: number;
  triggered?: {
    verifiedForms?: VerifiedForm[];
    verifiedEvidence?: VerifiedEvidence[];
    flags?: Array<{ code?: string } | string>;
  };
  baselineTriggered?: {
    verifiedForms?: VerifiedForm[];
    verifiedEvidence?: VerifiedEvidence[];
    flags?: Array<{ code?: string } | string>;
  };
};

type PatchIngredient = {
  ingredient_id?: string | null;
  forms?: Array<{ form_key?: string | null }>;
  evidence_by_goal?: Array<{ goal?: string | null }>;
};

type PatchFile = {
  version?: string;
  generated_at?: string;
  ingredients?: PatchIngredient[];
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const OUTLIERS = getArg("outliers");
const FORMS_PATCH = getArg("forms-patch");
const EVIDENCE_PATCH = getArg("evidence-patch");
const OUT_DIR = getArg("out-dir") ?? "output/phaseD/culprits";
const TARGET = Math.max(1, Number(getArg("target") ?? "90"));

if (!OUTLIERS || !FORMS_PATCH || !EVIDENCE_PATCH) {
  console.error(
    "[analyze-outliers-culprits] usage: --outliers <jsonl> --forms-patch <json> --evidence-patch <json> [--out-dir <dir>] [--target <int>]",
  );
  process.exit(1);
}

const normalizeKey = (value?: string | null) => (value ?? "").trim();

const formKey = (item: VerifiedForm) =>
  `${normalizeKey(item.ingredientId ?? item.ingredient_id)}::${normalizeKey(
    item.formKey ?? item.form_key,
  )}`;

const evidenceKey = (item: VerifiedEvidence) =>
  `${normalizeKey(item.ingredientId ?? item.ingredient_id)}::${normalizeKey(item.goal)}`;

const flagCodes = (flags?: Array<{ code?: string } | string>) => {
  const out = new Set<string>();
  (flags ?? []).forEach((entry) => {
    if (typeof entry === "string") out.add(entry);
    else if (entry?.code) out.add(entry.code);
  });
  return out;
};

const readPatch = async (filePath: string): Promise<PatchFile> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as PatchFile;
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
};

const run = async () => {
  const formsPatch = await readPatch(FORMS_PATCH);
  const evidencePatch = await readPatch(EVIDENCE_PATCH);

  const allowedForms = new Set<string>();
  const allowedEvidence = new Set<string>();

  (formsPatch.ingredients ?? []).forEach((entry) => {
    const ingredientId = normalizeKey(entry.ingredient_id);
    if (!ingredientId) return;
    (entry.forms ?? []).forEach((form) => {
      const key = `${ingredientId}::${normalizeKey(form.form_key)}`;
      if (key.endsWith("::")) return;
      allowedForms.add(key);
    });
  });

  (evidencePatch.ingredients ?? []).forEach((entry) => {
    const ingredientId = normalizeKey(entry.ingredient_id);
    if (!ingredientId) return;
    (entry.evidence_by_goal ?? []).forEach((ev) => {
      const key = `${ingredientId}::${normalizeKey(ev.goal)}`;
      if (key.endsWith("::")) return;
      allowedEvidence.add(key);
    });
  });

  const perItem = new Map<string, Set<string>>();
  const perOutlier: Array<Record<string, unknown>> = [];
  const coverableOutliers = new Set<string>();
  const allOutliers = new Set<string>();

  const raw = await readFile(OUTLIERS, "utf8");
  const lines = raw.split("\n").filter(Boolean);

  for (const line of lines) {
    const row = JSON.parse(line) as OutlierRow;
    const sourceId = row.sourceId;
    if (!sourceId) continue;
    allOutliers.add(sourceId);

    const triggeredForms = new Set(
      (row.triggered?.verifiedForms ?? []).map(formKey).filter((k) => !k.endsWith("::")),
    );
    const triggeredEvidence = new Set(
      (row.triggered?.verifiedEvidence ?? []).map(evidenceKey).filter((k) => !k.endsWith("::")),
    );
    const baselineForms = new Set(
      (row.baselineTriggered?.verifiedForms ?? []).map(formKey).filter((k) => !k.endsWith("::")),
    );
    const baselineEvidence = new Set(
      (row.baselineTriggered?.verifiedEvidence ?? []).map(evidenceKey).filter((k) => !k.endsWith("::")),
    );

    const promotionForms = Array.from(triggeredForms).filter(
      (k) => !baselineForms.has(k) && allowedForms.has(k),
    );
    const promotionEvidence = Array.from(triggeredEvidence).filter(
      (k) => !baselineEvidence.has(k) && allowedEvidence.has(k),
    );

    if (promotionForms.length || promotionEvidence.length) {
      coverableOutliers.add(sourceId);
    }

    for (const key of promotionForms) {
      if (!perItem.has(`form:${key}`)) perItem.set(`form:${key}`, new Set());
      perItem.get(`form:${key}`)?.add(sourceId);
    }

    for (const key of promotionEvidence) {
      if (!perItem.has(`evidence:${key}`)) perItem.set(`evidence:${key}`, new Set());
      perItem.get(`evidence:${key}`)?.add(sourceId);
    }

    const shadowFlags = flagCodes(row.triggered?.flags);
    const baselineFlags = flagCodes(row.baselineTriggered?.flags);
    const shadowOnly = Array.from(shadowFlags).filter((f) => !baselineFlags.has(f));
    const baselineOnly = Array.from(baselineFlags).filter((f) => !shadowFlags.has(f));

    perOutlier.push({
      sourceId,
      overallDelta: row.overallDelta,
      promotionEvidenceHits: promotionEvidence,
      promotionFormHits: promotionForms,
      flagsDelta: {
        shadowOnly,
        baselineOnly,
      },
    });
  }

  const remaining = new Set(coverableOutliers);
  const removal: Array<{ item: string; covered: number }> = [];

  while (remaining.size > TARGET) {
    let bestItem: string | null = null;
    let bestCount = 0;
    for (const [item, ids] of perItem.entries()) {
      let count = 0;
      for (const id of ids) {
        if (remaining.has(id)) count += 1;
      }
      if (count > bestCount) {
        bestCount = count;
        bestItem = item;
      }
    }
    if (!bestItem || bestCount === 0) break;
    removal.push({ item: bestItem, covered: bestCount });
    for (const id of perItem.get(bestItem) ?? []) {
      remaining.delete(id);
    }
  }

  const removedForms = new Set<string>();
  const removedEvidence = new Set<string>();
  removal.forEach((entry) => {
    if (entry.item.startsWith("form:")) removedForms.add(entry.item.replace("form:", ""));
    if (entry.item.startsWith("evidence:")) removedEvidence.add(entry.item.replace("evidence:", ""));
  });

  const filterForms = (patch: PatchFile): PatchFile => ({
    ...patch,
    ingredients: (patch.ingredients ?? [])
      .map((ing) => ({
        ...ing,
        forms: (ing.forms ?? []).filter((form) => {
          const key = `${normalizeKey(ing.ingredient_id)}::${normalizeKey(form.form_key)}`;
          return !removedForms.has(key);
        }),
      }))
      .filter((ing) => (ing.forms ?? []).length > 0),
  });

  const filterEvidence = (patch: PatchFile): PatchFile => ({
    ...patch,
    ingredients: (patch.ingredients ?? [])
      .map((ing) => ({
        ...ing,
        evidence_by_goal: (ing.evidence_by_goal ?? []).filter((ev) => {
          const key = `${normalizeKey(ing.ingredient_id)}::${normalizeKey(ev.goal)}`;
          return !removedEvidence.has(key);
        }),
      }))
      .filter((ing) => (ing.evidence_by_goal ?? []).length > 0),
  });

  const annotatedPath = path.join(OUT_DIR, "outliers_gt20_annotated.jsonl");
  const culpritsPath = path.join(OUT_DIR, "outlier_culprits_summary.json");
  const formsOut = path.join(OUT_DIR, "forms_promotion_patch_v6_1.json");
  const evidenceOut = path.join(OUT_DIR, "evidence_promotion_patch_v6_1.json");

  await ensureDir(annotatedPath);
  await writeFile(
    annotatedPath,
    perOutlier.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );

  const culpritsSummary = {
    totalOutliers: allOutliers.size,
    coverableOutliers: coverableOutliers.size,
    targetOutliers: TARGET,
    remainingAfterRemoval: remaining.size,
    removal,
  };
  await writeFile(culpritsPath, JSON.stringify(culpritsSummary, null, 2), "utf8");

  await writeFile(formsOut, JSON.stringify(filterForms(formsPatch), null, 2), "utf8");
  await writeFile(evidenceOut, JSON.stringify(filterEvidence(evidencePatch), null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        outliers: allOutliers.size,
        coverable: coverableOutliers.size,
        target: TARGET,
        remainingAfterRemoval: remaining.size,
        removedForms: removedForms.size,
        removedEvidence: removedEvidence.size,
        annotatedPath,
        culpritsPath,
        formsOut,
        evidenceOut,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error(`[analyze-outliers-culprits] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
