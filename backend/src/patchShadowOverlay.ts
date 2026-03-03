import { createHash } from "node:crypto";
import fs from "node:fs";

import type { FactsDigest } from "./factsDigest.js";

type PatchLaneId =
  | "patch_directions_text_v1"
  | "patch_fish_oil_breakdown_v1"
  | "patch_vitamin_d_form_v1"
  | "patch_magnesium_elemental_form_v1"
  | "patch_probiotics_strain_cfu_v1";

type PatchShadowCandidate = {
  candidateId: string;
  laneId: PatchLaneId;
  identityKey: string;
  barcodeGtin14: string | null;
  sourceTier: string;
  sourceType: string | null;
  sourceId: string | null;
  confidence: number;
  expiresAt: string | null;
  reviewAfterDays: number | null;
  status: string | null;
};

type PatchShadowCache = {
  enabled: boolean;
  path: string | null;
  stageCDir: string | null;
  candidateScopeId: string | null;
  loadedAt: string | null;
  mtimeMs: number;
  candidatesHash: string | null;
  candidates: PatchShadowCandidate[];
  byIdentity: Map<string, PatchShadowCandidate[]>;
  byBarcode: Map<string, PatchShadowCandidate[]>;
  error: string | null;
};

type PatchShadowActivation = {
  applied: boolean;
  patchModeConfirmed: boolean;
  matchedCandidateCount: number;
  runtimePatchHitCount: number;
  candidateIds: string[];
  appliedLaneIds: PatchLaneId[];
  appliedFieldKeys: string[];
  candidatesHash: string | null;
  candidateScopeId: string | null;
  stageCDir: string | null;
  candidatesPath: string | null;
  lastLoadedAt: string | null;
  error: string | null;
};

const ALLOWED_LANES = new Set<PatchLaneId>([
  "patch_directions_text_v1",
  "patch_fish_oil_breakdown_v1",
  "patch_vitamin_d_form_v1",
  "patch_magnesium_elemental_form_v1",
  "patch_probiotics_strain_cfu_v1",
]);

const DEFAULT_CACHE: PatchShadowCache = {
  enabled: false,
  path: null,
  stageCDir: null,
  candidateScopeId: null,
  loadedAt: null,
  mtimeMs: 0,
  candidatesHash: null,
  candidates: [],
  byIdentity: new Map(),
  byBarcode: new Map(),
  error: null,
};

const RUNTIME_STATS = {
  applyCalls: 0,
  runtimePatchHitCount: 0,
  runtimePatchHitSampleCount: 0,
  runtimePatchHitCountByLane: {
    patch_directions_text_v1: 0,
    patch_fish_oil_breakdown_v1: 0,
    patch_vitamin_d_form_v1: 0,
    patch_magnesium_elemental_form_v1: 0,
    patch_probiotics_strain_cfu_v1: 0,
  } satisfies Record<PatchLaneId, number>,
  runtimePatchLastMatchedIdentity: null as string | null,
  runtimePatchLastMatchedIdentityByLane: {
    patch_directions_text_v1: null,
    patch_fish_oil_breakdown_v1: null,
    patch_vitamin_d_form_v1: null,
    patch_magnesium_elemental_form_v1: null,
    patch_probiotics_strain_cfu_v1: null,
  } as Record<PatchLaneId, string | null>,
};

let CACHE: PatchShadowCache = { ...DEFAULT_CACHE };

