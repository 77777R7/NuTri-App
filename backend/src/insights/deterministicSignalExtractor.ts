import type { FactsDigest } from "../factsDigest.js";
import {
  convertDoseToUlUnit,
  formatDoseText,
  getUlLimitByLifeStage,
  lookupUlByCanonicalKey,
  normalizeOdsCanonicalKey,
} from "../ods/ulDataset.js";
import type { FactsDTOv2 } from "./scanInsightsSchema.js";

type SourceRole = "lnhpd" | "dsld" | "web";

type Severity = "info" | "warn";

export type DeterministicIngredientRow = {
  name: string;
  amount: number | null;
  unit: string | null;
  doseText: string | null;
  perServingText: string | null;
  sourceField: string;
  confidence: number | null;
};

export type DeterministicDoseSignal = {
  ingredientKey: string;
  ingredientName: string;
  dosePerUnit: { value: number; unit: string; text: string } | null;
  dailyDose: { value: number; unit: string; text: string } | null;
  frequency: string | null;
  parserEvidence: string[];
  reasonCode: string | null;
};

export type DeterministicUsageStructuredRow = {
  population: string | null;
  age: string | null;
  dose: string | null;
  frequency: string | null;
  rawText: string | null;
  sourceField: string;
};

export type DeterministicSafetySignal = {
  domain: "label_warning" | "ul_reference" | "interaction" | "watchout";
  text: string;
  sourceField: string;
  scope: "label_specific" | "ods_general";
  reasonCode: string | null;
};

export type DeterministicParserDiagnostic = {
  code: string;
  message: string;
  severity: Severity;
};

export type DeterministicSignalPack = {
  ingredientRows: DeterministicIngredientRow[];
  doseSignals: DeterministicDoseSignal[];
  usageStructured: DeterministicUsageStructuredRow[];
  safetySignals: DeterministicSafetySignal[];
  parserDiagnostics: DeterministicParserDiagnostic[];
};

type ExtractorInput = {
  sourceRole: SourceRole;
  digest?: FactsDigest | null;
  factsDto?: FactsDTOv2 | null;
  factsJson?: unknown;
};

const normalizeText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const asArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
};

const normalizePopulationToken = (value: unknown): string =>
  normalizeText(value).toLowerCase().replace(/\s+/g, " ");

const inferPopulationFromUsageText = (value: unknown): string | null => {
  const text = normalizePopulationToken(value);
  if (!text) return null;
  if (/\badults?\b/.test(text)) return "adults";
  if (/\b(children|child|kids?)\b/.test(text)) return "children";
  if (/\b(adolescents?|teens?)\b/.test(text)) return "adolescents";
  if (/\b(seniors?|elderly)\b/.test(text)) return "seniors";
  if (/\b(pregnan|breastfeed|lactat)\w*/.test(text)) return "pregnancy_or_breastfeeding";
  return null;
};

const canonicalKeyFromName = (value: string): string => {
  const normalizedOds = normalizeOdsCanonicalKey(value);
  if (normalizedOds) return normalizedOds;
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
};

const normalizeUnit = (value: unknown): string | null => {
  const unit = normalizeText(value).toLowerCase();
  if (!unit) return null;
  if (unit === "μg" || unit === "µg" || unit === "ug") return "mcg";
  if (unit === "i.u." || unit === "i.u" || unit === "ui") return "iu";
  if (unit === "milligram" || unit === "milligrams") return "mg";
  if (unit === "microgram" || unit === "micrograms") return "mcg";
  if (unit === "gram" || unit === "grams") return "g";
  return unit;
};

const parseFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = normalizeText(value).replace(/,/g, "");
  if (!text) return null;
  const direct = Number(text);
  if (Number.isFinite(direct)) return direct;
  const token = text.match(/-?\d+(?:\.\d+)?/);
  if (!token?.[0]) return null;
  const parsed = Number(token[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

type AmountUnitMatch = {
  amount: number;
  unit: string;
  raw: string;
  index: number;
  length: number;
};

const extractFirstAmountUnitMatch = (value: unknown): AmountUnitMatch | null => {
  const text = normalizeText(value);
  if (!text) return null;
  const match = /(\d[\d,]*(?:\.\d+)?)\s*(mg|mcg|μg|µg|g|iu)\b/i.exec(text);
  if (!match?.[0] || !match?.[1] || !match?.[2]) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  const unit = normalizeUnit(match[2]);
  if (!Number.isFinite(amount) || amount <= 0 || !unit) return null;
  return {
    amount,
    unit,
    raw: `${match[1]} ${match[2]}`,
    index: typeof match.index === "number" ? match.index : text.indexOf(match[0]),
    length: match[0].length,
  };
};

const deriveIngredientNameFromDoseMatch = (text: string, match: AmountUnitMatch): string => {
  const before = normalizeText(text.slice(0, Math.max(0, match.index)));
  const after = normalizeText(text.slice(Math.max(0, match.index + match.length)));
  const cleaned = normalizeText(before || after)
    .replace(/^[\s|:;,_\-–]+|[\s|:;,_\-–]+$/g, "")
    .replace(/\s+/g, " ");
  return cleaned;
};

const parseRangeLowerBound = (value: string): number | null => {
  const match = value.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
  if (!match?.[1]) return null;
  const lower = Number(match[1]);
  return Number.isFinite(lower) && lower > 0 ? lower : null;
};

const parseTimesPerDay = (value: unknown): { times: number | null; usedLowerBound: boolean } => {
  const text = normalizeText(value).toLowerCase();
  if (!text) return { times: null, usedLowerBound: false };

  const range = parseRangeLowerBound(text);
  if (range != null && /(times?|x)?\s*(daily|per day|a day)/.test(text)) {
    return { times: range, usedLowerBound: true };
  }
  if (/\bonce\b/.test(text) && /\b(daily|per day|a day)\b/.test(text)) {
    return { times: 1, usedLowerBound: false };
  }
  if (/\btwice\b/.test(text) && /\b(daily|per day|a day)\b/.test(text)) {
    return { times: 2, usedLowerBound: false };
  }
  if (/\b(thrice|three times)\b/.test(text) && /\b(daily|per day|a day)\b/.test(text)) {
    return { times: 3, usedLowerBound: false };
  }
  const direct = text.match(/(\d+(?:\.\d+)?)\s*(times?|x)?\s*(daily|per day|a day)\b/);
  if (direct?.[1]) {
    const valueNum = Number(direct[1]);
    if (Number.isFinite(valueNum) && valueNum > 0) return { times: valueNum, usedLowerBound: false };
  }
  const hourly = text.match(/every\s+(\d+(?:\.\d+)?)\s*hours?/);
  if (hourly?.[1]) {
    const hours = Number(hourly[1]);
    if (Number.isFinite(hours) && hours > 0) return { times: 24 / hours, usedLowerBound: false };
  }
  if (/\b(daily|per day)\b/.test(text)) {
    return { times: 1, usedLowerBound: false };
  }
  return { times: null, usedLowerBound: false };
};

const parseUsageRowsFromFactsJson = (factsJson: unknown): DeterministicUsageStructuredRow[] => {
  if (!factsJson || typeof factsJson !== "object") return [];
  const root = factsJson as Record<string, unknown>;
  const dosesRaw = Array.isArray(root.doses) ? root.doses : [];
  const out: DeterministicUsageStructuredRow[] = [];
  for (const row of dosesRaw) {
    if (typeof row === "string") {
      const rawText = normalizeText(row);
      if (!rawText) continue;
      out.push({
        population: null,
        age: null,
        dose: null,
        frequency: null,
        rawText,
        sourceField: "facts_json.doses",
      });
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const objectRow = row as Record<string, unknown>;
    const population = normalizeText(objectRow.population_type_desc) || null;
    const ageMin = parseFiniteNumber(objectRow.age_minimum);
    const ageMax = parseFiniteNumber(objectRow.age_maximum);
    const age = ageMin != null || ageMax != null
      ? `${ageMin != null ? ageMin : 0}-${ageMax != null && ageMax > 0 ? ageMax : "max"}`
      : null;
    const quantityDose =
      parseFiniteNumber(objectRow.quantity_dose)
      ?? parseFiniteNumber(objectRow.quantity_dose_minimum)
      ?? parseFiniteNumber(objectRow.quantity_dose_maximum);
    const quantityUnit = normalizeUnit(objectRow.uom_type_desc_quantity_dose);
    const dose = quantityDose != null
      ? `${quantityDose}${quantityUnit ? ` ${quantityUnit}` : ""}`
      : null;
    const frequencyValue =
      parseFiniteNumber(objectRow.frequency)
      ?? parseFiniteNumber(objectRow.frequency_minimum)
      ?? parseFiniteNumber(objectRow.frequency_maximum);
    const frequencyUnit = normalizeText(objectRow.uom_type_desc_frequency);
    const frequency = frequencyValue != null
      ? `${frequencyValue}${frequencyUnit ? ` ${frequencyUnit}` : ""}`
      : null;
    const rawPieces = [population, dose, frequency].filter(Boolean);
    const rawText = normalizeText(rawPieces.join(" ").replace(/\s+/g, " ")) || null;
    if (!population && !age && !dose && !frequency && !rawText) continue;
    out.push({
      population,
      age,
      dose,
      frequency,
      rawText: rawText || null,
      sourceField: "facts_json.doses",
    });
  }
  return out;
};

const extractRawMedicinalRows = (factsJson: unknown): unknown[] => {
  if (!factsJson || typeof factsJson !== "object") return [];
  const root = factsJson as Record<string, unknown>;
  const candidates = [
    root.medicinalIngredients,
    root.medicinal_ingredients,
    root.activeIngredients,
    root.active_ingredients,
    root.active_ingredients_summary,
  ];
  const out: unknown[] = [];
  for (const candidate of candidates) {
    for (const row of asArray(candidate)) out.push(row);
  }
  return out;
};

const extractRawIngredientName = (row: unknown): string => {
  if (typeof row === "string") return normalizeText(row);
  if (!row || typeof row !== "object") return "";
  const raw = row as Record<string, unknown>;
  return normalizeText(
    raw.name
    ?? raw.ingredient
    ?? raw.ingredient_name
    ?? raw.proper_name
    ?? raw.properName
    ?? raw.medicinal_ingredient_name,
  );
};

const extractRawAmountUnitPresence = (row: unknown): { hasAmount: boolean; hasUnit: boolean } => {
  if (!row || typeof row !== "object") return { hasAmount: false, hasUnit: false };
  const raw = row as Record<string, unknown>;
  const amountValues = [
    raw.amount,
    raw.amount_value,
    raw.amountValue,
    raw.quantity,
    raw.quantity_dose,
    raw.quantity_dose_minimum,
    raw.quantity_dose_maximum,
    raw.dose,
    raw.strength,
  ];
  const unitValues = [
    raw.unit,
    raw.amount_unit,
    raw.amountUnit,
    raw.unit_desc,
    raw.uom,
    raw.uom_type_desc_quantity_dose,
  ];
  const hasAmount = amountValues.some((value) => {
    const parsed = parseFiniteNumber(value);
    return parsed != null && parsed > 0;
  });
  const hasUnit = unitValues.some((value) => normalizeText(value).length > 0);
  return { hasAmount, hasUnit };
};

const deriveRawIngredientEvidence = (factsJson: unknown): { hasMedicinalRaw: boolean; hasAmountRaw: boolean } => {
  const medicinalRows = extractRawMedicinalRows(factsJson);
  const hasMedicinalRaw = medicinalRows.some((row) => extractRawIngredientName(row).length > 0);
  const hasAmountRaw = medicinalRows.some((row) => {
    const amountUnit = extractRawAmountUnitPresence(row);
    return amountUnit.hasAmount && amountUnit.hasUnit;
  });
  return {
    hasMedicinalRaw,
    hasAmountRaw,
  };
};

const dedupeByText = <T extends { text: string }>(rows: T[], max = 12): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const text = normalizeText(row.text);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...row, text } as T);
    if (out.length >= max) break;
  }
  return out;
};

