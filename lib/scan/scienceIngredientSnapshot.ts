type CandidateSource = 'decision_overview' | 'science_snapshot' | 'ingredients_items' | 'record_facts';

export type ScienceIngredientCandidate = {
  name?: string | null;
  dose?: string | null;
  source: CandidateSource;
};

export type ScienceIngredientRow = {
  key: string;
  name: string;
  baseName: string;
  dose: string | null;
  formValue: string | null;
};

export const normalizeIngredientNameForSnapshot = (value?: string | null): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const withoutSourceTag = raw.split(/\s+·\s+/)[0] ?? raw;
  const withoutDoseDash = withoutSourceTag.split(/\s+[—–-]\s+/)[0] ?? withoutSourceTag;
  return withoutDoseDash
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
};

const normalizeText = (value?: string | null): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const stripTrailingSentencePunctuation = (value: string): string => value.replace(/[.!?]+$/g, '').trim();

const titleCaseLeadWord = (value: string): string => {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
};

export const parseIngredientNameWithForm = (
  raw: string,
): {
  baseName: string;
  form: string | null;
  displayName: string;
  formValue: string | null;
  aliasNames: string[];
} => {
  const normalizedRaw = stripTrailingSentencePunctuation(normalizeText(raw));
  if (!normalizedRaw) {
    return { baseName: '', form: null, displayName: '', formValue: null, aliasNames: [] };
  }

  const normalizeAliasToken = (value?: string | null): string =>
    normalizeText(value)
      .replace(/[®™]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const collectTrailingAliases = (tail?: string | null): string[] => {
    const aliases: string[] = [];
    let rest = normalizeText(tail);
    while (rest) {
      const match = rest.match(/^\(([^)]+)\)\s*(.*)$/);
      if (!match?.[1]) break;
      const alias = normalizeAliasToken(match[1]);
      if (alias && !/^(as|from)\b/i.test(alias)) aliases.push(alias);
      rest = normalizeText(match[2]);
    }
    return Array.from(new Set(aliases));
  };

  const parentheticalWithTail = normalizedRaw.match(/^(.*?)\s*\((as|from)\s+([^)]+)\)\s*(.*)$/i);
  if (parentheticalWithTail?.[1] && parentheticalWithTail[2] && parentheticalWithTail[3] != null) {
    const baseName = normalizeText(parentheticalWithTail[1]);
    const formValue = normalizeAliasToken(parentheticalWithTail[3]);
    const prefix = titleCaseLeadWord(normalizeText(parentheticalWithTail[2]));
    const form = formValue ? `${prefix} ${formValue}` : null;
    if (baseName && form && formValue) {
      return {
        baseName,
        form,
        displayName: `${baseName} (${form})`,
        formValue,
        aliasNames: collectTrailingAliases(parentheticalWithTail[4]),
      };
    }
  }

  const trailingPhrase = normalizedRaw.match(/\b(as|from)\s+([^,;]+)$/i);
  if (trailingPhrase?.index != null && trailingPhrase[1] && trailingPhrase[2]) {
    const baseName = normalizeText(normalizedRaw.slice(0, trailingPhrase.index));
    const formValue = normalizeAliasToken(trailingPhrase[2]);
    const prefix = titleCaseLeadWord(normalizeText(trailingPhrase[1]));
    const form = formValue ? `${prefix} ${formValue}` : null;
    if (baseName && form && formValue) {
      return {
        baseName,
        form,
        displayName: `${baseName} (${form})`,
        formValue,
        aliasNames: [],
      };
    }
  }

  const baseWithAliases = normalizedRaw.match(/^(.*?)\s*(\(.+\))$/);
  if (baseWithAliases?.[1] && baseWithAliases[2]) {
    const baseName = normalizeText(baseWithAliases[1]);
    const aliases = collectTrailingAliases(baseWithAliases[2]);
    if (baseName && aliases.length > 0) {
      return {
        baseName,
        form: null,
        displayName: baseName,
        formValue: null,
        aliasNames: aliases,
      };
    }
  }

  return {
    baseName: normalizedRaw,
    form: null,
    displayName: normalizedRaw,
    formValue: null,
    aliasNames: [],
  };
};

const SOURCE_PRIORITY: Record<CandidateSource, number> = {
  science_snapshot: 4,
  decision_overview: 3,
  ingredients_items: 2,
  record_facts: 1,
};

const hasNumericDoseSignal = (dose: string | null): boolean => {
  if (!dose) return false;
  const normalized = normalizeText(dose).toLowerCase();
  if (!/\d/.test(normalized)) return false;
  return /\b(mcg|µg|μg|mg|g|iu|cfu|billion|million)\b/.test(normalized);
};

const normalizeDose = (value?: string | null): string | null => {
  const normalized = stripTrailingSentencePunctuation(normalizeText(value));
  return normalized.length > 0 ? normalized : null;
};