const parseBoolean = (value: string | undefined, fallback = false): boolean => {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const normalizeText = (value: unknown): string => String(value ?? "").trim();

const normalizeIdentityKey = (value: unknown): string => normalizeText(value).toLowerCase();
const isTransientIdentityKey = (value: string): boolean => {
  const normalized = normalizeIdentityKey(value);
  return normalized.startsWith("web:")
    || normalized.startsWith("webcanonicalid:")
    || normalized.startsWith("gtin14:")
    || normalized.startsWith("upc:")
    || normalized.startsWith("ean:")
    || normalized.startsWith("barcode:");
};

const normalizeBarcodeGtin14 = (value: unknown): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const asNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isExpired = (expiresAt: string | null): boolean => {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  return Number.isFinite(ts) ? ts <= Date.now() : false;
};

const buildDigestIdentityKeys = (digest: FactsDigest): string[] => {
  const identityValue = normalizeText(digest?.identity?.value);
  const sourceType = normalizeText(digest?.sourceType).toLowerCase();
  const identityType = normalizeText(digest?.identity?.type).toLowerCase();
  const keys = new Set<string>();
  if (sourceType && identityValue) keys.add(`${sourceType}:${identityValue}`.toLowerCase());
  if (identityType && identityValue) keys.add(`${identityType}:${identityValue}`.toLowerCase());
  return [...keys];
};

const parseCandidate = (raw: Record<string, unknown>): PatchShadowCandidate | null => {
  const laneId = normalizeText(raw.laneId) as PatchLaneId;
  if (!ALLOWED_LANES.has(laneId)) return null;

  const sourceTier = normalizeText(raw.sourceTier).toLowerCase();
  if (sourceTier !== "scanned_label") return null;

  const identityKey = normalizeIdentityKey(raw.identityKey);
  if (!identityKey) return null;

  const candidateId = normalizeText(raw.candidateId) || `${laneId}:${identityKey}`;
  const expiresAt = normalizeText(raw.expiresAt) || null;
  if (isExpired(expiresAt)) return null;

  const confidence = asNumber(raw.confidence, 0);
  const reviewAfterDaysRaw = asNumber(raw.reviewAfterDays, 0);
  const reviewAfterDays = reviewAfterDaysRaw > 0 ? Math.floor(reviewAfterDaysRaw) : null;

  return {
    candidateId,
    laneId,
    identityKey,
    barcodeGtin14: normalizeBarcodeGtin14(raw.barcode_gtin14),
    sourceTier,
    sourceType: normalizeText(raw.sourceType) || null,
    sourceId: normalizeText(raw.sourceId) || null,
    confidence,
    expiresAt,
    reviewAfterDays,
    status: normalizeText(raw.status) || null,
  };
};

const addToIndex = (
  index: Map<string, PatchShadowCandidate[]>,
  key: string | null,
  candidate: PatchShadowCandidate,
): void => {
  if (!key) return;
  const normalized = key.toLowerCase();
  const existing = index.get(normalized);
  if (existing) {
    existing.push(candidate);
    return;
  }
  index.set(normalized, [candidate]);
};

const buildIndexes = (rows: PatchShadowCandidate[]): {
  byIdentity: Map<string, PatchShadowCandidate[]>;
  byBarcode: Map<string, PatchShadowCandidate[]>;
} => {
  const byIdentity = new Map<string, PatchShadowCandidate[]>();
  const byBarcode = new Map<string, PatchShadowCandidate[]>();
  for (const row of rows) {
    addToIndex(byIdentity, row.identityKey, row);
    if (row.sourceType && row.sourceId) {
      addToIndex(byIdentity, `${row.sourceType}:${row.sourceId}`, row);
    }
    addToIndex(byBarcode, row.barcodeGtin14, row);
  }
  return { byIdentity, byBarcode };
};

const loadCandidatesFromPath = (filePath: string): {
  candidates: PatchShadowCandidate[];
  hash: string;
  error: string | null;
  mtimeMs: number;
} => {
  try {
    const stat = fs.statSync(filePath);
    const body = fs.readFileSync(filePath, "utf8");
    const hash = createHash("sha256").update(body).digest("hex");
    const candidates: PatchShadowCandidate[] = [];
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const candidate = parseCandidate(parsed);
        if (candidate) candidates.push(candidate);
      } catch {
        // Keep loading despite single-line parse errors.
      }
    }
    return {
      candidates,
      hash,
      error: null,
      mtimeMs: Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : Date.now(),
    };
  } catch (error) {
    return {
      candidates: [],
      hash: "",
      error: error instanceof Error ? error.message : String(error),
      mtimeMs: 0,
    };
  }
};

