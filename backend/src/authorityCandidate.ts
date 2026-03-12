import type { SupplementSnapshot } from "./schemas/supplementSnapshot.js";

export type AuthorityMapStatus = "hit" | "stale" | "miss";

export type AuthorityCandidate = {
  npn: string;
  source: "map" | "map_stale" | "snapshot" | "scan_history" | "name_match";
  isStale: boolean;
  requiresGuardrail: boolean;
  confidence: number | null;
};

type RegulatoryMapRow = {
  npn: string;
  confidence: number;
  source: string;
  expires_at: string | null;
};

type ResolveAuthorityCandidateParams = {
  regulatoryMap: RegulatoryMapRow | null;
  snapshot: SupplementSnapshot | null;
  mapMinConfidence: number;
  staleWindowMs: number;
  historicalNpn?: string | null;
  allowLnhpd?: boolean;
  nowMs?: number;
};

const isExpiredAt = (value: string | null | undefined, nowMs: number): boolean => {
  if (!value) return false;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return false;
  return ms <= nowMs;
};

const normalizeNpn = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, "").trim();
  if (digits.length < 6 || digits.length > 10) return null;
  return digits;
};

export const resolveAuthorityCandidate = (
  params: ResolveAuthorityCandidateParams,
): { candidate: AuthorityCandidate | null; mapStatus: AuthorityMapStatus } => {
  const nowMs = Number.isFinite(params.nowMs) ? Number(params.nowMs) : Date.now();
  const allowLnhpd = params.allowLnhpd !== false;
  const mapRow = params.regulatoryMap;
  let mapStatus: AuthorityMapStatus = "miss";
  let mapCandidate: AuthorityCandidate | null = null;

  if (allowLnhpd && mapRow && mapRow.npn) {
    const mapNpn = normalizeNpn(mapRow.npn);
    if (mapNpn) {
      const expired = isExpiredAt(mapRow.expires_at, nowMs);
      mapStatus = expired ? "stale" : "hit";
      const isConflict = mapRow.source === "conflict";
      const hasMinConfidence =
        Number.isFinite(mapRow.confidence) && mapRow.confidence >= params.mapMinConfidence;
      if (!isConflict && hasMinConfidence) {
        if (!expired) {
          mapCandidate = {
            npn: mapNpn,
            source: "map",
            isStale: false,
            requiresGuardrail: false,
            confidence: mapRow.confidence,
          };
        } else if (mapRow.expires_at) {
          const expiresMs = Date.parse(mapRow.expires_at);
          const withinWindow = Number.isFinite(expiresMs) && nowMs - expiresMs <= params.staleWindowMs;
          const isHighConfidence =
            mapRow.source === "lnhpd" || mapRow.source === "snapshot_verified" || mapRow.confidence >= 0.9;
          if (withinWindow && isHighConfidence) {
            mapCandidate = {
              npn: mapNpn,
              source: "map_stale",
              isStale: true,
              requiresGuardrail: true,
              confidence: mapRow.confidence,
            };
          }
        }
      }
    }
  }

  if (mapCandidate) {
    return { candidate: mapCandidate, mapStatus };
  }

  const snapshotNpn = allowLnhpd ? normalizeNpn(params.snapshot?.regulatory?.npn ?? null) : null;
  const snapshotVerified =
    params.snapshot?.regulatory?.npnStatus === "verified" &&
    params.snapshot?.regulatory?.npnVerifiedBy === "lnhpd_fetch";
  if (snapshotNpn && snapshotVerified) {
    return {
      candidate: {
        npn: snapshotNpn,
        source: "snapshot",
        isStale: true,
        requiresGuardrail: true,
        confidence: 0.9,
      },
      mapStatus,
    };
  }

  const historicalNpn = allowLnhpd ? normalizeNpn(params.historicalNpn ?? null) : null;
  if (historicalNpn) {
    return {
      candidate: {
        npn: historicalNpn,
        source: "scan_history",
        isStale: true,
        requiresGuardrail: false,
        confidence: 0.85,
      },
      mapStatus,
    };
  }

  return { candidate: null, mapStatus };
};
