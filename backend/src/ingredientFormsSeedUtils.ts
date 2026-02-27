export type SeedLayer = "reviewed_package" | "explicit_as_form" | "unspecified_fallback";

export type SeedTargetOrigin = "r1" | "topn" | "r1+topn";

export type SeedRow = {
  ingredient_id: string;
  form_key: string;
  form_label: string;
  relative_factor: number;
  confidence: number;
  evidence_grade: string | null;
  audit_status: "verified" | "derived";
  source_layer: SeedLayer;
  quality_gate?: "passed" | "denied" | "downgraded";
  source_reason: string;
  target_origin: SeedTargetOrigin;
  source_refs: string[];
};

export type ExistingFormRow = {
  ingredient_id: string | null;
  form_key: string | null;
  form_label?: string | null;
  relative_factor?: number | null;
  confidence?: number | null;
  evidence_grade?: string | null;
  audit_status?: string | null;
};

export const tierPriority: Record<SeedLayer, number> = {
  reviewed_package: 3,
  explicit_as_form: 2,
  unspecified_fallback: 1,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const toTitle = (value: string): string =>
  value
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");

export const normalizeFormKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/__+/g, "_");

export const normalizeSeedRow = (row: SeedRow): SeedRow | null => {
  if (!row.ingredient_id || !row.ingredient_id.trim()) return null;
  const normalizedFormKey = normalizeFormKey(row.form_key);
  if (!normalizedFormKey) return null;

  return {
    ...row,
    ingredient_id: row.ingredient_id.trim(),
    form_key: normalizedFormKey,
    form_label: row.form_label.trim() || toTitle(normalizedFormKey),
    confidence: clamp(row.confidence, 0, 1),
    source_refs: row.source_refs.filter((value) => typeof value === "string" && value.trim().length > 0),
  };
};

export const buildSeedKey = (row: Pick<SeedRow, "ingredient_id" | "form_key">): string =>
  `${row.ingredient_id}:${normalizeFormKey(row.form_key)}`;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const normalizeGrade = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
};

const normalizeAuditStatus = (value?: string | null): string =>
  (value ?? "").trim().toLowerCase();

// We avoid migrations in this workflow, so existing rows do not carry source_layer.
// Infer a conservative source tier from existing fields to allow safe upgrades only.
export const inferExistingLayer = (existing: ExistingFormRow): SeedLayer => {
  const formKey = normalizeFormKey(existing.form_key ?? "");
  if (!formKey || formKey === "unspecified") return "unspecified_fallback";

  if (normalizeAuditStatus(existing.audit_status) !== "verified") {
    return "unspecified_fallback";
  }

  const relativeFactor = isFiniteNumber(existing.relative_factor) ? existing.relative_factor : 1;
  const confidence = isFiniteNumber(existing.confidence) ? clamp(existing.confidence, 0, 1) : 0;
  const grade = normalizeGrade(existing.evidence_grade);

  if (relativeFactor !== 1 || grade === "A" || confidence >= 0.95) {
    return "reviewed_package";
  }
  return "explicit_as_form";
};

export const shouldUpgradeExistingRow = (incoming: SeedRow, existing: ExistingFormRow): boolean => {
  const incomingPriority = tierPriority[incoming.source_layer];
  const existingPriority = tierPriority[inferExistingLayer(existing)];
  return incomingPriority > existingPriority;
};

export const dedupeSeedRows = (rows: SeedRow[]): SeedRow[] => {
  const byKey = new Map<string, SeedRow>();
  rows.forEach((row) => {
    const normalized = normalizeSeedRow(row);
    if (!normalized) return;

    const key = buildSeedKey(normalized);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, normalized);
      return;
    }

    const existingPriority = tierPriority[existing.source_layer];
    const nextPriority = tierPriority[normalized.source_layer];
    if (nextPriority > existingPriority) {
      byKey.set(key, normalized);
      return;
    }

    if (nextPriority === existingPriority && normalized.confidence > existing.confidence) {
      byKey.set(key, normalized);
    }
  });

  return Array.from(byKey.values()).sort((a, b) => {
    const ingredientCompare = a.ingredient_id.localeCompare(b.ingredient_id);
    if (ingredientCompare !== 0) return ingredientCompare;
    const priorityCompare = tierPriority[b.source_layer] - tierPriority[a.source_layer];
    if (priorityCompare !== 0) return priorityCompare;
    return a.form_key.localeCompare(b.form_key);
  });
};

export const partitionSeedRowsByExisting = (
  rows: SeedRow[],
  existing:
    | Set<string>
    | Map<string, ExistingFormRow>,
): {
  skippedExisting: SeedRow[];
  skippedLowerPriority: SeedRow[];
  toInsert: SeedRow[];
  toUpdate: SeedRow[];
  toUpsert: SeedRow[];
} => {
  const skippedExisting: SeedRow[] = [];
  const skippedLowerPriority: SeedRow[] = [];
  const toInsert: SeedRow[] = [];
  const toUpdate: SeedRow[] = [];

  const hasExisting = (key: string): boolean =>
    existing instanceof Set ? existing.has(key) : existing.has(key);

  const getExistingRow = (key: string): ExistingFormRow | null => {
    if (existing instanceof Set) return null;
    return existing.get(key) ?? null;
  };

  rows.forEach((row) => {
    const key = buildSeedKey(row);
    if (!hasExisting(key)) {
      toInsert.push(row);
      return;
    }

    const existingRow = getExistingRow(key);
    if (existingRow && shouldUpgradeExistingRow(row, existingRow)) {
      toUpdate.push(row);
      return;
    }

    if (existingRow || existing instanceof Set) {
      skippedExisting.push(row);
      if (existingRow && !shouldUpgradeExistingRow(row, existingRow)) {
        skippedLowerPriority.push(row);
      }
      return;
    }

    toInsert.push(row);
  });

  return {
    skippedExisting,
    skippedLowerPriority,
    toInsert,
    toUpdate,
    toUpsert: [...toInsert, ...toUpdate],
  };
};
