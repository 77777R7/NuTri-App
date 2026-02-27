import type { SupplementSnapshot } from "./schemas/supplementSnapshot.js";
import type { AuthorityCandidate, AuthorityMapStatus } from "./authorityCandidate.js";

export type NpnCandidateSourceKind =
  | "lnhpd_record"
  | "label_record"
  | "db_barcode_regulatory_map_npn"
  | "snapshot_regulatory"
  | "scan_history"
  | "name_match"
  | "web_extract";

export type NpnCandidateStableReason = "verified_record" | "stable_db" | "unverified";

export type NpnCandidate = {
  value: string;
  sourceKind: NpnCandidateSourceKind;
  confidence: number;
  stableReason: NpnCandidateStableReason;
};

type RegulatoryMapRow = {
  npn: string;
  confidence: number;
  source: string;
  expires_at: string | null;
};

type BuildNpnCandidatesParams = {
  regulatoryMap: RegulatoryMapRow | null;
  mapStatus: AuthorityMapStatus;
  mapMinConfidence: number;
  authorityCandidate: AuthorityCandidate | null;
  snapshot: SupplementSnapshot | null;
  historicalNpn?: string | null;
  nameMatchNpn?: string | null;
  webTexts?: string[] | null;
  maxCandidates?: number;
};

const clampConfidence = (value: number | null | undefined): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return Math.round(num * 1000) / 1000;
};

const stableRank = (value: NpnCandidateStableReason): number => {
  if (value === "verified_record") return 3;
  if (value === "stable_db") return 2;
  return 1;
};

const sourcePriority = (value: NpnCandidateSourceKind): number => {
  switch (value) {
    case "lnhpd_record":
      return 7;
    case "label_record":
      return 6;
    case "db_barcode_regulatory_map_npn":
      return 5;
    case "snapshot_regulatory":
      return 4;
    case "scan_history":
      return 3;
    case "name_match":
      return 2;
    case "web_extract":
      return 1;
    default:
      return 0;
  }
};

export const normalizeNpnValue = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, "").trim();
  if (digits.length < 6 || digits.length > 10) return null;
  return digits;
};

const normalizeNpnWebExtract = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, "").trim();
  return digits.length === 8 ? digits : null;
};

const parseWebNpnCandidates = (texts: string[] | null | undefined): string[] => {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const found = new Set<string>();
  const patterns = [
    /\bnpn\b[^0-9]{0,12}(\d{8})/gi,
    /(\d{8})[^a-z0-9]{0,12}\bnpn\b/gi,
  ];
  for (const text of texts) {
    if (typeof text !== "string") continue;
    const normalizedText = text.toLowerCase();
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match = pattern.exec(normalizedText);
      while (match) {
        const normalized = normalizeNpnWebExtract(match[1] ?? null);
        if (normalized) found.add(normalized);
        match = pattern.exec(normalizedText);
      }
    }
  }
  return [...found];
};

const isBetterCandidate = (next: NpnCandidate, prev: NpnCandidate): boolean => {
  const stableDiff = stableRank(next.stableReason) - stableRank(prev.stableReason);
  if (stableDiff !== 0) return stableDiff > 0;
  const confidenceDiff = next.confidence - prev.confidence;
  if (Math.abs(confidenceDiff) > 0.0001) return confidenceDiff > 0;
  const sourceDiff = sourcePriority(next.sourceKind) - sourcePriority(prev.sourceKind);
  if (sourceDiff !== 0) return sourceDiff > 0;
  return false;
};

const toSortedCandidates = (map: Map<string, NpnCandidate>, maxCandidates: number): NpnCandidate[] =>
  [...map.values()]
    .sort((a, b) => {
      const stableDiff = stableRank(b.stableReason) - stableRank(a.stableReason);
      if (stableDiff !== 0) return stableDiff;
      const confidenceDiff = b.confidence - a.confidence;
      if (Math.abs(confidenceDiff) > 0.0001) return confidenceDiff > 0 ? 1 : -1;
      const sourceDiff = sourcePriority(b.sourceKind) - sourcePriority(a.sourceKind);
      if (sourceDiff !== 0) return sourceDiff;
      return a.value.localeCompare(b.value);
    })
    .slice(0, Math.max(1, maxCandidates))
    .map((item) => ({
      value: item.value,
      sourceKind: item.sourceKind,
      confidence: clampConfidence(item.confidence),
      stableReason: item.stableReason,
    }));