const dedupeIngredientRows = (rows: DeterministicIngredientRow[], max = 24): DeterministicIngredientRow[] => {
  const seen = new Set<string>();
  const out: DeterministicIngredientRow[] = [];
  for (const row of rows) {
    const name = normalizeText(row.name);
    if (!name) continue;
    const key = `${name.toLowerCase()}|${normalizeText(row.doseText).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...row, name });
    if (out.length >= max) break;
  }
  return out;
};

const dedupeSafetySignals = (rows: DeterministicSafetySignal[]): DeterministicSafetySignal[] => {
  const seen = new Set<string>();
  const out: DeterministicSafetySignal[] = [];
  for (const row of rows) {
    const text = normalizeText(row.text);
    if (!text) continue;
    const key = `${row.domain}|${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...row, text });
    if (out.length >= 20) break;
  }
  return out;
};

const addDiagnostic = (
  target: DeterministicParserDiagnostic[],
  code: string,
  message: string,
  severity: Severity,
): void => {
  if (target.some((item) => item.code === code)) return;
  target.push({ code, message, severity });
};

const buildIngredientRowsFromFactsJson = (factsJson: unknown): DeterministicIngredientRow[] => {
  if (!factsJson || typeof factsJson !== "object") return [];
  const root = factsJson as Record<string, unknown>;
  const rows: DeterministicIngredientRow[] = [];
  const candidateFields: Array<{ sourceField: string; rows: unknown[] }> = [
    { sourceField: "facts_json.medicinalIngredients", rows: Array.isArray(root.medicinalIngredients) ? root.medicinalIngredients : [] },
    { sourceField: "facts_json.medicinal_ingredients", rows: Array.isArray(root.medicinal_ingredients) ? root.medicinal_ingredients : [] },
    { sourceField: "facts_json.activeIngredients", rows: Array.isArray(root.activeIngredients) ? root.activeIngredients : [] },
    { sourceField: "facts_json.active_ingredients", rows: Array.isArray(root.active_ingredients) ? root.active_ingredients : [] },
    { sourceField: "facts_json.active_ingredients_summary", rows: Array.isArray(root.active_ingredients_summary) ? root.active_ingredients_summary : [] },
  ];

  for (const candidate of candidateFields) {
    for (const raw of candidate.rows) {
      if (typeof raw === "string") {
        const text = normalizeText(raw);
        if (!text) continue;
        const match = extractFirstAmountUnitMatch(text);
        const derivedName = match ? deriveIngredientNameFromDoseMatch(text, match) : text;
        if (!derivedName) continue;
        rows.push({
          name: derivedName,
          amount: match?.amount ?? null,
          unit: match?.unit ?? null,
          doseText: match ? formatDoseText(match.amount, match.unit) : null,
          perServingText: match ? formatDoseText(match.amount, match.unit) : null,
          sourceField: candidate.sourceField,
          confidence: 0.75,
        });
        continue;
      }
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const name = normalizeText(
        row.name
        ?? row.ingredient
        ?? row.ingredient_name
        ?? row.proper_name
        ?? row.properName
        ?? row.medicinal_ingredient_name,
      );
      if (!name) continue;

      const quantityDoseMinimum = parseFiniteNumber(row.quantity_dose_minimum);
      const quantityDoseMaximum = parseFiniteNumber(row.quantity_dose_maximum);
      const parsedAmount =
        parseFiniteNumber(row.amount)
        ?? parseFiniteNumber(row.amount_value)
        ?? parseFiniteNumber(row.amountValue)
        ?? parseFiniteNumber(row.quantity)
        ?? parseFiniteNumber(row.quantity_dose)
        ?? (quantityDoseMinimum != null && quantityDoseMinimum > 0 ? quantityDoseMinimum : null)
        ?? (quantityDoseMaximum != null && quantityDoseMaximum > 0 ? quantityDoseMaximum : null)
        ?? parseFiniteNumber(row.dose)
        ?? parseFiniteNumber(row.strength);
      const parsedUnit =
        normalizeUnit(row.unit)
        ?? normalizeUnit(row.amount_unit)
        ?? normalizeUnit(row.amountUnit)
        ?? normalizeUnit(row.unit_desc)
        ?? normalizeUnit(row.uom)
        ?? normalizeUnit(row.uom_type_desc_quantity_dose);
      const fallbackText =
        normalizeText(row.amountText)
        || normalizeText(row.text)
        || normalizeText(row.rawText)
        || normalizeText(row.doseText);
      const matchFromText = fallbackText ? extractFirstAmountUnitMatch(fallbackText) : null;
      const amount = parsedAmount ?? matchFromText?.amount ?? null;
      const unit = parsedUnit ?? matchFromText?.unit ?? null;
      const doseText = amount != null && unit ? formatDoseText(amount, unit) : null;

      rows.push({
        name,
        amount,
        unit,
        doseText,
        perServingText: doseText,
        sourceField: candidate.sourceField,
        confidence: 0.75,
      });
    }
  }
  return rows;
};

