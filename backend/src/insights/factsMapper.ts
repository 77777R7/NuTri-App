import type { FactsDTOv2 } from './scanInsightsSchema.js';

const nowIso = () => new Date().toISOString();

const asSentence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const sanitizeHttpUrl = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const normalizeRoute = (routes: string[] | null | undefined): FactsDTOv2['usage']['route'] => {
  const joined = (routes ?? []).join(' ').toLowerCase();
  if (!joined) return 'unknown';
  if (joined.includes('oral') || joined.includes('mouth') || joined.includes('ingest')) return 'oral';
  if (joined.includes('topical') || joined.includes('skin')) return 'topical';
  return 'other';
};

const parseTimesPerDay = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const lower = value.toLowerCase();
  const rangeMatch = lower.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:times|x)?\s*(?:daily|per\s*day)/);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0) return min;
  }
  const directMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:times|x)?\s*(?:daily|per\s*day)/);
  if (directMatch) {
    const n = Number(directMatch[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
};

const parsePopulation = (value: string | null | undefined): FactsDTOv2['usage']['population'] => {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes('adult')) return 'adults';
  if (lower.includes('adolescent') || lower.includes('teen')) return 'adolescents';
  if (lower.includes('child')) return 'children';
  if (lower.includes('general') || lower.includes('all')) return 'general';
  return 'unknown';
};

const guessOverallStatus = (params: {
  activeCount: number;
  hasDirections: boolean;
  hasWarnings: boolean;
  hasAmounts: boolean;
}): FactsDTOv2['dataQuality']['overallStatus'] => {
  if (params.activeCount === 0) return 'not_provided';
  if (params.hasDirections && params.hasWarnings && params.hasAmounts) return 'complete';
  return 'limited';
};

const pickFormTextFromMeta = (meta: any): { text: string | null; source: 'source_material' | 'ingredient_name' | 'none' } => {
  const sourceMaterial = typeof meta?.sourceMaterial === 'string' ? meta.sourceMaterial.trim() : '';
  if (sourceMaterial) return { text: sourceMaterial, source: 'source_material' };

  const ingredientName = typeof meta?.ingredientName === 'string' ? meta.ingredientName.trim() : '';
  const bracket = ingredientName.match(/\(([^)]+)\)/);
  if (bracket?.[1]) return { text: bracket[1].trim(), source: 'ingredient_name' };

  const properName = typeof meta?.properName === 'string' ? meta.properName.trim() : '';
  const properBracket = properName.match(/\(([^)]+)\)/);
  if (properBracket?.[1]) return { text: properBracket[1].trim(), source: 'ingredient_name' };

  return { text: null, source: 'none' };
};

const extractDosageFormFromFactsJson = (factsJson: unknown): string | null => {
  if (!factsJson || typeof factsJson !== 'object') return null;
  const root = factsJson as Record<string, unknown>;
  const candidates = [root.productLicences, root.product_licences, root.product_license, root.productLicence];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const list = Array.isArray(candidate) ? candidate : [candidate];
    const primary = list.find((item) => {
      if (!item || typeof item !== 'object') return false;
      const row = item as Record<string, unknown>;
      return row.flag_primary_name === 1 || row.flag_primary_name === '1' || row.flagPrimaryName === 1;
    }) ?? list[0];
    if (!primary || typeof primary !== 'object') continue;
    const row = primary as Record<string, unknown>;
    const raw = row.dosage_form ?? row.dosageForm ?? row.dosage_form_name ?? row.form;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return null;
};

export type LnhpdFactsInput = {
  npn: string;
  productName: string | null;
  brandName: string | null;
  actives: Array<{
    name: string;
    amount: number | null;
    unit: string | null;
    lnhpdMeta?: {
      sourceMaterial?: string | null;
      ingredientName?: string | null;
      properName?: string | null;
      inferenceSource?: string | null;
    } | null;
  }>;
  inactive: string[];
  purposes: string[];
  routes: string[];
  doses: string[];
  datasetVersion: string | null;
  extractedAt: string | null;
  isComplete?: boolean | null;
  missingFields?: string[] | null;
  factsJson?: unknown;
};

