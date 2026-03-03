import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  QualityMarkAuditEntry,
  QualityMarkCacheFile,
  QualityMarkLookupInput,
} from "./types.js";

const DEFAULT_TTL_DAYS = Number(process.env.QUALITY_MARK_CACHE_TTL_DAYS ?? 30);
const DEFAULT_CACHE_PATH = path.join(process.cwd(), "output", "quality_marks", "quality_mark_cache.json");
const DEFAULT_AUDIT_PATH = path.join(process.cwd(), "output", "quality_marks", "quality_mark_audit.json");
const CACHE_SCHEMA_VERSION = "quality_mark_cache.v1";

let memoized: { mtimeMs: number; payload: QualityMarkCacheFile } | null = null;

const normalizeText = (value: unknown): string => String(value ?? "").trim();
const normalizeKeyPart = (value: unknown): string =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const nowIso = () => new Date().toISOString();

export const getQualityMarkCachePath = (): string =>
  normalizeText(process.env.QUALITY_MARK_CACHE_PATH) || DEFAULT_CACHE_PATH;

export const getQualityMarkAuditPath = (): string =>
  normalizeText(process.env.QUALITY_MARK_AUDIT_PATH) || DEFAULT_AUDIT_PATH;

export const buildQualityMarkLookupKey = (input: QualityMarkLookupInput): string => {
  const sourceType = normalizeKeyPart(input.sourceType || "unknown");
  const identityType = normalizeKeyPart(input.identityType || "unknown");
  const identityValue = normalizeKeyPart(input.identityValue || "unknown");
  const brand = normalizeKeyPart(input.brandName || "unknown");
  const product = normalizeKeyPart(input.productName || "unknown");
  return `${sourceType}:${identityType}:${identityValue}:${brand}:${product}`;
};

export const buildQualityMarkFingerprint = (input: QualityMarkLookupInput): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        sourceType: normalizeText(input.sourceType),
        identityType: normalizeText(input.identityType),
        identityValue: normalizeText(input.identityValue),
        brandName: normalizeText(input.brandName),
        productName: normalizeText(input.productName),
      }),
    )
    .digest("hex");

const isValidStatus = (value: string): value is QualityMarkAuditEntry["status"] =>
  value === "detected" || value === "not_detected" || value === "unknown";

const isValidBucket = (value: string): value is QualityMarkAuditEntry["confidenceBucket"] =>
  value === "high" || value === "medium" || value === "low";

const defaultCachePayload = (): QualityMarkCacheFile => ({
  schemaVersion: CACHE_SCHEMA_VERSION,
  ttlDays: Number.isFinite(DEFAULT_TTL_DAYS) ? Math.max(1, Math.round(DEFAULT_TTL_DAYS)) : 30,
  updatedAt: nowIso(),
  entries: {},
});

const ensureDir = (filePath: string) => {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
};

const normalizeEntry = (raw: unknown): QualityMarkAuditEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const key = normalizeText(row.key);
  const status = normalizeText(row.status);
  const confidenceBucket = normalizeText(row.confidenceBucket);
  if (!key || !isValidStatus(status) || !isValidBucket(confidenceBucket)) return null;
  return {
    key,
    status,
    checked: Boolean(row.checked),
    confidence: typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : null,
    confidenceBucket,
    evidenceRef: normalizeText(row.evidenceRef) || null,
    evidenceType:
      normalizeText(row.evidenceType) === "page"
        ? "page"
        : normalizeText(row.evidenceType) === "search"
          ? "search"
          : null,
    checkedMode: normalizeText(row.checkedMode) === "page_fetch" ? "page_fetch" : "search_only",
    pagesFetchedCount:
      typeof row.pagesFetchedCount === "number" && Number.isFinite(row.pagesFetchedCount)
        ? Math.max(0, Math.floor(row.pagesFetchedCount))
        : 0,
    searchPagesFetchedCount:
      typeof row.searchPagesFetchedCount === "number" && Number.isFinite(row.searchPagesFetchedCount)
        ? Math.max(0, Math.floor(row.searchPagesFetchedCount))
        : 0,
    sourcesTried: Array.isArray(row.sourcesTried)
      ? row.sourcesTried.map((value) => normalizeText(value)).filter(Boolean).slice(0, 20)
      : [],
    sourcePriority: Array.isArray(row.sourcePriority)
      ? row.sourcePriority
          .map((value) => normalizeText(value))
          .filter((value): value is QualityMarkAuditEntry["sourcePriority"][number] =>
            value === "brand_official" || value === "retailer_marketplace" || value === "retailer_other",
          )
      : ["brand_official", "retailer_marketplace", "retailer_other"],
    checkedAt: normalizeText(row.checkedAt) || nowIso(),
    expiresAt: normalizeText(row.expiresAt) || nowIso(),
    error: normalizeText(row.error) || null,
  };
};

