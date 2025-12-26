/**
 * Label Analysis Post-processing
 * Infer table rows/columns from Vision tokens, extract ingredients, validate, and calculate confidence
 */

import type { Token } from './visionOcr.js';

// ============================================================================
// TYPES
// ============================================================================

export interface Row {
    tokens: Token[];
    yCenter: number;
    yMin: number;
    yMax: number;
}

export interface Cell {
    text: string;
    xMin: number;
    xMax: number;
    confidence: number;
}

export interface ParsedIngredient {
    name: string;
    amount: number | null;
    unit: string | null;
    dvPercent: number | null;
    confidence: number;
    rawLine: string;
}

export interface ValidationIssue {
    type: 'unit_invalid' | 'value_anomaly' | 'missing_serving_size' | 'header_not_found' | 'low_coverage';
    message: string;
}

export interface LabelDraft {
    servingSize: string | null;
    ingredients: ParsedIngredient[];
    parseCoverage: number;
    confidenceScore: number;
    issues: ValidationIssue[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const VALID_UNITS = new Set(['mg', 'mcg', 'μg', 'g', 'iu', 'ml', '%', 'kcal', 'kj', 'cfu']);
const UNIT_NORMALIZATIONS: Record<string, string> = {
    'μg': 'mcg',
    'µg': 'mcg',
    'ug': 'mcg',
    'mcg': 'mcg',
    'microgram': 'mcg',
    'micrograms': 'mcg',
    'milligram': 'mg',
    'milligrams': 'mg',
    'gram': 'g',
    'grams': 'g',
    'ml': 'ml',
    'mL': 'ml',
    'iu': 'IU',
    'i.u.': 'IU',
    'i.u': 'IU',
    'iu.': 'IU',
    'ui': 'IU',
    'international unit': 'IU',
    'international units': 'IU',
    'cfu': 'CFU',
    'cfu.': 'CFU',
    'ufc': 'CFU',
};

// P0-3: HEADER_KEYWORDS should NOT include 'serving size' to avoid misdetection
const HEADER_KEYWORDS = ['amount', 'daily value', '%dv', 'dv', 'per serving'];
const SERVING_SIZE_PATTERNS = [/serving\s*size/i, /servings?\s*per/i];

// Basic sanity limits (can be extended)
const SANITY_LIMITS: Record<string, { maxAmount: number; units: string[] }> = {
    'vitamin d': { maxAmount: 10000, units: ['iu', 'mcg'] },
    'vitamin a': { maxAmount: 10000, units: ['iu', 'mcg'] },
    'vitamin c': { maxAmount: 3000, units: ['mg'] },
    'iron': { maxAmount: 100, units: ['mg'] },
    'calcium': { maxAmount: 2000, units: ['mg'] },
    'zinc': { maxAmount: 100, units: ['mg'] },
};

// ============================================================================
// ROW/COLUMN INFERENCE
// ============================================================================

/**
 * Cluster tokens into rows based on Y-coordinate proximity
 * Threshold: medianTokenHeight * 0.6
 */
export function inferTableRows(tokens: Token[]): Row[] {
    if (tokens.length === 0) return [];

    // Calculate median height
    const heights = tokens.map((t) => t.height).sort((a, b) => a - b);
    const medianHeight = heights[Math.floor(heights.length / 2)] || 20;
    const yThreshold = medianHeight * 0.6;

    // Sort by Y center
    const sorted = [...tokens].sort((a, b) => a.yCenter - b.yCenter);

    const rows: Row[] = [];
    let currentRow: Token[] = [sorted[0]];
    let currentYCenter = sorted[0].yCenter;

    for (let i = 1; i < sorted.length; i++) {
        const token = sorted[i];
        if (Math.abs(token.yCenter - currentYCenter) <= yThreshold) {
            currentRow.push(token);
            currentYCenter =
                (currentYCenter * (currentRow.length - 1) + token.yCenter) / currentRow.length;
        } else {
            rows.push(createRow(currentRow));
            currentRow = [token];
            currentYCenter = token.yCenter;
        }
    }

    if (currentRow.length > 0) {
        rows.push(createRow(currentRow));
    }

    return rows;
}

function createRow(tokens: Token[]): Row {
    const yCenters = tokens.map((t) => t.yCenter);
    const yMins = tokens.map((t) => t.bbox.yMin);
    const yMaxs = tokens.map((t) => t.bbox.yMax);

    return {
        tokens: tokens.sort((a, b) => a.xMin - b.xMin), // Sort by X within row
        yCenter: yCenters.reduce((a, b) => a + b, 0) / yCenters.length,
        yMin: Math.min(...yMins),
        yMax: Math.max(...yMaxs),
    };
}

/**
 * Within a row, group tokens into cells based on X gaps
 */
export function inferTableColumns(row: Row): Cell[] {
    if (row.tokens.length === 0) return [];

    const cells: Cell[] = [];
    let currentCell: Token[] = [row.tokens[0]];

    // Calculate median gap to determine column breaks
    const gaps: number[] = [];
    for (let i = 1; i < row.tokens.length; i++) {
        const gap = row.tokens[i].bbox.xMin - row.tokens[i - 1].bbox.xMax;
        gaps.push(gap);
    }

    const medianGap = gaps.length > 0 ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 10;

    // P1: Use median token height to make gap threshold dynamic for different resolutions
    const medianTokenHeight = row.tokens
        .map(t => t.height)
        .sort((a, b) => a - b)[Math.floor(row.tokens.length / 2)] || 20;

    const gapThreshold = Math.max(medianGap * 2, medianTokenHeight * 1.2);

    for (let i = 1; i < row.tokens.length; i++) {
        const gap = row.tokens[i].bbox.xMin - row.tokens[i - 1].bbox.xMax;
        if (gap > gapThreshold) {
            cells.push(createCell(currentCell));
            currentCell = [row.tokens[i]];
        } else {
            currentCell.push(row.tokens[i]);
        }
    }

    if (currentCell.length > 0) {
        cells.push(createCell(currentCell));
    }

    return cells;
}

function createCell(tokens: Token[]): Cell {
    return {
        text: tokens.map((t) => t.text).join(' '),
        xMin: Math.min(...tokens.map((t) => t.bbox.xMin)),
        xMax: Math.max(...tokens.map((t) => t.bbox.xMax)),
        confidence: tokens.reduce((sum, t) => sum + t.confidence, 0) / tokens.length,
    };
}

// ============================================================================
// INGREDIENT EXTRACTION
// ============================================================================

/**
 * Extract structured ingredients from rows
 */
export function extractIngredients(rows: Row[]): LabelDraft {
    const issues: ValidationIssue[] = [];
    const ingredients: ParsedIngredient[] = [];
    let servingSize: string | null = null;

    // Find header row and serving size
    let headerRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
        const rowText = rows[i].tokens.map((t) => t.text).join(' ').toLowerCase();

        // Check for serving size
        if (SERVING_SIZE_PATTERNS.some((p) => p.test(rowText))) {
            servingSize = rows[i].tokens.map((t) => t.text).join(' ');
        }

        // P1: Stricter header detection to avoid footnotes (must have multiple cells and mix of keywords)
        const cells = inferTableColumns(rows[i]);
        const hasAmountLike = rowText.includes('amount') || rowText.includes('per serving');
        const hasDvLike = rowText.includes('%dv') || rowText.includes('daily value') || rowText.includes('dv');

        if (headerRowIndex < 0 && cells.length >= 2 && hasDvLike && hasAmountLike) {
            headerRowIndex = i;
        } else if (headerRowIndex < 0 && HEADER_KEYWORDS.some((kw) => rowText.includes(kw)) && cells.length >= 3) {
            // Fallback: if 3+ columns and keyword match, likely a header
            headerRowIndex = i;
        }
    }

    if (!servingSize) {
        const pseudoLines = rows.map((row, index) => {
            const raw = row.tokens.map((t) => t.text).join(' ');
            return {
                raw,
                normalized: normalizeForMatch(raw),
                tokens: row.tokens,
                yCenter: index,
            };
        });
        servingSize = inferServingSize(pseudoLines);
    }

    if (!servingSize) {
        issues.push({ type: 'missing_serving_size', message: 'Serving size not found' });
    }

    // Process rows after header (or from start if no header)
    const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;
    let parsedWithAmountUnit = 0;
    let ingredientLikeRows = 0;

    for (let i = startRow; i < rows.length; i++) {
        const cells = inferTableColumns(rows[i]);
        const rowText = rows[i].tokens.map((t) => t.text).join(' ');

        // Skip if row looks like header/footer
        if (isNonIngredientRow(rowText)) continue;

        ingredientLikeRows++;

        const parsed = parseRowToIngredient(cells, rowText);
        if (parsed) {
            ingredients.push(parsed);
            if (parsed.amount !== null && parsed.unit !== null) {
                parsedWithAmountUnit++;
            }
        }
    }

    // Calculate coverage
    const parseCoverage = ingredientLikeRows > 0 ? parsedWithAmountUnit / ingredientLikeRows : 0;

    if (parseCoverage < 0.7) {
        issues.push({
            type: 'low_coverage',
            message: `Only ${Math.round(parseCoverage * 100)}% of rows have valid amount/unit`,
        });
    }

    if (headerRowIndex < 0 && ingredients.length > 0) {
        issues.push({ type: 'header_not_found', message: 'Table header not detected, column mapping may be inaccurate' });
    }

    // Validate each ingredient
    for (const ing of ingredients) {
        const validation = validateIngredient(ing);
        issues.push(...validation);
    }

    // Calculate overall confidence
    const confidenceScore = calculateConfidenceScore(ingredients, parseCoverage, issues);

    return {
        servingSize,
        ingredients,
        parseCoverage,
        confidenceScore,
        issues,
    };
}

function isNonIngredientRow(text: string): boolean {
    const lower = text.toLowerCase();
    const skipPatterns = [
        /^other\s*ingredients/i,
        /^autres?\s*ingr[eé]dients/i,
        /^daily\s*value/i,
        /^valeur\s*quotidienne/i,
        /\bdaily value\b/i,
        /\bvaleur\s+quotidienne\b/i,
        /^\*\s*percent/i,
        /percent\s+daily\s+values?\s+are\s+based\s+on/i,
        /les?\s+pourcentages?\s+de\s+la\s+valeur\s+quotidienne/i,
        /^suggested\s*use/i,
        /^mode\s+d['’]?emploi/i,
        /^posologie/i,
        /^warning/i,
        /^mise\s+en\s+garde/i,
        /^avertissement/i,
        /^allergen/i,
        /^manufactured/i,
        /^not\s*a\s*significant/i,
        /valeur\s+quotidienne\s+non\s+[eé]tablie/i,
        /daily\s+value\s+not\s+established/i,
    ];
    return skipPatterns.some((p) => p.test(lower));
}

function parseRowToIngredient(cells: Cell[], rawLine: string): ParsedIngredient | null {
    if (cells.length === 0) return null;

    let name = '';
    let amountText = '';
    let dvPercent: number | null = null;
    let avgConfidence = 0;

    if (cells.length >= 3) {
        // 3+ columns: name | amount+unit | %DV
        name = cells[0].text;
        amountText = cells[1].text;
        dvPercent = parseDvPercent(cells[2].text);
        avgConfidence = cells.reduce((s, c) => s + c.confidence, 0) / cells.length;
    } else if (cells.length === 2) {
        // 2 columns: name | amount+unit (or name | %DV)
        name = cells[0].text;
        const secondText = cells[1].text;
        if (secondText.includes('%')) {
            dvPercent = parseDvPercent(secondText);
        } else {
            amountText = secondText;
        }
        avgConfidence = (cells[0].confidence + cells[1].confidence) / 2;
    } else {
        // Single cell: P1-8 - Use regex to extract trailing amount+unit (now supporting commas)
        const cellText = cells[0].text;
        // Match trailing number + unit like "Vitamin C 1,000 mg" or "Magnesium 2.5 g"
        const trailingMatch = cellText.match(/^(.+?)\s+(\d[\d,]*\.?\d*)\s*([a-zA-Zμµ%]+)\s*$/);
        if (trailingMatch) {
            name = trailingMatch[1];
            // Remove commas from amount
            const amountClean = trailingMatch[2].replace(/,/g, '');
            amountText = `${amountClean} ${trailingMatch[3]}`;
        } else {
            name = cellText;
        }
        avgConfidence = cells[0].confidence;
    }

    // Clean up name
    name = name.replace(/[†*‡§]/g, '').trim();
    if (!name || name.length < 2) return null;

    const { amount, unit } = parseAmountAndUnit(amountText);

    return {
        name,
        amount,
        unit,
        dvPercent,
        confidence: avgConfidence,
        rawLine,
    };
}

// ============================================================================
// PARSING UTILITIES
// ============================================================================

/**
 * Parse amount and unit from text like "25 mcg", "1,000 mg", "500 IU"
 */
function normalizeUnit(unitRaw: string): string | null {
    if (!unitRaw) return null;
    if (/\/\s*(ml|l|g|kg)\b/i.test(unitRaw)) {
        return null;
    }
    const rawLowered = unitRaw.toLowerCase().trim();
    const cleaned = rawLowered
        .replace(/[()./:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const mapped = UNIT_NORMALIZATIONS[cleaned] ?? UNIT_NORMALIZATIONS[rawLowered] ?? cleaned;
    let baseMatch = mapped.match(/\b(mcg|μg|µg|ug|mg|g|iu|ui|ml|%|kcal|kj|cfu)\b/i);
    if (!baseMatch) {
        const prefixMatch = mapped.match(/^(mcg|μg|µg|ug|mg|g|iu|ui|ml|%|kcal|kj|cfu)([a-z%]+)?/i);
        if (!prefixMatch) return null;
        const remainder = (prefixMatch[2] ?? '').replace(/[^a-z%]/g, '');
        if (remainder.length > 3) return null;
        baseMatch = prefixMatch;
    }
    let base = baseMatch[1].toLowerCase();
    base = UNIT_NORMALIZATIONS[base] ?? base;
    let normalizedUnit = base.toLowerCase() === 'iu' ? 'IU' : base;
    if (normalizedUnit.toLowerCase() === 'cfu') {
        normalizedUnit = 'CFU';
    }
    if (!VALID_UNITS.has(normalizedUnit.toLowerCase())) {
        return null;
    }
    return normalizedUnit;
}

function parseNumber(value: string): number | null {
    const cleaned = value.replace(/,/g, '');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
}

function isRatioTail(text: string, startIndex: number, length: number): boolean {
    const tail = text.slice(startIndex + length);
    return /^\s*\/\s*(ml|l|g|kg)\b/i.test(tail);
}

function findAmountUnit(text: string): { amount: number; unit: string; raw: string } | null {
    if (!text) return null;
    const cleaned = text.replace(/[<>≤≥]/g, ' ');
    const cfuShortMatch = cleaned.match(/(\d[\d,]*\.?\d*)\s*(b|m)\s*cfu\b/i);
    if (cfuShortMatch) {
        const baseValue = parseNumber(cfuShortMatch[1]);
        const scale = (cfuShortMatch[2] ?? '').toLowerCase();
        if (baseValue !== null) {
            const amount = scale === 'b' ? baseValue * 1e9 : baseValue * 1e6;
            return { amount, unit: 'CFU', raw: cfuShortMatch[0] };
        }
    }
    const cfuCoeffExponentMatch = cleaned.match(/(\d[\d,]*\.?\d*)\s*(?:x|×)\s*10\^?(\d+)\s*cfu\b/i);
    if (cfuCoeffExponentMatch) {
        const baseValue = parseNumber(cfuCoeffExponentMatch[1]);
        const exponent = Number.parseInt(cfuCoeffExponentMatch[2] ?? '', 10);
        if (baseValue !== null && Number.isFinite(exponent)) {
            const amount = baseValue * Math.pow(10, exponent);
            return { amount, unit: 'CFU', raw: cfuCoeffExponentMatch[0] };
        }
    }
    const cfuPureExponentMatch = cleaned.match(/\b10\^?(\d+)\s*cfu\b/i);
    if (cfuPureExponentMatch) {
        const exponent = Number.parseInt(cfuPureExponentMatch[1] ?? '', 10);
        if (Number.isFinite(exponent)) {
            return { amount: Math.pow(10, exponent), unit: 'CFU', raw: cfuPureExponentMatch[0] };
        }
    }
    const cfuMatch = cleaned.match(/(\d[\d,]*\.?\d*)\s*(billion|million)?\s*cfu\b/i);
    if (cfuMatch) {
        const baseValue = parseNumber(cfuMatch[1]);
        const scale = (cfuMatch[2] ?? '').toLowerCase();
        if (baseValue !== null) {
            const amount =
                scale === 'billion'
                    ? baseValue * 1e9
                    : scale === 'million'
                        ? baseValue * 1e6
                        : baseValue;
            return { amount, unit: 'CFU', raw: cfuMatch[0] };
        }
    }
    const rangeMatch = cleaned.match(/(\d[\d,]*\.?\d*)\s*(?:-|–|to)\s*(\d[\d,]*\.?\d*)\s*([a-zA-Zμµ%\.]+)/i);
    if (rangeMatch) {
        const rangeIndex = rangeMatch.index ?? cleaned.indexOf(rangeMatch[0]);
        if (!isRatioTail(cleaned, rangeIndex, rangeMatch[0].length)) {
            const minVal = parseNumber(rangeMatch[1]);
            const maxVal = parseNumber(rangeMatch[2]);
            const unit = normalizeUnit(rangeMatch[3] ?? '');
            if (minVal !== null && maxVal !== null && unit) {
                return { amount: (minVal + maxVal) / 2, unit, raw: rangeMatch[0] };
            }
        }
    }

    let percentCandidate: { amount: number; unit: string; raw: string } | null = null;
    const matches = cleaned.matchAll(/(\d[\d,]*\.?\d*)\s*([a-zA-Zμµ%\.]+)/g);
    for (const match of matches) {
        const matchIndex = match.index ?? cleaned.indexOf(match[0]);
        if (isRatioTail(cleaned, matchIndex, match[0].length)) continue;
        const amount = parseNumber(match[1]);
        const unit = normalizeUnit(match[2] ?? '');
        if (amount === null || !unit) continue;
        if (unit === '%') {
            if (!percentCandidate) {
                percentCandidate = { amount, unit, raw: match[0] };
            }
            continue;
        }
        return { amount, unit, raw: match[0] };
    }

    return percentCandidate;
}

export function parseAmountAndUnit(text: string): { amount: number | null; unit: string | null } {
    if (!text || text.trim().length === 0) {
        return { amount: null, unit: null };
    }

    const parsed = findAmountUnit(text);
    if (!parsed) {
        return { amount: null, unit: null };
    }

    return {
        amount: parsed.amount,
        unit: parsed.unit,
    };
}

function parseDvPercent(text: string): number | null {
    const match = text.replace(/[%†*]/g, '').trim().match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
}

function parseDvPercentFromTextLine(text: string): number | null {
    const lowered = text.toLowerCase();
    const directMatch = lowered.match(/(\d{1,3})\s*%\s*(?:dv|daily value|valeur|valeur quotidienne|vq)\b/);
    if (directMatch) {
        return parseInt(directMatch[1], 10);
    }

    if (/\b(dv|daily value|valeur|valeur quotidienne|vq)\b/.test(lowered)) {
        const percentMatch = lowered.match(/(\d{1,3})\s*%/);
        if (percentMatch) {
            return parseInt(percentMatch[1], 10);
        }
    }

    return null;
}

// ============================================================================
// TEXT PIPELINE (SECTION + LINE EXTRACTION)
// ============================================================================

type SectionKey = 'medicinal' | 'nonMedicinal' | 'directions' | 'warnings' | 'uses';

interface TextLine {
    raw: string;
    normalized: string;
    tokens: Token[];
    yCenter: number;
}

const TEXT_SECTION_PATTERNS: Record<SectionKey, RegExp[]> = {
    medicinal: [
        /medicinal ingredients?/i,
        /ingredients? medicinaux/i,
    ],
    nonMedicinal: [
        /non[-\s]?medicinal ingredients?/i,
        /ingredients? non[-\s]?medicinaux/i,
        /non[-\s]?medicinal/i,
    ],
    directions: [
        /directions?/i,
        /suggested use/i,
        /dose/i,
        /dosage/i,
        /mode d['’]?emploi/i,
        /posologie/i,
    ],
    warnings: [
        /warnings?/i,
        /cautions?/i,
        /keep out of reach/i,
        /mise en garde/i,
        /avertissement/i,
    ],
    uses: [
        /uses?/i,
        /usage/i,
        /indications?/i,
    ],
};

const TEXT_NOISE_PATTERNS: RegExp[] = [
    /\bmedicinal ingredients?\b/i,
    /\bnon[-\s]?medicinal\b/i,
    /\bingredients?\s+non[-\s]?medicinaux\b/i,
    /\bnpn\b/i,
    /\bdin\b/i,
    /\blot\b/i,
    /\bexpiry\b/i,
    /\bexp\b/i,
    /\bbest before\b/i,
    /\bkeep out of reach\b/i,
    /\bwarning\b/i,
    /\bstore\b/i,
    /\bsealed\b/i,
    /\bdo not use\b/i,
];

const TEXT_DIRECTION_WORDS = new Set([
    'take',
    'takes',
    'adult',
    'adults',
    'child',
    'children',
    'direction',
    'directions',
    'use',
    'usage',
    'dose',
    'dosage',
    'warning',
    'caution',
    'keep',
    'store',
    'suggested',
    'per',
    'each',
    'serving',
    'capsule',
    'capsules',
    'softgel',
    'softgels',
    'tablet',
    'tablets',
    'gummy',
    'gummies',
    'caplet',
    'caplets',
    'drop',
    'drops',
    'scoop',
    'packet',
    'stick',
    'contains',
    'contient',
]);

const TEXT_SERVING_PATTERNS: RegExp[] = [
    /\bserving size\b/i,
    /\bper\s+([0-9]+)?\s*(capsule|softgel|tablet|gummy|caplet|scoop|packet|stick|drop|ml)\b/i,
    /\beach\s+([0-9]+)?\s*(capsule|softgel|tablet|gummy|caplet|scoop|packet|stick|drop|ml)\b/i,
    /\bin each\s+([0-9]+)?\s*(capsule|softgel|tablet|gummy|caplet|scoop|packet|stick|drop|ml)\b/i,
    /\bpar\s+([0-9]+)?\s*(gelule|g[ée]lule|capsule|comprime|comprim[ée])\b/i,
    /\bchaque\s+([0-9]+)?\s*(gelule|g[ée]lule|capsule|comprime|comprim[ée])\b/i,
];

function normalizeForMatch(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’]/g, "'")
        .toLowerCase();
}

function buildTextLines(tokens: Token[], fullText?: string, rows?: Row[]): TextLine[] {
    if (shouldPreferFullText(tokens, fullText)) {
        return (fullText ?? '')
            .split(/\r?\n/)
            .map((raw, index) => ({
                raw,
                normalized: normalizeForMatch(raw),
                tokens: [],
                yCenter: index,
            }))
            .filter((line) => line.raw.trim().length > 0);
    }

    const rowSource = rows && rows.length > 0 ? rows : tokens.length > 0 ? inferTableRows(tokens) : [];
    if (rowSource.length > 0) {
        return rowSource.map((row) => {
            const raw = row.tokens.map((t) => t.text).join(' ');
            return {
                raw,
                normalized: normalizeForMatch(raw),
                tokens: row.tokens,
                yCenter: row.yCenter,
            };
        });
    }

    if (fullText) {
        return fullText
            .split(/\r?\n/)
            .map((raw, index) => ({
                raw,
                normalized: normalizeForMatch(raw),
                tokens: [],
                yCenter: index,
            }))
            .filter((line) => line.raw.trim().length > 0);
    }

    return [];
}

function detectSections(lines: TextLine[]): { sections: Partial<Record<SectionKey, TextLine[]>>; hasMedicinal: boolean } {
    const headerHits: { key: SectionKey; index: number }[] = [];
    const firstHit: Partial<Record<SectionKey, number>> = {};

    lines.forEach((line, index) => {
        (Object.keys(TEXT_SECTION_PATTERNS) as SectionKey[]).forEach((key) => {
            if (firstHit[key] !== undefined) return;
            const patterns = TEXT_SECTION_PATTERNS[key];
            const matches = patterns.some((pattern) => pattern.test(line.normalized));
            if (key === 'medicinal' && matches) {
                const isNonMedicinal = TEXT_SECTION_PATTERNS.nonMedicinal.some((pattern) => pattern.test(line.normalized));
                if (isNonMedicinal) return;
            }
            if (matches) {
                firstHit[key] = index;
                headerHits.push({ key, index });
            }
        });
    });

    headerHits.sort((a, b) => a.index - b.index);
    const sections: Partial<Record<SectionKey, TextLine[]>> = {};

    headerHits.forEach((hit, idx) => {
        const nextIndex = headerHits[idx + 1]?.index ?? lines.length;
        const start = hit.index + 1;
        if (start >= nextIndex) return;
        sections[hit.key] = lines.slice(start, nextIndex);
    });

    return {
        sections,
        hasMedicinal: firstHit.medicinal !== undefined,
    };
}

function mergeSplitLines(lines: TextLine[]): TextLine[] {
    const merged: TextLine[] = [];

    for (let i = 0; i < lines.length; i++) {
        const current = lines[i];
        const next = lines[i + 1];
        if (!current) continue;

        const currentAmount = findAmountUnit(current.raw);
        const currentHasAmount = Boolean(currentAmount && currentAmount.unit !== '%');
        const nextAmount = next ? findAmountUnit(next.raw) : null;
        const nextHasAmount = Boolean(nextAmount && nextAmount.unit !== '%');
        const currentEndsWithJoin = /[-:,(]$/.test(current.raw.trim());
        const nextStartsWithAmount = next ? /^\s*\d/.test(next.raw) : false;
        const currentIsHeader = (Object.keys(TEXT_SECTION_PATTERNS) as SectionKey[])
            .some((key) => TEXT_SECTION_PATTERNS[key].some((pattern) => pattern.test(current.normalized)));
        const currentIsShort = current.raw.trim().length <= 40;

        if (!currentHasAmount && next && nextHasAmount && !currentIsHeader && (currentEndsWithJoin || nextStartsWithAmount || currentIsShort)) {
            const raw = `${current.raw} ${next.raw}`.trim();
            merged.push({
                raw,
                normalized: normalizeForMatch(raw),
                tokens: [...(current.tokens ?? []), ...(next?.tokens ?? [])],
                yCenter: current.yCenter,
            });
            i += 1;
            continue;
        }

        merged.push(current);
    }

    return merged;
}

function isNoiseLine(normalized: string): boolean {
    if (!normalized) return true;
    return TEXT_NOISE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeIngredientName(name: string): string {
    return normalizeForMatch(name)
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function shouldPreferFullText(tokens: Token[], fullText?: string): boolean {
    if (!fullText || fullText.trim().length < 30) return false;
    if (tokens.length < 20) return true;
    const avgConfidence = tokens.reduce((sum, token) => sum + (token.confidence ?? 0), 0) / tokens.length;
    return avgConfidence < 0.55;
}

function stripDescriptors(name: string): string {
    const withoutParens = name.replace(/\([^)]*\)/g, ' ');
    return withoutParens
        .replace(/\b(as|from)\b.*$/i, ' ')
        .replace(/\b(whole|extract|powder|concentrate)\b/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function getIngredientKeys(name: string): { full: string; core: string } {
    const full = normalizeIngredientName(name);
    const core = normalizeIngredientName(stripDescriptors(name)) || full;
    return { full, core };
}

function scoreIngredientName(name: string): number {
    const normalized = normalizeForMatch(name);
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const lettersOnly = normalized.replace(/[^a-z]/g, '');
    let score = lettersOnly.length >= 3 ? 0.08 : -0.1;
    if (tokens.length >= 2) {
        score += 0.05;
    }
    if (tokens.some((token) => TEXT_DIRECTION_WORDS.has(token))) {
        score -= 0.15;
    }
    return score;
}

function inferServingSize(lines: TextLine[]): string | null {
    for (const line of lines) {
        for (const pattern of TEXT_SERVING_PATTERNS) {
            const match = line.raw.match(pattern);
            if (match) {
                const count = match[1] ? parseInt(match[1], 10) : null;
                const unitRaw = match[2] ?? '';
                const unitNormalized = normalizeForMatch(unitRaw).replace(/[^a-z]/g, '');
                if (pattern.source.includes('serving size')) {
                    return line.raw.trim();
                }
                if (!unitNormalized) continue;
                if (count && !Number.isNaN(count)) {
                    return `${count} ${unitNormalized}`;
                }
                return `per ${unitNormalized}`;
            }
        }
    }

    const directionMatch = lines
        .map((line) => line.raw)
        .join(' ')
        .match(/(?:take|takes|prendre|prenez)\s+(\d+)\s+(capsules?|softgels?|tablets?|gummies?|caplets?|drops?|gelules?|g[ée]lules?|comprim[ée]s?)/i);
    if (directionMatch) {
        const count = directionMatch[1];
        const unit = normalizeForMatch(directionMatch[2]).replace(/[^a-z]/g, '');
        return `${count} ${unit}`;
    }

    return null;
}

function parseTextLineToIngredient(line: TextLine, context?: { isMedicinal: boolean }): ParsedIngredient | null {
    const cleaned = line.raw.replace(/^[\s•*-]+/, '').trim();
    if (!cleaned) return null;
    if (isNoiseLine(line.normalized)) return null;

    const amountMatch = findAmountUnit(cleaned);
    if (!amountMatch || amountMatch.unit === '%') return null;

    const amountIndex = cleaned.indexOf(amountMatch.raw);
    let name = amountIndex >= 0 ? cleaned.slice(0, amountIndex).trim() : '';
    if (!name || name.length < 2) {
        name = cleaned.replace(amountMatch.raw, '').trim();
    }

    name = name
        .replace(/[†*‡§]/g, '')
        .replace(/^(?:each|in each|per|dans\s+chaque|par|chaque)\b.*?(?:contains|contient)\s*[:\-–—]?\s*/i, '')
        .replace(/^(?:each|in each|per|dans\s+chaque|par|chaque)\b\s+(?:capsules?|softgels?|tablets?|gummies?|caplets?|drops?|scoops?|packets?|sticks?|ml|gelules?|g[ée]lules?|comprim[ée]s?)\s*[:\-–—]?\s*/i, '')
        .replace(/[:\-–—]+$/g, '')
        .replace(/^[:\-–—]+/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (!name || name.length < 2) return null;

    const dvPercent = parseDvPercentFromTextLine(cleaned);
    const amount = amountMatch.amount;
    const unit = amountMatch.unit;

    let confidence = 0.55;
    if (context?.isMedicinal) {
        confidence += 0.15;
    }
    confidence += scoreIngredientName(name);
    confidence = Math.max(0.45, Math.min(0.9, confidence));

    return {
        name,
        amount,
        unit,
        dvPercent,
        confidence,
        rawLine: cleaned,
    };
}

function normalizeAmountForCompare(amount: number | null, unit: string | null, name?: string): number | null {
    if (amount === null || !unit) return null;
    const unitLower = unit.toLowerCase();
    if (unitLower === 'mg') return amount;
    if (unitLower === 'g') return amount * 1000;
    if (unitLower === 'mcg' || unitLower === 'μg') return amount / 1000;
    if (unitLower === 'iu' && name && /vitamin\s*d/i.test(name)) {
        const mcg = amount / 40;
        return mcg / 1000;
    }
    return null;
}

export function extractTextIngredients(
    tokens: Token[],
    fullText?: string,
    context?: {
        lines?: TextLine[];
        sections?: Partial<Record<SectionKey, TextLine[]>>;
        hasMedicinal?: boolean;
    }
): LabelDraft {
    const issues: ValidationIssue[] = [];
    const ingredients: ParsedIngredient[] = [];

    const lines = context?.lines ?? buildTextLines(tokens, fullText);
    const sectionInfo = context?.sections && context?.hasMedicinal !== undefined
        ? { sections: context.sections, hasMedicinal: context.hasMedicinal }
        : detectSections(lines);
    const { sections, hasMedicinal } = sectionInfo;
    const medicinalLines = sections.medicinal ?? [];
    const isMedicinalContext = Boolean(hasMedicinal && medicinalLines.length > 0);
    const targetLines = isMedicinalContext ? medicinalLines : lines;
    const filteredLines = targetLines.filter((line) => line.raw.trim().length > 0);
    const mergedLines = mergeSplitLines(filteredLines);

    const servingSize = inferServingSize(lines);
    if (!servingSize) {
        issues.push({ type: 'missing_serving_size', message: 'Serving size not found' });
    }

    let ingredientLikeLines = 0;
    let parsedWithAmountUnit = 0;

    for (const line of mergedLines) {
        if (!line.raw.trim()) continue;
        if (isNoiseLine(line.normalized)) continue;

        const amountCandidate = findAmountUnit(line.raw);
        const candidateHasAmount = Boolean(amountCandidate && amountCandidate.unit !== '%');
        if (candidateHasAmount) {
            ingredientLikeLines++;
        }

        const parsed = parseTextLineToIngredient(line, { isMedicinal: isMedicinalContext });
        if (parsed) {
            ingredients.push(parsed);
            if (parsed.amount !== null && parsed.unit !== null) {
                parsedWithAmountUnit++;
            }
        }
    }

    const parseCoverage = ingredientLikeLines > 0 ? parsedWithAmountUnit / ingredientLikeLines : 0;

    if (parseCoverage < 0.7) {
        issues.push({
            type: 'low_coverage',
            message: `Only ${Math.round(parseCoverage * 100)}% of lines have valid amount/unit`,
        });
    }

    if (!hasMedicinal && ingredients.length > 0) {
        issues.push({ type: 'header_not_found', message: 'Medicinal ingredients section not detected' });
    }

    for (const ing of ingredients) {
        issues.push(...validateIngredient(ing));
    }

    const confidenceScore = calculateConfidenceScore(ingredients, parseCoverage, issues);

    return {
        servingSize,
        ingredients,
        parseCoverage,
        confidenceScore,
        issues,
    };
}

function mergeDrafts(primary: LabelDraft, secondary: LabelDraft, allowSupplementBase: boolean): LabelDraft {
    const merged: ParsedIngredient[] = [];
    const secondaryEntries = secondary.ingredients.map((ingredient) => ({
        ingredient,
        keys: getIngredientKeys(ingredient.name),
    }));
    const usedIndices = new Set<number>();

    let matchCount = 0;
    let conflictCount = 0;

    for (const ingredient of primary.ingredients) {
        const primaryKeys = getIngredientKeys(ingredient.name);
        let matchIndex = -1;

        for (let i = 0; i < secondaryEntries.length; i++) {
            if (usedIndices.has(i)) continue;
            const candidate = secondaryEntries[i];
            if (candidate.keys.full === primaryKeys.full || candidate.keys.core === primaryKeys.core) {
                matchIndex = i;
                break;
            }
        }

        if (matchIndex === -1 && primaryKeys.core.length >= 4) {
            for (let i = 0; i < secondaryEntries.length; i++) {
                if (usedIndices.has(i)) continue;
                const candidateCore = secondaryEntries[i].keys.core;
                if (candidateCore.length < 4) continue;
                if (candidateCore.includes(primaryKeys.core) || primaryKeys.core.includes(candidateCore)) {
                    matchIndex = i;
                    break;
                }
            }
        }

        if (matchIndex >= 0) {
            const other = secondaryEntries[matchIndex].ingredient;
            const mergedIngredient = { ...ingredient };
            if (mergedIngredient.amount === null && other.amount !== null) {
                mergedIngredient.amount = other.amount;
                mergedIngredient.unit = other.unit;
            }
            mergedIngredient.dvPercent = mergedIngredient.dvPercent ?? other.dvPercent ?? null;
            mergedIngredient.confidence = Math.max(mergedIngredient.confidence, other.confidence);

            if (mergedIngredient.amount !== null && other.amount !== null && mergedIngredient.unit && other.unit) {
                const primaryNorm = normalizeAmountForCompare(mergedIngredient.amount, mergedIngredient.unit, mergedIngredient.name);
                const secondaryNorm = normalizeAmountForCompare(other.amount, other.unit, other.name);
                if (primaryNorm !== null && secondaryNorm !== null) {
                    const diff = Math.abs(primaryNorm - secondaryNorm);
                    const tolerance = Math.max(primaryNorm, secondaryNorm) * 0.1;
                    if (diff <= tolerance) {
                        matchCount++;
                    } else {
                        conflictCount++;
                    }
                } else if (mergedIngredient.unit === other.unit) {
                    const diff = Math.abs(mergedIngredient.amount - other.amount);
                    const tolerance = Math.max(mergedIngredient.amount, other.amount) * 0.1;
                    if (diff <= tolerance) {
                        matchCount++;
                    } else {
                        conflictCount++;
                    }
                } else {
                    conflictCount++;
                }
            }

            merged.push(mergedIngredient);
            usedIndices.add(matchIndex);
        } else {
            merged.push(ingredient);
        }
    }

    const allowSupplement = allowSupplementBase || matchCount > 0;
    if (allowSupplement) {
        for (let i = 0; i < secondaryEntries.length; i++) {
            if (usedIndices.has(i)) continue;
            const remaining = secondaryEntries[i].ingredient;
            if (remaining.confidence < 0.6 || remaining.amount === null || !remaining.unit) {
                continue;
            }
            merged.push({
                ...remaining,
                confidence: Math.min(1, remaining.confidence * 0.8),
            });
        }
    }

    const issues = [...primary.issues];
    for (const issue of secondary.issues) {
        if (!issues.some((existing) => existing.type === issue.type && existing.message === issue.message)) {
            issues.push(issue);
        }
    }

    if (conflictCount > 0) {
        issues.push({
            type: 'value_anomaly',
            message: 'Conflicting ingredient amounts detected across label formats',
        });
    }

    let confidenceScore = Math.max(primary.confidenceScore, secondary.confidenceScore);
    if (matchCount > 0) {
        confidenceScore = Math.min(1, confidenceScore + 0.1 + matchCount * 0.03);
    }
    if (conflictCount > 0) {
        confidenceScore = Math.max(0, confidenceScore - conflictCount * 0.1);
    }

    return {
        servingSize: primary.servingSize ?? secondary.servingSize,
        ingredients: merged,
        parseCoverage: Math.max(primary.parseCoverage, secondary.parseCoverage),
        confidenceScore,
        issues,
    };
}

function detectTableFeatures(lines: TextLine[], fullText?: string): boolean {
    const normalizedFull = fullText ? normalizeForMatch(fullText) : '';
    const keywordHit = /supplement facts|nutrition facts|amount per serving|%dv|daily value/.test(normalizedFull);
    const headerHit = lines.some((line) => {
        const text = line.normalized;
        const hasAmount = text.includes('amount') || text.includes('per serving');
        const hasDv = text.includes('%dv') || text.includes('daily value') || text.includes('dv');
        return hasAmount && hasDv;
    });
    return keywordHit || headerHit;
}

function detectTextFeatures(lines: TextLine[], fullText?: string): boolean {
    const normalizedFull = fullText ? normalizeForMatch(fullText) : '';
    const strongKeywordHit = /medicinal ingredients|ingredients medicinaux|product facts/.test(normalizedFull);
    const sectionHits = new Set<SectionKey>();
    lines.forEach((line) => {
        (Object.keys(TEXT_SECTION_PATTERNS) as SectionKey[]).forEach((key) => {
            if (TEXT_SECTION_PATTERNS[key].some((pattern) => pattern.test(line.normalized))) {
                if (key === 'medicinal') {
                    const isNonMedicinal = TEXT_SECTION_PATTERNS.nonMedicinal.some((pattern) => pattern.test(line.normalized));
                    if (isNonMedicinal) return;
                }
                sectionHits.add(key);
            }
        });
    });

    if (sectionHits.has('medicinal')) return true;
    if (strongKeywordHit) return true;
    return sectionHits.size >= 2;
}

export function analyzeLabelDraft(tokens: Token[], fullText?: string): LabelDraft {
    const rows = inferTableRows(tokens);
    const textLines = buildTextLines(tokens, fullText, rows);
    const tableDraft = extractIngredients(rows);
    const sectionInfo = detectSections(textLines);
    const textDraft = extractTextIngredients(tokens, fullText, {
        lines: textLines,
        sections: sectionInfo.sections,
        hasMedicinal: sectionInfo.hasMedicinal,
    });

    const tableLikely = detectTableFeatures(textLines, fullText);
    const textLikely = detectTextFeatures(textLines, fullText);

    if (tableLikely && textLikely) {
        return mergeDrafts(tableDraft, textDraft, sectionInfo.hasMedicinal);
    }

    if (tableLikely) return tableDraft;
    if (textLikely) return textDraft;

    return tableDraft.confidenceScore >= textDraft.confidenceScore ? tableDraft : textDraft;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate individual ingredient
 */
export function validateIngredient(ing: ParsedIngredient): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check unit validity
    if (ing.unit && !VALID_UNITS.has(ing.unit.toLowerCase())) {
        issues.push({
            type: 'unit_invalid',
            message: `Invalid unit "${ing.unit}" for ${ing.name}`,
        });
    }

    // Sanity check for known ingredients
    if (ing.amount !== null && ing.unit) {
        const lowerName = ing.name.toLowerCase();
        for (const [key, limits] of Object.entries(SANITY_LIMITS)) {
            if (lowerName.includes(key)) {
                if (limits.units.includes(ing.unit.toLowerCase()) && ing.amount > limits.maxAmount) {
                    issues.push({
                        type: 'value_anomaly',
                        message: `${ing.name} amount ${ing.amount} ${ing.unit} exceeds typical max ${limits.maxAmount}`,
                    });
                }
                break;
            }
        }
    }

    return issues;
}

// ============================================================================
// CONFIDENCE CALCULATION
// ============================================================================

function calculateConfidenceScore(
    ingredients: ParsedIngredient[],
    parseCoverage: number,
    issues: ValidationIssue[]
): number {
    let score = 1.0;

    // Coverage penalty
    if (parseCoverage < 0.7) {
        score -= (0.7 - parseCoverage) * 0.5;
    }

    // Issue penalties
    const severityMap: Record<ValidationIssue['type'], number> = {
        missing_serving_size: 0.15,
        header_not_found: 0.1,
        low_coverage: 0.2,
        unit_invalid: 0.1,
        value_anomaly: 0.15,
    };

    const issueCounts: Record<ValidationIssue['type'], number> = {
        missing_serving_size: 0,
        header_not_found: 0,
        low_coverage: 0,
        unit_invalid: 0,
        value_anomaly: 0,
    };

    for (const issue of issues) {
        issueCounts[issue.type] = (issueCounts[issue.type] ?? 0) + 1;
    }

    for (const type of Object.keys(issueCounts) as ValidationIssue['type'][]) {
        const count = issueCounts[type];
        if (!count) continue;
        const cap = type === 'unit_invalid' || type === 'value_anomaly' ? 2 : 1;
        score -= (severityMap[type] ?? 0.05) * Math.min(count, cap);
    }

    // Ingredient confidence average
    if (ingredients.length > 0) {
        const avgIngredientConf = ingredients.reduce((s, i) => s + i.confidence, 0) / ingredients.length;
        score = score * 0.7 + avgIngredientConf * 0.3;
    }

    return Math.max(0, Math.min(1, score));
}

/**
 * Determine if draft needs user confirmation
 */
export function needsConfirmation(draft: LabelDraft): boolean {
    if (draft.confidenceScore < 0.7) return true;
    if (draft.parseCoverage < 0.7) return true;
    if (draft.issues.some((i) => i.type === 'missing_serving_size')) return true;
    if (draft.issues.some((i) => i.type === 'unit_invalid')) return true;
    if (draft.issues.some((i) => i.type === 'value_anomaly')) return true;
    return false;
}

/**
 * Format ingredients for DeepSeek analysis context
 */
export function formatForDeepSeek(draft: LabelDraft): string {
    const lines: string[] = [];

    if (draft.servingSize) {
        lines.push(`Serving Size: ${draft.servingSize}`);
    }

    lines.push('');
    lines.push('Ingredients:');

    for (const ing of draft.ingredients) {
        let line = `- ${ing.name}`;
        if (ing.amount !== null && ing.unit) {
            line += `: ${ing.amount} ${ing.unit}`;
        }
        if (ing.dvPercent !== null) {
            line += ` (${ing.dvPercent}% DV)`;
        }
        lines.push(line);
    }

    return lines.join('\n');
}