export const mapLnhpdFactsToFactsDTO = (input: LnhpdFactsInput): FactsDTOv2 => {
    const activeRows = input.actives.map((active) => {
    const form = pickFormTextFromMeta(active.lnhpdMeta);
    const inferredFromProductName = active.lnhpdMeta?.inferenceSource === 'product_name';
    return {
      name: active.name,
      nameRaw: active.name,
      amount: active.amount,
      unit: active.unit,
      per: 'dose' as const,
      formText: form.text,
      formTextSource: form.source as 'source_material' | 'ingredient_name' | 'none',
      notes: inferredFromProductName ? ['inferred_from_product_name_low_confidence'] : undefined,
    };
  });

  const hasAmounts = activeRows.some((item) => typeof item.amount === 'number');
  const hasUnits = activeRows.some((item) => typeof item.unit === 'string' && item.unit.trim().length > 0);
  const hasForms = activeRows.some((item) => typeof item.formText === 'string' && item.formText.trim().length > 0);
  const directionsText = input.doses[0] ?? null;
  const warnings: string[] = [];

  const missingReasons: FactsDTOv2['dataQuality']['missingReasons'] = [];
  if (!directionsText) missingReasons.push('missing_directions');
  if (warnings.length === 0) missingReasons.push('missing_warnings');
  if (!hasAmounts) missingReasons.push('missing_amounts');
  if (!hasUnits) missingReasons.push('missing_units');
  if (!hasForms) missingReasons.push('missing_form');

  const notes: string[] = [];
  if (!directionsText) {
    notes.push(asSentence('Label directions were not available in this LNHPD record, so Usage shows conservative guidance'));
  }
  if (warnings.length === 0) {
    notes.push(asSentence('This LNHPD record did not include label-specific warnings, so Safety shows general watch-outs'));
  }

  return {
    meta: {
      source: 'lnhpd',
      sourceId: input.npn,
      fetchedAt: nowIso(),
    },
    identity: {
      kind: 'npn',
      value: input.npn,
    },
    product: {
      name: input.productName,
      brand: input.brandName,
      category: null,
      imageUrl: null,
    },
    serving: {
      servingSizeText: null,
      servingsPerContainer: null,
    },
    ingredients: {
      actives: activeRows,
      inactives: input.inactive,
      proprietaryBlends: [],
    },
    usage: {
      route: normalizeRoute(input.routes),
      dosageForm: extractDosageFormFromFactsJson(input.factsJson),
      servingSizeText: null,
      servingsPerContainer: null,
      directionsText,
      timesPerDay: parseTimesPerDay(directionsText),
      population: parsePopulation(directionsText),
      dose: null,
    },
    safety: {
      labelWarnings: warnings,
    },
    provenance: {
      source: 'lnhpd',
      extractedAt: input.extractedAt,
      datasetVersion: input.datasetVersion,
      sourceFiles: null,
    },
    sources: [{ kind: 'reg', title: 'Health Canada LNHPD', quality: 'high' }],
    dataQuality: {
      overallStatus: guessOverallStatus({
        activeCount: activeRows.length,
        hasDirections: Boolean(directionsText),
        hasWarnings: warnings.length > 0,
        hasAmounts,
      }),
      isComplete: input.isComplete ?? null,
      missingFields: input.missingFields ?? undefined,
      missingReasons,
      notes,
    },
  };
};

export type DsldFactsInput = {
  dsldLabelId: number | string;
  productName: string | null;
  brandName: string | null;
  actives: Array<{
    name: string;
    amount: number | null;
    unit: string | null;
    formRaw?: string | null;
  }>;
  inactive: string[];
  servingSize: string | null;
  servingsPerContainer: number | null;
  datasetVersion: string | null;
  extractedAt: string | null;
  dsldPdf?: string | null;
  dsldThumbnail?: string | null;
};