const buildIngredientRowsFromProductNames = (factsJson: unknown): DeterministicIngredientRow[] => {
  if (!factsJson || typeof factsJson !== "object") return [];
  const root = factsJson as Record<string, unknown>;
  const rows: DeterministicIngredientRow[] = [];
  const rawNames: Array<{ sourceField: string; text: string }> = [];
  const topLevelNames = [root.productName, root.product_name];
  for (const candidate of topLevelNames) {
    const text = normalizeText(candidate);
    if (text) rawNames.push({ sourceField: "facts_json.productName", text });
  }
  const productLicences = Array.isArray(root.productLicences) ? root.productLicences : [];
  for (const licence of productLicences) {
    if (!licence || typeof licence !== "object") continue;
    const text = normalizeText((licence as Record<string, unknown>).product_name);
    if (!text) continue;
    rawNames.push({ sourceField: "facts_json.productLicences.product_name", text });
  }

  for (const entry of rawNames) {
    const match = extractFirstAmountUnitMatch(entry.text);
    if (!match) continue;
    const name = deriveIngredientNameFromDoseMatch(entry.text, match);
    if (!name || name.length < 2) continue;
    rows.push({
      name,
      amount: match.amount,
      unit: match.unit,
      doseText: formatDoseText(match.amount, match.unit),
      perServingText: formatDoseText(match.amount, match.unit),
      sourceField: entry.sourceField,
      confidence: 0.6,
    });
  }
  return rows;
};