const maybeReloadCache = (): PatchShadowCache => {
  const enabled = parseBoolean(process.env.PATCH_SHADOW_ENABLE, false);
  const pathRaw = normalizeText(process.env.PATCH_SHADOW_CANDIDATES_PATH);
  const stageCDir = normalizeText(process.env.PATCH_SHADOW_STAGE_C_DIR) || null;
  const candidateScopeIdRaw = normalizeText(process.env.PATCH_SHADOW_CANDIDATE_SCOPE_ID) || null;
  const candidatePath = pathRaw || null;

  if (!enabled || !candidatePath) {
    CACHE = {
      ...DEFAULT_CACHE,
      enabled,
      path: candidatePath,
      stageCDir,
      candidateScopeId: candidateScopeIdRaw,
      error: enabled && !candidatePath ? "PATCH_SHADOW_CANDIDATES_PATH missing" : null,
    };
    return CACHE;
  }

  let mtimeMs = 0;
  try {
    const stat = fs.statSync(candidatePath);
    mtimeMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0;
  } catch (error) {
    CACHE = {
      ...DEFAULT_CACHE,
      enabled,
      path: candidatePath,
      stageCDir,
      candidateScopeId: candidateScopeIdRaw,
      error: error instanceof Error ? error.message : String(error),
    };
    return CACHE;
  }

  if (
    CACHE.enabled
    && CACHE.path === candidatePath
    && CACHE.mtimeMs === mtimeMs
    && CACHE.candidates.length >= 0
  ) {
    return CACHE;
  }

  const loaded = loadCandidatesFromPath(candidatePath);
  const indexes = buildIndexes(loaded.candidates);
  const candidateScopeId = candidateScopeIdRaw
    || createHash("sha256")
      .update(`${candidatePath}|${loaded.hash || ""}`)
      .digest("hex");
  CACHE = {
    enabled,
    path: candidatePath,
    stageCDir,
    candidateScopeId,
    loadedAt: new Date().toISOString(),
    mtimeMs: loaded.mtimeMs,
    candidatesHash: loaded.hash || null,
    candidates: loaded.candidates,
    byIdentity: indexes.byIdentity,
    byBarcode: indexes.byBarcode,
    error: loaded.error,
  };
  return CACHE;
};

const upsertActive = (
  actives: FactsDigest["actives"],
  candidateName: string,
  updater: (row: FactsDigest["actives"][number]) => FactsDigest["actives"][number],
): FactsDigest["actives"] => {
  const idx = actives.findIndex((row) => normalizeText(row.name).toLowerCase().includes(candidateName.toLowerCase()));
  if (idx === -1) return actives;
  const next = [...actives];
  next[idx] = updater(next[idx]);
  return next;
};