const dedupeWithOccurrenceNotes = (actives: DsldFactsInput['actives']) => {
  const counts = new Map<string, number>();
  actives.forEach((active) => {
    const key = `${active.name.trim().toLowerCase()}|${active.unit ?? ''}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  return actives.map((active) => {
    const key = `${active.name.trim().toLowerCase()}|${active.unit ?? ''}`;
    const count = counts.get(key) ?? 1;
    return {
      name: active.name,
      nameRaw: active.name,
      amount: active.amount,
      unit: active.unit,
      per: 'serving' as const,
      formText: active.formRaw ?? null,
      formTextSource: active.formRaw ? 'ingredient_name' as const : 'none' as const,
      notes: count > 1 ? ['multiple entries on label'] : undefined,
    };
  });
};

export const mapDsldFactsToFactsDTO = (input: DsldFactsInput): FactsDTOv2 => {
  const activeRows = dedupeWithOccurrenceNotes(input.actives);
  const hasAmounts = activeRows.some((item) => typeof item.amount === 'number');
  const hasUnits = activeRows.some((item) => typeof item.unit === 'string' && item.unit.trim().length > 0);
  const hasForms = activeRows.some((item) => typeof item.formText === 'string' && item.formText.trim().length > 0);
  const hasDuplicateEntries = activeRows.some((item) => item.notes?.includes('multiple entries on label'));

  const missingReasons: FactsDTOv2['dataQuality']['missingReasons'] = [
    'missing_directions',
    'missing_warnings',
  ];
  if (!hasAmounts) missingReasons.push('missing_amounts');
  if (!hasUnits) missingReasons.push('missing_units');
  if (!hasForms) missingReasons.push('missing_form');
  if (hasDuplicateEntries) missingReasons.push('multiple_label_entries');

  const notes = [
    asSentence('This DSLD record does not include label directions, so Usage shows conservative guidance'),
    asSentence('This DSLD record does not include label-specific warnings, so Safety shows general watch-outs'),
  ];

  return {
    meta: {
      source: 'dsld',
      sourceId: String(input.dsldLabelId),
      fetchedAt: nowIso(),
    },
    identity: {
      kind: 'dsld_label_id',
      value: String(input.dsldLabelId),
    },
    product: {
      name: input.productName,
      brand: input.brandName,
      category: null,
      imageUrl: sanitizeHttpUrl(input.dsldThumbnail),
    },
    serving: {
      servingSizeText: input.servingSize,
      servingsPerContainer: input.servingsPerContainer,
    },
    ingredients: {
      actives: activeRows,
      inactives: input.inactive,
      proprietaryBlends: [],
    },
    usage: {
      route: 'oral',
      dosageForm: null,
      servingSizeText: input.servingSize,
      servingsPerContainer: input.servingsPerContainer,
      directionsText: null,
      timesPerDay: null,
      population: 'general',
      dose: null,
    },
    safety: {
      labelWarnings: [],
    },
    provenance: {
      source: 'dsld',
      extractedAt: input.extractedAt,
      datasetVersion: input.datasetVersion,
      sourceFiles: {
        pdf: sanitizeHttpUrl(input.dsldPdf),
        thumbnail: sanitizeHttpUrl(input.dsldThumbnail),
      },
    },
    sources: [{ kind: 'label', title: 'NIH DSLD', quality: 'high' }],
    dataQuality: {
      overallStatus: guessOverallStatus({
        activeCount: activeRows.length,
        hasDirections: false,
        hasWarnings: false,
        hasAmounts,
      }),
      isComplete: null,
      missingFields: ['directionsText', 'labelWarnings'],
      missingReasons,
      notes,
    },
  };
};

export type WebFactsInput = {
  sourceId: string;
  productName: string | null;
  brandName: string | null;
  imageUrl?: string | null;
  actives: Array<{ name: string; amount: number | null; unit: string | null }>;
  inactives?: string[];
  extractedAt?: string | null;
  datasetVersion?: string | null;
};

export const mapWebFactsToFactsDTO = (input: WebFactsInput): FactsDTOv2 => {
  const activeRows = input.actives.map((row) => ({
    name: row.name,
    nameRaw: row.name,
    amount: row.amount,
    unit: row.unit,
    per: 'serving' as const,
    formText: null,
    formTextSource: 'none' as const,
  }));
  const hasAmounts = activeRows.some((item) => typeof item.amount === 'number');
  const hasUnits = activeRows.some((item) => typeof item.unit === 'string' && item.unit.trim().length > 0);

  const missingReasons: FactsDTOv2['dataQuality']['missingReasons'] = [
    'missing_directions',
    'missing_warnings',
    'partial_record',
  ];
  if (!hasAmounts) missingReasons.push('missing_amounts');
  if (!hasUnits) missingReasons.push('missing_units');
  missingReasons.push('source_low_quality');

  return {
    meta: {
      source: 'web',
      sourceId: input.sourceId,
      fetchedAt: nowIso(),
    },
    identity: {
      kind: /^\d{8,14}$/.test(input.sourceId) ? 'gtin14' : 'web_canonical_id',
      value: input.sourceId,
    },
    product: {
      name: input.productName,
      brand: input.brandName,
      category: null,
      imageUrl: sanitizeHttpUrl(input.imageUrl),
    },
    serving: {
      servingSizeText: null,
      servingsPerContainer: null,
    },
    ingredients: {
      actives: activeRows,
      inactives: input.inactives ?? [],
      proprietaryBlends: [],
    },
    usage: {
      route: 'unknown',
      dosageForm: null,
      servingSizeText: null,
      servingsPerContainer: null,
      directionsText: null,
      timesPerDay: null,
      population: null,
      dose: null,
    },
    safety: {
      labelWarnings: [],
    },
    provenance: {
      source: 'web',
      extractedAt: input.extractedAt ?? null,
      datasetVersion: input.datasetVersion ?? null,
      sourceFiles: null,
    },
    sources: [{ kind: 'web', title: 'Web evidence', quality: 'medium' }],
    dataQuality: {
      overallStatus: guessOverallStatus({
        activeCount: activeRows.length,
        hasDirections: false,
        hasWarnings: false,
        hasAmounts,
      }),
      isComplete: null,
      missingFields: ['directionsText', 'labelWarnings'],
      missingReasons,
      notes: [
        asSentence('Web records often miss label-level directions and warnings, so this analysis remains conservative'),
      ],
    },
  };
};