const buildIngredientRowsFromDigestProductName = (
  digest: FactsDigest | null | undefined,
): DeterministicIngredientRow[] => {
  const productName = normalizeText(digest?.product?.name);
  if (!productName) return [];
  const match = extractFirstAmountUnitMatch(productName);
  if (!match) return [];
  const name = deriveIngredientNameFromDoseMatch(productName, match);
  if (!name || name.length < 2) return [];
  return [
    {
      name,
      amount: match.amount,
      unit: match.unit,
      doseText: formatDoseText(match.amount, match.unit),
      perServingText: formatDoseText(match.amount, match.unit),
      sourceField: "factsDigest.product.name",
      confidence: 0.55,
    },
  ];
};

const buildIngredientRows = (
  input: ExtractorInput,
  parserDiagnostics: DeterministicParserDiagnostic[],
): DeterministicIngredientRow[] => {
  if (input.digest) {
    const rows = (input.digest.actives ?? []).map((active) => {
      const unit = normalizeUnit(active.unit);
      const amount = parseFiniteNumber(active.amount);
      const doseText = normalizeText(active.amountText)
        || (amount != null && unit ? formatDoseText(amount, unit) : "");
      return {
        name: normalizeText(active.name),
        amount,
        unit,
        doseText: doseText || null,
        perServingText: doseText || null,
        sourceField: "factsDigest.actives",
        confidence: typeof active.confidence === "number" && Number.isFinite(active.confidence)
          ? active.confidence
          : null,
      } satisfies DeterministicIngredientRow;
    });
    const filtered = rows.filter((row) => row.name.length > 0).slice(0, 24);
    if (filtered.length > 0) return filtered;
    const digestNameRows = buildIngredientRowsFromDigestProductName(input.digest);
    if (digestNameRows.length > 0) {
      addDiagnostic(
        parserDiagnostics,
        "INGREDIENT_FALLBACK_DIGEST_PRODUCT_NAME_USED",
        "Ingredient rows were deterministically inferred from digest.product.name.",
        "info",
      );
      return digestNameRows;
    }
  }

  const factsRows = Array.isArray(input.factsDto?.ingredients?.actives)
    ? input.factsDto?.ingredients?.actives
    : [];
  const dtoRows = factsRows
    .map((active) => {
      const unit = normalizeUnit((active as { unit?: unknown })?.unit);
      const amount = parseFiniteNumber((active as { amount?: unknown })?.amount);
      const doseText = amount != null && unit ? formatDoseText(amount, unit) : null;
      return {
        name: normalizeText((active as { name?: unknown })?.name),
        amount,
        unit,
        doseText,
        perServingText: doseText,
        sourceField: "factsDto.ingredients.actives",
        confidence: null,
      } satisfies DeterministicIngredientRow;
    })
    .filter((row) => row.name.length > 0)
    .slice(0, 24);
  if (dtoRows.length > 0) return dtoRows;

  const factsJsonRows = buildIngredientRowsFromFactsJson(input.factsJson);
  if (factsJsonRows.length > 0) {
    addDiagnostic(
      parserDiagnostics,
      "INGREDIENT_FALLBACK_FACTS_JSON_USED",
      "Ingredient rows were deterministically extracted from facts_json fallback fields.",
      "info",
    );
    return factsJsonRows.slice(0, 24);
  }

  const productNameRows = buildIngredientRowsFromProductNames(input.factsJson);
  if (productNameRows.length > 0) {
    addDiagnostic(
      parserDiagnostics,
      "INGREDIENT_FALLBACK_PRODUCT_NAME_USED",
      "Ingredient rows were deterministically extracted from LNHPD product-name fields.",
      "info",
    );
    return productNameRows.slice(0, 24);
  }

  return [];
};