const parseCachePayload = (raw: unknown): QualityMarkCacheFile => {
  if (!raw || typeof raw !== "object") return defaultCachePayload();
  const obj = raw as Record<string, unknown>;
  const ttlDaysRaw = Number(obj.ttlDays);
  const payload: QualityMarkCacheFile = {
    schemaVersion: normalizeText(obj.schemaVersion) || CACHE_SCHEMA_VERSION,
    ttlDays: Number.isFinite(ttlDaysRaw) ? Math.max(1, Math.round(ttlDaysRaw)) : 30,
    updatedAt: normalizeText(obj.updatedAt) || nowIso(),
    entries: {},
  };
  const entries = obj.entries;
  if (entries && typeof entries === "object") {
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      const normalized = normalizeEntry({ ...(value as Record<string, unknown>), key });
      if (!normalized) continue;
      payload.entries[key] = normalized;
    }
  }
  return payload;
};

const readCacheFromDisk = (): QualityMarkCacheFile => {
  const cachePath = getQualityMarkCachePath();
  try {
    const stat = fs.statSync(cachePath);
    if (memoized && memoized.mtimeMs === stat.mtimeMs) return memoized.payload;
    const parsed = parseCachePayload(JSON.parse(fs.readFileSync(cachePath, "utf8")));
    memoized = { mtimeMs: stat.mtimeMs, payload: parsed };
    return parsed;
  } catch {
    const payload = defaultCachePayload();
    memoized = null;
    return payload;
  }
};

const isExpired = (entry: QualityMarkAuditEntry): boolean => {
  const expiresAt = Date.parse(entry.expiresAt);
  if (!Number.isFinite(expiresAt)) return true;
  return Date.now() > expiresAt;
};

export const lookupQualityMarkAudit = (
  input: QualityMarkLookupInput,
): { entry: QualityMarkAuditEntry | null; key: string } => {
  const key = buildQualityMarkLookupKey(input);
  const payload = readCacheFromDisk();
  const entry = payload.entries[key] ?? null;
  if (!entry || isExpired(entry)) return { entry: null, key };
  return { entry, key };
};

export const upsertQualityMarkAuditEntries = (entries: QualityMarkAuditEntry[]): void => {
  const cachePath = getQualityMarkCachePath();
  const payload = readCacheFromDisk();
  for (const row of entries) {
    payload.entries[row.key] = row;
  }
  payload.updatedAt = nowIso();
  ensureDir(cachePath);
  fs.writeFileSync(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  try {
    const stat = fs.statSync(cachePath);
    memoized = { mtimeMs: stat.mtimeMs, payload };
  } catch {
    memoized = null;
  }
};

export const writeQualityMarkAuditFile = (auditRows: Array<Record<string, unknown>>): void => {
  const auditPath = getQualityMarkAuditPath();
  ensureDir(auditPath);
  fs.writeFileSync(
    auditPath,
    `${JSON.stringify(
      {
        schemaVersion: "quality_mark_audit.v1",
        generatedAt: nowIso(),
        cachePath: getQualityMarkCachePath(),
        cacheTtlDays: Number.isFinite(DEFAULT_TTL_DAYS) ? Math.max(1, Math.round(DEFAULT_TTL_DAYS)) : 30,
        rows: auditRows,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
};