export const buildNpnCandidates = (params: BuildNpnCandidatesParams): NpnCandidate[] => {
  const maxCandidates = Number.isFinite(Number(params.maxCandidates))
    ? Math.max(1, Number(params.maxCandidates))
    : 3;
  const byValue = new Map<string, NpnCandidate>();

  const upsert = (candidate: NpnCandidate | null) => {
    if (!candidate) return;
    const normalized = normalizeNpnValue(candidate.value);
    if (!normalized) return;
    const next: NpnCandidate = {
      ...candidate,
      value: normalized,
      confidence: clampConfidence(candidate.confidence),
    };
    const existing = byValue.get(normalized);
    if (!existing || isBetterCandidate(next, existing)) {
      byValue.set(normalized, next);
    }
  };

  const mapNpn = normalizeNpnValue(params.regulatoryMap?.npn ?? null);
  if (mapNpn) {
    const confidence = clampConfidence(params.regulatoryMap?.confidence ?? null);
    upsert({
      value: mapNpn,
      sourceKind: "db_barcode_regulatory_map_npn",
      confidence,
      stableReason:
        params.mapStatus !== "miss" && confidence >= params.mapMinConfidence
          ? "stable_db"
          : "unverified",
    });
  }

  const authority = params.authorityCandidate;
  if (authority) {
    const sourceKind: NpnCandidateSourceKind =
      authority.source === "map" || authority.source === "map_stale"
        ? "db_barcode_regulatory_map_npn"
        : authority.source === "snapshot"
          ? "snapshot_regulatory"
          : authority.source === "scan_history"
            ? "scan_history"
            : authority.source === "name_match"
              ? "name_match"
              : "snapshot_regulatory";
    const stableReason: NpnCandidateStableReason =
      authority.source === "map" || authority.source === "map_stale"
        ? "stable_db"
        : sourceKind === "snapshot_regulatory" &&
            params.snapshot?.regulatory?.npnStatus === "verified"
          ? "verified_record"
          : "unverified";
    upsert({
      value: authority.npn,
      sourceKind,
      confidence: clampConfidence(authority.confidence ?? null),
      stableReason,
    });
  }

  const snapshotNpn = normalizeNpnValue(params.snapshot?.regulatory?.npn ?? null);
  if (snapshotNpn) {
    const verified = params.snapshot?.regulatory?.npnStatus === "verified";
    const sourceKind: NpnCandidateSourceKind =
      params.snapshot?.regulatory?.npnVerifiedBy === "lnhpd_fetch"
        ? "lnhpd_record"
        : "label_record";
    upsert({
      value: snapshotNpn,
      sourceKind: verified ? sourceKind : "snapshot_regulatory",
      confidence: verified ? (sourceKind === "lnhpd_record" ? 0.98 : 0.9) : 0.55,
      stableReason: verified ? "verified_record" : "unverified",
    });
  }

  const historicalNpn = normalizeNpnValue(params.historicalNpn ?? null);
  if (historicalNpn) {
    upsert({
      value: historicalNpn,
      sourceKind: "scan_history",
      confidence: 0.7,
      stableReason: "unverified",
    });
  }

  const nameMatchNpn = normalizeNpnValue(params.nameMatchNpn ?? null);
  if (nameMatchNpn) {
    upsert({
      value: nameMatchNpn,
      sourceKind: "name_match",
      confidence: 0.72,
      stableReason: "unverified",
    });
  }

  const webCandidates = parseWebNpnCandidates(params.webTexts ?? null);
  for (const value of webCandidates) {
    upsert({
      value,
      sourceKind: "web_extract",
      confidence: 0.35,
      stableReason: "unverified",
    });
  }

  return toSortedCandidates(byValue, maxCandidates);
};