const buildUsageStructuredRows = (input: ExtractorInput): DeterministicUsageStructuredRow[] => {
  const rows: DeterministicUsageStructuredRow[] = [];

  for (const row of input.digest?.labelDosing ?? []) {
    const population = normalizeText(row.population) || null;
    const age = normalizeText(row.age) || null;
    const dose = normalizeText(row.dose) || null;
    const frequency = normalizeText(row.frequency) || null;
    const rawText = normalizeText(row.rawText) || null;
    if (!population && !age && !dose && !frequency && !rawText) continue;
    rows.push({
      population,
      age,
      dose,
      frequency,
      rawText,
      sourceField: "factsDigest.labelDosing",
    });
  }

  if (!rows.length && input.digest?.serving?.servingSize) {
    rows.push({
      population: "general",
      age: null,
      dose: normalizeText(input.digest.serving.servingSize) || null,
      frequency: null,
      rawText: `Serving size: ${normalizeText(input.digest.serving.servingSize)}`,
      sourceField: "factsDigest.serving.servingSize",
    });
  }

  if (!rows.length && input.factsDto?.usage?.directionsText) {
    rows.push({
      population: null,
      age: null,
      dose: null,
      frequency: null,
      rawText: normalizeText(input.factsDto.usage.directionsText) || null,
      sourceField: "factsDto.usage.directionsText",
    });
  }

  if (!rows.length) {
    rows.push(...parseUsageRowsFromFactsJson(input.factsJson));
  }

  return rows.slice(0, 12);
};

const buildDoseSignals = (params: {
  ingredientRows: DeterministicIngredientRow[];
  usageStructured: DeterministicUsageStructuredRow[];
  parserDiagnostics: DeterministicParserDiagnostic[];
}): DeterministicDoseSignal[] => {
  const usageEvidence = params.usageStructured
    .map((row) => normalizeText(row.rawText) || normalizeText(row.frequency))
    .filter(Boolean)
    .slice(0, 3);
  const mergedUsageText = usageEvidence.join(" ");
  const parsedFrequency = parseTimesPerDay(mergedUsageText);
  const signals: DeterministicDoseSignal[] = [];

  for (const ingredient of params.ingredientRows) {
    const ingredientName = normalizeText(ingredient.name);
    if (!ingredientName) continue;
    const ingredientKey = canonicalKeyFromName(ingredientName);
    const amount = ingredient.amount;
    const unit = normalizeUnit(ingredient.unit);
    const dosePerUnit =
      amount != null && unit
        ? {
          value: amount,
          unit,
          text: formatDoseText(amount, unit),
        }
        : null;
    const frequencyTimes = parsedFrequency.times;
    let dailyDose: { value: number; unit: string; text: string } | null = null;
    if (dosePerUnit && frequencyTimes != null && frequencyTimes > 0) {
      const dailyValue = dosePerUnit.value * frequencyTimes;
      dailyDose = {
        value: dailyValue,
        unit: dosePerUnit.unit,
        text: formatDoseText(dailyValue, dosePerUnit.unit),
      };
    }

    let reasonCode: string | null = null;
    if (!dosePerUnit) {
      reasonCode = "MISSING_AMOUNT_OR_UNIT";
    } else if (parsedFrequency.times == null) {
      reasonCode = "MISSING_DAILY_FREQUENCY";
    } else if (parsedFrequency.usedLowerBound) {
      reasonCode = "RANGE_LOWER_BOUND_USED";
      addDiagnostic(
        params.parserDiagnostics,
        "RANGE_LOWER_BOUND_USED",
        "A dosage range was detected and normalized using lower-bound policy.",
        "info",
      );
    }

    signals.push({
      ingredientKey,
      ingredientName,
      dosePerUnit,
      dailyDose,
      frequency: parsedFrequency.times != null ? `${parsedFrequency.times} per day` : null,
      parserEvidence: usageEvidence,
      reasonCode,
    });
  }

  return signals.slice(0, 24);
};

