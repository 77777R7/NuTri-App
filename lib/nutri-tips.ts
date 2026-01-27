import type { NutriTip, NutriTipsData, NutriTipRegionProfile } from './api-client';

export type NutriTipSelection = {
  tip: NutriTip;
  region: string;
  regionProfile: NutriTipRegionProfile;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const REGION_ALIASES: Record<string, string> = {
  us: 'US',
  usa: 'US',
  unitedstates: 'US',
  unitedstatesofamerica: 'US',
  ca: 'CA',
  canada: 'CA',
};

const normalizeRegionInput = (value?: string | null) => {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized === 'US' || normalized === 'CA') return normalized;

  const key = normalized.toLowerCase().replace(/[^a-z]/g, '');
  return REGION_ALIASES[key] ?? null;
};

const resolveRegion = (data: NutriTipsData, input?: string | null) => {
  const supported = new Set(data.supportedRegions ?? []);
  const direct = input && supported.has(input) ? input : null;
  const normalized = normalizeRegionInput(input);
  const normalizedSupported = normalized && supported.has(normalized) ? normalized : null;

  const fallback = supported.has(data.defaultRegion)
    ? data.defaultRegion
    : data.supportedRegions?.[0] ?? 'GLOBAL';

  const region = direct ?? normalizedSupported ?? fallback;
  const profile = data.regionProfiles?.[region] ?? data.regionProfiles?.GLOBAL;
  return { region, profile };
};

const parseEpoch = (epoch: string) => {
  const parts = epoch.split('-').map(Number);
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    const [year, month, day] = parts;
    return new Date(year, month - 1, day);
  }
  return new Date(1970, 0, 1);
};

const daysSinceEpoch = (date: Date, epoch: string) => {
  const localStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const epochStart = parseEpoch(epoch);
  return Math.floor((localStart.getTime() - epochStart.getTime()) / DAY_MS);
};

const mod = (value: number, modulus: number) => ((value % modulus) + modulus) % modulus;

const filterTipsByRegion = (tips: NutriTip[], region: string) => {
  if (!region || region === 'GLOBAL') return tips;
  return tips.filter(tip => {
    switch (tip.jurisdictionScope) {
      case 'global':
      case 'mixed':
        return true;
      case 'us':
        return region === 'US';
      case 'canada':
        return region === 'CA';
      default:
        return true;
    }
  });
};

const findNextNonHigh = (tips: NutriTip[], startIndex: number) => {
  if (tips.length === 0) return null;
  for (let offset = 1; offset < tips.length; offset += 1) {
    const candidate = tips[mod(startIndex + offset, tips.length)];
    if (candidate.riskLevel !== 'high') {
      return candidate;
    }
  }
  return null;
};

export const selectDailyTip = (
  data: NutriTipsData,
  date: Date,
  regionInput?: string | null,
): NutriTipSelection | null => {
  if (!data.tips || data.tips.length === 0) return null;

  const { region, profile } = resolveRegion(data, regionInput);
  const regionTips = filterTipsByRegion(data.tips, region);
  const tips = regionTips.length > 0 ? regionTips : data.tips;
  const rotation = data.rotation;
  const rotationAdvanced = data.rotationAdvanced;

  const selectTipForDay = (dayIndex: number, guardHigh: boolean): NutriTip => {
    if (!rotationAdvanced?.cadencePattern7Days?.length) {
      const index = mod(dayIndex, tips.length);
      return tips[index];
    }

    const pattern = rotationAdvanced.cadencePattern7Days;
    const slotIndex = mod(dayIndex, pattern.length);
    const bucketKey = pattern[slotIndex]?.pillarKey ?? pattern[0]?.pillarKey;
    const bucketTips = tips.filter(tip => tip.pillarKey === bucketKey);
    const baseTips = bucketTips.length > 0 ? bucketTips : tips;

    const occurrencesPerWeek = Math.max(
      1,
      pattern.filter(slot => slot.pillarKey === bucketKey).length,
    );
    const occurrencesBefore = pattern
      .slice(0, slotIndex)
      .filter(slot => slot.pillarKey === bucketKey).length;

    const k = Math.floor(dayIndex / pattern.length) * occurrencesPerWeek + occurrencesBefore;
    const baseIndex = mod(k, baseTips.length);
    let tip = baseTips[baseIndex];

    if (guardHigh && tip.riskLevel === 'high') {
      const yesterdayTip = selectTipForDay(dayIndex - 1, false);
      if (yesterdayTip?.riskLevel === 'high') {
        const next = findNextNonHigh(baseTips, baseIndex);
        if (next) {
          tip = next;
        }
      }
    }

    return tip;
  };

  const dayIndex = daysSinceEpoch(date, rotationAdvanced?.epoch ?? rotation?.epoch ?? '1970-01-01');
  const tip = selectTipForDay(dayIndex, Boolean(rotationAdvanced?.requiresClientImplementation));

  if (!profile) {
    return null;
  }

  return { tip, region, regionProfile: profile };
};
