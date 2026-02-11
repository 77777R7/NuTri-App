export type RegulatoryMapStatus = "hit" | "stale" | "miss" | "timeout";

export const buildEnsureOverviewInflightKey = (
  supplementId: string,
  factsDigestHash: string,
): string => `${supplementId}:${factsDigestHash}`;

export const isRegulatoryMapMiss = (status: RegulatoryMapStatus): boolean =>
  status === "miss" || status === "timeout";