const buildSafetySignals = (params: {
  input: ExtractorInput;
  ingredientRows: DeterministicIngredientRow[];
  usageStructured: DeterministicUsageStructuredRow[];
  parserDiagnostics: DeterministicParserDiagnostic[];
}): DeterministicSafetySignal[] => {
  const rows: DeterministicSafetySignal[] = [];
  const digest = params.input.digest;

  for (const text of digest?.warnings?.warnings ?? []) {
    const normalized = normalizeText(text);
    if (!normalized) continue;
    rows.push({
      domain: "label_warning",
      text: normalized,
      sourceField: "factsDigest.warnings.warnings",
      scope: "label_specific",
      reasonCode: null,
    });
  }
  for (const text of digest?.warnings?.consultDoctorIf ?? []) {
    const normalized = normalizeText(text);
    if (!normalized) continue;
    rows.push({
      domain: "interaction",
      text: normalized,
      sourceField: "factsDigest.warnings.consultDoctorIf",
      scope: "label_specific",
      reasonCode: null,
    });
  }
  for (const text of digest?.warnings?.redFlags ?? []) {
    const normalized = normalizeText(text);
    if (!normalized) continue;
    rows.push({
      domain: "watchout",
      text: normalized,
      sourceField: "factsDigest.warnings.redFlags",
      scope: "label_specific",
      reasonCode: null,
    });
  }

  for (const ingredient of params.ingredientRows) {
    const ingredientName = normalizeText(ingredient.name);
    if (!ingredientName) continue;
    const canonicalKey = canonicalKeyFromName(ingredientName);
    const ulItem = lookupUlByCanonicalKey(canonicalKey);
    if (!ulItem) continue;
    const adultLimit = getUlLimitByLifeStage(ulItem, "adult_19_plus");
    if (!adultLimit) continue;

    let referenceLine = `Upper limit (UL): ${formatDoseText(adultLimit.value, adultLimit.unit)}/day (adult 19+, NIH ODS).`;
    if (ingredient.amount != null && ingredient.unit) {
      const conversion = convertDoseToUlUnit({
        amount: ingredient.amount,
        fromUnit: ingredient.unit,
        targetUnit: adultLimit.unit,
        altUnits: ulItem.altUnits,
      });
      if (conversion.ok && conversion.value != null) {
        referenceLine = `${referenceLine} Current label amount: ${formatDoseText(conversion.value, adultLimit.unit)} per serving.`;
      } else if (!conversion.ok && conversion.reasonCode === "UNSUPPORTED_UNIT_CONVERSION") {
        addDiagnostic(
          params.parserDiagnostics,
          "UNIT_CONVERSION_UNCERTAIN",
          `Unit conversion remained uncertain for ${ingredientName} (${normalizeText(ingredient.unit)} -> ${adultLimit.unit}).`,
          "warn",
        );
      }
    }

    rows.push({
      domain: "ul_reference",
      text: referenceLine,
      sourceField: "ods.ulDataset",
      scope: "ods_general",
      reasonCode: null,
    });
  }

  const hasConcreteSafetySignal = rows.some(
    (row) => row.domain === "label_warning" || row.domain === "ul_reference" || row.domain === "interaction",
  );
  if (!hasConcreteSafetySignal) {
    const pickSpecificPopulationRow = (rows: DeterministicUsageStructuredRow[]): DeterministicUsageStructuredRow | undefined =>
      rows.find((row) => {
        const population = normalizePopulationToken(row.population);
        const age = normalizePopulationToken(row.age);
        const inferredFromRaw = inferPopulationFromUsageText(row.rawText);
        const genericPopulation =
          !population
          || population === "general"
          || population === "all"
          || population === "all ages"
          || population === "any";
        return !genericPopulation || Boolean(age) || Boolean(inferredFromRaw);
      });
    const usagePopulationRow =
      pickSpecificPopulationRow(params.usageStructured)
      ?? pickSpecificPopulationRow(parseUsageRowsFromFactsJson(params.input.factsJson));
    if (usagePopulationRow) {
      const populationText = normalizeText(usagePopulationRow.population);
      const ageText = normalizeText(usagePopulationRow.age);
      const inferredPopulation = inferPopulationFromUsageText(usagePopulationRow.rawText);
      const targetText = [populationText, ageText, inferredPopulation]
        .filter(Boolean)
        .join(" ");
      rows.push({
        domain: "label_warning",
        text: targetText
          ? `Use as directed for ${targetText}.`
          : "Use as directed for the labeled population.",
        sourceField: usagePopulationRow.sourceField,
        scope: "label_specific",
        reasonCode: "POPULATION_RESTRICTION_FROM_DOSING",
      });
      addDiagnostic(
        params.parserDiagnostics,
        "SAFETY_POPULATION_SIGNAL_FROM_DOSING",
        "Added a deterministic safety signal from structured dosage population guidance.",
        "info",
      );
    }
  }

  if (!rows.some((row) => row.domain === "label_warning" || row.domain === "ul_reference" || row.domain === "interaction")) {
    const dosingGuardrailRow = params.usageStructured.find((row) => {
      const dose = normalizeText(row.dose);
      const frequency = normalizeText(row.frequency);
      const rawText = normalizeText(row.rawText);
      return Boolean(dose || frequency || rawText);
    });
    if (dosingGuardrailRow) {
      const dose = normalizeText(dosingGuardrailRow.dose);
      const frequency = normalizeText(dosingGuardrailRow.frequency);
      const rawText = normalizeText(dosingGuardrailRow.rawText);
      const guidanceText =
        rawText
        || [dose, frequency].filter(Boolean).join(" ")
        || "Follow the labeled dose and frequency.";
      rows.push({
        domain: "label_warning",
        text: `Label dosing guardrail: ${guidanceText}`,
        sourceField: dosingGuardrailRow.sourceField,
        scope: "label_specific",
        reasonCode: "DOSING_GUARDRAIL_FROM_LABEL",
      });
      addDiagnostic(
        params.parserDiagnostics,
        "SAFETY_DOSING_GUARDRAIL_FROM_USAGE",
        "Added a deterministic safety signal from structured dosing guidance.",
        "info",
      );
    }
  }

  if (!rows.some((row) => row.domain === "label_warning")) {
    const fallbackText =
      params.input.sourceRole === "lnhpd" || params.input.sourceRole === "dsld"
        ? "This regulatory record did not provide label-specific warnings."
        : "This source record did not provide label-specific warnings.";
    rows.push({
      domain: "watchout",
      text: fallbackText,
      sourceField: "deterministic.fallback",
      scope: "label_specific",
      reasonCode: "LABEL_WARNINGS_NOT_PROVIDED",
    });
  }

  return dedupeSafetySignals(rows);
};

