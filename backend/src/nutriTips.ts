import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type NutriTipSource = {
  title: string;
  url: string;
  publisher: string;
  regions: string[];
};

export type NutriTip = {
  id: string;
  title: string;
  coverText: string;
  detailMarkdown: string;
  pillar: string;
  pillarKey: string;
  riskLevel: string;
  evidenceLevel: string;
  evidenceType: string;
  jurisdictionScope: string;
  lastReviewed: string;
  primaryActionType: string;
  reviewCadenceDays: number;
  supplement: string;
  supplementKey: string;
  sources: NutriTipSource[];
  cautions: string[];
  tags: string[];
};

export type NutriTipRotation = {
  method: string;
  indexFormula: string;
  epoch: string;
  notes?: string;
};

export type NutriTipCadenceSlot = {
  day: number;
  pillarKey: string;
};

export type NutriTipRotationAdvanced = {
  method: string;
  epoch: string;
  notes?: string;
  cadencePattern7Days: NutriTipCadenceSlot[];
  selectionFormula: string;
  requiresClientImplementation: boolean;
};

export type NutriTipRegionProfile = {
  marketName: string;
  regulator: string;
  regulatorNote: string;
  labelIdentifiersNote: string;
  adverseEventReportingHint: string;
};

export type NutriTipsData = {
  name: string;
  version: string;
  generatedAtUTC: string;
  tipsCount: number;
  defaultRegion: string;
  supportedRegions: string[];
  regionProfiles: Record<string, NutriTipRegionProfile>;
  rotation: NutriTipRotation;
  rotationAdvanced?: NutriTipRotationAdvanced;
  disclaimerShort: string;
  disclaimerFull: string;
  tips: NutriTip[];
};

const dataPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "nutri-tips.json",
);

let cachedTips: NutriTipsData | null = null;

export const getNutriTipsData = async (): Promise<NutriTipsData> => {
  if (cachedTips) {
    return cachedTips;
  }

  const raw = await readFile(dataPath, "utf8");
  cachedTips = JSON.parse(raw) as NutriTipsData;
  return cachedTips;
};