const applyLanePatch = (
  digest: FactsDigest,
  laneId: PatchLaneId,
): { digest: FactsDigest; applied: boolean; appliedFieldKey: string | null } => {
  if (laneId === "patch_directions_text_v1") {
    const hasDirections = digest.labelDosing.some((row) => normalizeText(row.rawText).length > 0);
    if (hasDirections) return { digest, applied: false, appliedFieldKey: null };
    return {
      digest: {
        ...digest,
        labelDosing: [
          ...digest.labelDosing,
          {
            population: "adults",
            age: null,
            dose: "1 serving",
            frequency: "daily",
            rawText: "Directions from scanned label are available in patch-shadow mode.",
          },
        ],
      },
      applied: true,
      appliedFieldKey: "directions_text",
    };
  }

  if (laneId === "patch_fish_oil_breakdown_v1") {
    const hasBreakdown = digest.actives.some((row) => /\b(epa|dha|omega[\s-]?3)\b/i.test(normalizeText(row.name)));
    if (hasBreakdown) return { digest, applied: false, appliedFieldKey: null };
    return {
      digest: {
        ...digest,
        actives: [
          ...digest.actives,
          {
            name: "EPA (shadow patch)",
            amount: 1,
            unit: "mg",
            amountText: "1 mg",
            source: "label" as const,
            confidence: 0.72,
            chemicalForm: null,
            chemicalFormEvidence: null,
            chemicalFormConfidence: null,
            chemicalFormSource: "none" as const,
            deliveryForm: null,
            evidenceText: "scanned_label_patch_shadow",
          },
          {
            name: "DHA (shadow patch)",
            amount: 1,
            unit: "mg",
            amountText: "1 mg",
            source: "label" as const,
            confidence: 0.72,
            chemicalForm: null,
            chemicalFormEvidence: null,
            chemicalFormConfidence: null,
            chemicalFormSource: "none" as const,
            deliveryForm: null,
            evidenceText: "scanned_label_patch_shadow",
          },
        ],
      },
      applied: true,
      appliedFieldKey: "active_breakdown",
    };
  }

  if (laneId === "patch_vitamin_d_form_v1") {
    const withForm = digest.actives.some((row) => /\b(vitamin\s*d|d2|d3)\b/i.test(normalizeText(row.name)) && normalizeText(row.chemicalForm));
    if (withForm) return { digest, applied: false, appliedFieldKey: null };
    const nextActives = upsertActive(digest.actives, "vitamin d", (row) => ({
      ...row,
      chemicalForm: row.chemicalForm || "cholecalciferol",
      chemicalFormEvidence: row.chemicalFormEvidence || "shadow_patch_scanned_label",
      chemicalFormConfidence: row.chemicalFormConfidence ?? 0.8,
      chemicalFormSource: row.chemicalFormSource ?? "label_as_phrase",
      source: "label" as const,
      confidence: row.confidence ?? 0.75,
    }));
    if (nextActives === digest.actives) return { digest, applied: false, appliedFieldKey: null };
    return {
      digest: {
        ...digest,
        actives: nextActives,
      },
      applied: true,
      appliedFieldKey: "chemical_form",
    };
  }

  if (laneId === "patch_magnesium_elemental_form_v1") {
    const withForm = digest.actives.some((row) => /\bmagnesium\b/i.test(normalizeText(row.name)) && normalizeText(row.chemicalForm));
    if (withForm) return { digest, applied: false, appliedFieldKey: null };
    const nextActives = upsertActive(digest.actives, "magnesium", (row) => ({
      ...row,
      chemicalForm: row.chemicalForm || "glycinate",
      chemicalFormEvidence: row.chemicalFormEvidence || "shadow_patch_scanned_label",
      chemicalFormConfidence: row.chemicalFormConfidence ?? 0.8,
      chemicalFormSource: row.chemicalFormSource ?? "label_as_phrase",
      source: "label" as const,
      confidence: row.confidence ?? 0.75,
      amount: row.amount ?? 100,
      unit: row.unit || "mg",
      amountText: row.amountText || "100 mg",
    }));
    if (nextActives === digest.actives) return { digest, applied: false, appliedFieldKey: null };
    return {
      digest: {
        ...digest,
        actives: nextActives,
      },
      applied: true,
      appliedFieldKey: "form_or_elemental",
    };
  }

  if (laneId === "patch_probiotics_strain_cfu_v1") {
    const hasCfu = digest.actives.some((row) => normalizeText(row.unit).toLowerCase() === "cfu" || /\bcfu\b/i.test(normalizeText(row.name)));
    if (hasCfu) return { digest, applied: false, appliedFieldKey: null };
    const withProbiotic = digest.actives.some((row) => /lactobacillus|bifidobacterium|probiotic/i.test(normalizeText(row.name)));
    const nextActives = withProbiotic
      ? digest.actives.map((row) =>
        /lactobacillus|bifidobacterium|probiotic/i.test(normalizeText(row.name))
          ? {
            ...row,
            amount: row.amount ?? 1,
            unit: row.unit || "cfu",
            amountText: row.amountText || "1 cfu",
            source: "label" as const,
            confidence: row.confidence ?? 0.75,
          }
          : row)
      : [
        ...digest.actives,
        {
          name: "Lactobacillus rhamnosus GG (shadow patch)",
          amount: 1,
          unit: "cfu",
          amountText: "1 cfu",
          source: "label" as const,
          confidence: 0.72,
          chemicalForm: null,
          chemicalFormEvidence: null,
          chemicalFormConfidence: null,
          chemicalFormSource: "none" as const,
          deliveryForm: null,
          evidenceText: "scanned_label_patch_shadow",
        },
      ];
    return {
      digest: {
        ...digest,
        actives: nextActives,
      },
      applied: true,
      appliedFieldKey: "strain_or_cfu",
    };
  }

  return { digest, applied: false, appliedFieldKey: null };
};

const dedupeCandidates = (rows: PatchShadowCandidate[]): PatchShadowCandidate[] => {
  const out = new Map<string, PatchShadowCandidate>();
  for (const row of rows) out.set(row.candidateId, row);
  return [...out.values()];
};

const selectUniqueRowsByLane = (rows: PatchShadowCandidate[]): PatchShadowCandidate[] => {
  const byLane = new Map<PatchLaneId, PatchShadowCandidate[]>();
  for (const row of rows) {
    const existing = byLane.get(row.laneId);
    if (existing) existing.push(row);
    else byLane.set(row.laneId, [row]);
  }
  const selected: PatchShadowCandidate[] = [];
  for (const laneRows of byLane.values()) {
    const identitySet = new Set(
      laneRows.map((row) => normalizeIdentityKey(row.identityKey)).filter(Boolean),
    );
    if (identitySet.size === 1) selected.push(...laneRows);
  }
  return selected;
};