const chooseBetterDose = (
  current: { dose: string | null; source: CandidateSource },
  incoming: { dose: string | null; source: CandidateSource },
): boolean => {
  const currentDose = normalizeDose(current.dose);
  const incomingDose = normalizeDose(incoming.dose);
  const currentHasDose = Boolean(currentDose);
  const incomingHasDose = Boolean(incomingDose);
  if (!currentHasDose && incomingHasDose) return true;
  if (currentHasDose && !incomingHasDose) return false;
  if (!currentHasDose && !incomingHasDose) return false;

  const currentNumeric = hasNumericDoseSignal(currentDose);
  const incomingNumeric = hasNumericDoseSignal(incomingDose);
  if (currentNumeric !== incomingNumeric) return incomingNumeric;

  const currentSourcePriority = SOURCE_PRIORITY[current.source] ?? 0;
  const incomingSourcePriority = SOURCE_PRIORITY[incoming.source] ?? 0;
  if (incomingSourcePriority !== currentSourcePriority) {
    return incomingSourcePriority > currentSourcePriority;
  }

  return String(incomingDose).length > String(currentDose).length;
};

const omegaRank = (name: string): number => {
  const normalized = normalizeText(name).toLowerCase();
  if (/\btotal\b.*\bomega\s*-?\s*3\b|\bomega\s*-?\s*3\b/.test(normalized)) return 0;
  if (/\bepa\b|eicosapentaenoic/.test(normalized)) return 1;
  if (/\bdha\b|docosahexaenoic/.test(normalized)) return 2;
  if (/\bfish\s*oil\b|\bkrill\s*oil\b|\bpollock\b/.test(normalized)) return 3;
  return 10;
};

export const mergeScienceIngredientCandidates = (params: {
  candidates: ScienceIngredientCandidate[];
  maxCoverItems?: number;
}): { all: ScienceIngredientRow[]; top3: ScienceIngredientRow[]; overflowCount: number } => {
  const maxCoverItems = Number.isFinite(params.maxCoverItems) ? Math.max(1, Number(params.maxCoverItems)) : 3;
  const merged = new Map<string, ScienceIngredientRow & { source: CandidateSource }>();
  const aliasToCanonical = new Map<string, string>();

  for (const candidate of params.candidates) {
    const rawName = normalizeText(candidate?.name);
    if (!rawName) continue;
    const parsed = parseIngredientNameWithForm(rawName);
    const baseName = normalizeText(parsed.baseName);
    if (!baseName) continue;
    const key = normalizeIngredientNameForSnapshot(baseName);
    if (!key) continue;
    const aliasKeys = parsed.aliasNames
      .map((alias) => normalizeIngredientNameForSnapshot(alias))
      .filter((alias): alias is string => alias.length > 0 && alias !== key);
    const lookupKeys = [key, ...aliasKeys];
    let canonicalKey = '';
    for (const lookupKey of lookupKeys) {
      if (merged.has(lookupKey)) {
        canonicalKey = lookupKey;
        break;
      }
      const mapped = aliasToCanonical.get(lookupKey);
      if (mapped && merged.has(mapped)) {
        canonicalKey = mapped;
        break;
      }
    }
    if (!canonicalKey) canonicalKey = key;
    for (const aliasKey of lookupKeys) aliasToCanonical.set(aliasKey, canonicalKey);
    const incomingDose = normalizeDose(candidate?.dose);

    const existing = merged.get(canonicalKey);
    if (!existing) {
      merged.set(canonicalKey, {
        key: canonicalKey,
        name: parsed.displayName || baseName,
        baseName,
        dose: incomingDose,
        formValue: parsed.formValue,
        source: candidate.source,
      });
      continue;
    }

    if (!existing.formValue && parsed.formValue) {
      existing.name = parsed.displayName || existing.name;
      existing.formValue = parsed.formValue;
    }

    const existingNameSourcePriority = SOURCE_PRIORITY[existing.source] ?? 0;

    if (
      chooseBetterDose(
        { dose: existing.dose, source: existing.source },
        { dose: incomingDose, source: candidate.source },
      )
    ) {
      existing.dose = incomingDose;
      existing.source = candidate.source;
    }

    const incomingName = parsed.displayName || baseName;
    const incomingSourcePriority = SOURCE_PRIORITY[candidate.source] ?? 0;
    if (
      !existing.name
      || incomingSourcePriority > existingNameSourcePriority
      || (incomingSourcePriority === existingNameSourcePriority && existing.name.length < incomingName.length)
    ) {
      existing.name = incomingName;
    }
  }

  const all = Array.from(merged.values())
    .sort((a, b) => {
      const omegaDiff = omegaRank(a.name) - omegaRank(b.name);
      if (omegaDiff !== 0) return omegaDiff;

      const aHasDose = normalizeDose(a.dose) ? 1 : 0;
      const bHasDose = normalizeDose(b.dose) ? 1 : 0;
      if (aHasDose !== bHasDose) return bHasDose - aHasDose;

      return normalizeText(a.name).toLowerCase().localeCompare(normalizeText(b.name).toLowerCase());
    })
    .map((row) => ({
      key: row.key,
      name: row.name,
      baseName: row.baseName,
      dose: row.dose,
      formValue: row.formValue,
    }));

  const top3 = all.slice(0, maxCoverItems);
  const overflowCount = Math.max(0, all.length - top3.length);
  return { all, top3, overflowCount };
};