export const extractDeterministicSignalPack = (input: ExtractorInput): DeterministicSignalPack => {
  const parserDiagnostics: DeterministicParserDiagnostic[] = [];
  const ingredientRows = dedupeIngredientRows(buildIngredientRows(input, parserDiagnostics), 24);
  const usageStructured = buildUsageStructuredRows(input);
  const doseSignals = buildDoseSignals({ ingredientRows, usageStructured, parserDiagnostics });
  const safetySignals = buildSafetySignals({ input, ingredientRows, usageStructured, parserDiagnostics });
  const doseSignalCount = doseSignals.filter((row) => row.dosePerUnit != null).length;
  const rawIngredientEvidence = deriveRawIngredientEvidence(input.factsJson);
  const regulatoryRole = input.sourceRole === "lnhpd" || input.sourceRole === "dsld";

  if (regulatoryRole && !rawIngredientEvidence.hasMedicinalRaw) {
    addDiagnostic(
      parserDiagnostics,
      "MISSING_MEDICINAL_INGREDIENTS",
      "No medicinal ingredient rows were present in source facts_json.",
      "warn",
    );
  } else if (regulatoryRole && rawIngredientEvidence.hasMedicinalRaw && !rawIngredientEvidence.hasAmountRaw) {
    addDiagnostic(
      parserDiagnostics,
      "MISSING_AMOUNT_FIELDS",
      "Medicinal ingredient names were present but amount/unit fields were missing in source facts_json.",
      "warn",
    );
  }

  const parserGapFixable =
    regulatoryRole
    && (
      (rawIngredientEvidence.hasMedicinalRaw && ingredientRows.length === 0)
      || (rawIngredientEvidence.hasAmountRaw && doseSignalCount === 0)
    );
  if (parserGapFixable) {
    addDiagnostic(
      parserDiagnostics,
      "PARSER_GAP_FIXABLE",
      "Source ingredient fields were present but deterministic parser output stayed empty.",
      "warn",
    );
  }

  if (ingredientRows.length === 0) {
    addDiagnostic(
      parserDiagnostics,
      "MISSING_INGREDIENT_SIGNALS",
      "No deterministic ingredient rows were extracted from the available record fields.",
      "warn",
    );
  }
  if (doseSignalCount === 0) {
    addDiagnostic(
      parserDiagnostics,
      "MISSING_DOSE_SIGNALS",
      "Ingredient rows were present but no deterministic dose-per-unit signal was produced.",
      "warn",
    );
  }
  if (usageStructured.length === 0) {
    addDiagnostic(
      parserDiagnostics,
      "MISSING_USAGE_STRUCTURE",
      "No deterministic usage structure could be extracted from directions/serving fields.",
      "warn",
    );
  }
  const concreteSafetyCount = safetySignals.filter((row) =>
    row.domain === "label_warning" || row.domain === "ul_reference" || row.domain === "interaction"
  ).length;
  if (concreteSafetyCount === 0) {
    addDiagnostic(
      parserDiagnostics,
      "MISSING_SAFETY_SIGNALS",
      "No concrete safety signal (label warning/UL/interactions) was extracted deterministically.",
      "warn",
    );
  }

  return {
    ingredientRows,
    doseSignals,
    usageStructured,
    safetySignals,
    parserDiagnostics,
  };
};