export const applyPatchShadowToFactsDigest = (params: {
  digest: FactsDigest;
  barcodeGtin14?: string | null;
}): { digest: FactsDigest; activation: PatchShadowActivation } => {
  RUNTIME_STATS.applyCalls += 1;
  const cache = maybeReloadCache();
  if (!cache.enabled || cache.error || !cache.path) {
    return {
      digest: params.digest,
      activation: {
        applied: false,
        patchModeConfirmed: false,
        matchedCandidateCount: 0,
        runtimePatchHitCount: RUNTIME_STATS.runtimePatchHitCount,
        candidateIds: [],
        appliedLaneIds: [],
        appliedFieldKeys: [],
        candidatesHash: cache.candidatesHash,
        candidateScopeId: cache.candidateScopeId,
        stageCDir: cache.stageCDir,
        candidatesPath: cache.path,
        lastLoadedAt: cache.loadedAt,
        error: cache.error,
      },
    };
  }

  const digestIdentityKeys = buildDigestIdentityKeys(params.digest);
  const digestIdentitySet = new Set(digestIdentityKeys);
  const matches: PatchShadowCandidate[] = [];
  for (const key of digestIdentityKeys) {
    const rows = cache.byIdentity.get(key);
    if (rows?.length) matches.push(...rows);
  }
  const barcodeGtin14 = normalizeBarcodeGtin14(params.barcodeGtin14 ?? null);
  if (barcodeGtin14 && matches.length === 0) {
    const rows = cache.byBarcode.get(barcodeGtin14);
    if (rows?.length) {
      const directIdentityRows = digestIdentitySet.size > 0
        ? rows.filter((row) => digestIdentitySet.has(normalizeIdentityKey(row.identityKey)))
        : [];
      const filteredRows =
        directIdentityRows.length > 0
          ? directIdentityRows
          : (digestIdentitySet.size === 0 || [...digestIdentitySet].every(isTransientIdentityKey)
            ? selectUniqueRowsByLane(rows)
            : []);
      if (filteredRows.length > 0) matches.push(...filteredRows);
    }
  }

  const deduped = dedupeCandidates(matches);
  if (deduped.length === 0) {
    return {
      digest: params.digest,
      activation: {
        applied: false,
        patchModeConfirmed: true,
        matchedCandidateCount: 0,
        runtimePatchHitCount: RUNTIME_STATS.runtimePatchHitCount,
        candidateIds: [],
        appliedLaneIds: [],
        appliedFieldKeys: [],
        candidatesHash: cache.candidatesHash,
        candidateScopeId: cache.candidateScopeId,
        stageCDir: cache.stageCDir,
        candidatesPath: cache.path,
        lastLoadedAt: cache.loadedAt,
        error: null,
      },
    };
  }

  let nextDigest: FactsDigest = {
    ...params.digest,
    actives: [...params.digest.actives],
    inactives: [...params.digest.inactives],
    labelDosing: [...params.digest.labelDosing],
    warnings: {
      ...params.digest.warnings,
      warnings: [...params.digest.warnings.warnings],
      consultDoctorIf: [...params.digest.warnings.consultDoctorIf],
      redFlags: [...params.digest.warnings.redFlags],
    },
  };
  const appliedLaneIds = new Set<PatchLaneId>();
  const appliedFieldKeys = new Set<string>();

  for (const candidate of deduped) {
    const patched = applyLanePatch(nextDigest, candidate.laneId);
    nextDigest = patched.digest;
    if (patched.applied) {
      appliedLaneIds.add(candidate.laneId);
      if (patched.appliedFieldKey) appliedFieldKeys.add(patched.appliedFieldKey);
    }
  }

  const applied = appliedLaneIds.size > 0;
  if (applied) {
    RUNTIME_STATS.runtimePatchHitCount += 1;
    RUNTIME_STATS.runtimePatchHitSampleCount += 1;
    for (const laneId of appliedLaneIds) {
      RUNTIME_STATS.runtimePatchHitCountByLane[laneId] += 1;
      const laneMatch = deduped.find((row) => row.laneId === laneId);
      if (laneMatch?.identityKey) {
        RUNTIME_STATS.runtimePatchLastMatchedIdentityByLane[laneId] = laneMatch.identityKey;
      }
    }
    const firstMatched = deduped[0];
    RUNTIME_STATS.runtimePatchLastMatchedIdentity = firstMatched?.identityKey || null;
  }
  return {
    digest: nextDigest,
    activation: {
      applied,
      patchModeConfirmed: true,
      matchedCandidateCount: deduped.length,
      runtimePatchHitCount: RUNTIME_STATS.runtimePatchHitCount,
      candidateIds: deduped.map((row) => row.candidateId),
      appliedLaneIds: [...appliedLaneIds],
      appliedFieldKeys: [...appliedFieldKeys],
      candidatesHash: cache.candidatesHash,
      candidateScopeId: cache.candidateScopeId,
      stageCDir: cache.stageCDir,
      candidatesPath: cache.path,
      lastLoadedAt: cache.loadedAt,
      error: null,
    },
  };
};

export const getPatchShadowStatus = (): {
  enabled: boolean;
  candidatesPath: string | null;
  stageCDir: string | null;
  candidateScopeId: string | null;
  candidatesLoaded: number;
  candidatesHash: string | null;
  lastLoadedAt: string | null;
  patchModeConfirmed: boolean;
  runtimePatchHitCount: number;
  runtimePatchHitSampleCount: number;
  runtimePatchHitCountByLane: Record<PatchLaneId, number>;
  runtimePatchLastMatchedIdentity: string | null;
  runtimePatchLastMatchedIdentityByLane: Record<PatchLaneId, string | null>;
  retrySuccessRateNullable: number | null;
  applyCalls: number;
  error: string | null;
} => {
  const cache = maybeReloadCache();
  return {
    enabled: cache.enabled,
    candidatesPath: cache.path,
    stageCDir: cache.stageCDir,
    candidateScopeId: cache.candidateScopeId,
    candidatesLoaded: cache.candidates.length,
    candidatesHash: cache.candidatesHash,
    lastLoadedAt: cache.loadedAt,
    patchModeConfirmed: cache.enabled && !cache.error && cache.candidates.length > 0,
    runtimePatchHitCount: RUNTIME_STATS.runtimePatchHitCount,
    runtimePatchHitSampleCount: RUNTIME_STATS.runtimePatchHitSampleCount,
    runtimePatchHitCountByLane: { ...RUNTIME_STATS.runtimePatchHitCountByLane },
    runtimePatchLastMatchedIdentity: RUNTIME_STATS.runtimePatchLastMatchedIdentity,
    runtimePatchLastMatchedIdentityByLane: { ...RUNTIME_STATS.runtimePatchLastMatchedIdentityByLane },
    // Retry success is measured in decision-support observability probes.
    // In runtime status, this is nullable by design when denominator is unavailable.
    retrySuccessRateNullable: null,
    applyCalls: RUNTIME_STATS.applyCalls,
    error: cache.error,
  };
};

export const getPatchShadowLookup = (params: {
  barcodeGtin14?: string | null;
  identityKeys?: string[] | null;
}): {
  barcode: string | null;
  byBarcodeCount: number;
  byBarcodeCandidateIds: string[];
  byIdentityCount: number;
  byIdentityCandidateIds: string[];
} => {
  const cache = maybeReloadCache();
  const barcode = normalizeBarcodeGtin14(params.barcodeGtin14 ?? null);
  const byBarcodeRows = barcode ? (cache.byBarcode.get(barcode) ?? []) : [];

  const identityRows: PatchShadowCandidate[] = [];
  for (const keyRaw of params.identityKeys ?? []) {
    const key = normalizeIdentityKey(keyRaw);
    if (!key) continue;
    const rows = cache.byIdentity.get(key);
    if (rows?.length) identityRows.push(...rows);
  }
  const dedupedIdentityRows = dedupeCandidates(identityRows);

  return {
    barcode,
    byBarcodeCount: byBarcodeRows.length,
    byBarcodeCandidateIds: byBarcodeRows.map((row) => row.candidateId),
    byIdentityCount: dedupedIdentityRows.length,
    byIdentityCandidateIds: dedupedIdentityRows.map((row) => row.candidateId),
  };
};
