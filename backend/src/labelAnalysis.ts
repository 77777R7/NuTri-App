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

const VALID_UNITS = new Set(['mg', 'mcg', 'μg', 'g', 'iu', 'ml', '%']);
const UNIT_NORMALIZATIONS: Record<string, string> = {
    'μg': 'mcg',
    'ug': 'mcg',
    'micrograms': 'mcg',
    'milligrams': 'mg',
    'grams': 'g',
    'international units': 'IU',
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
        /^daily\s*value/i,
        /^\*\s*percent/i,
        /^suggested\s*use/i,
        /^warning/i,
        /^allergen/i,
        /^manufactured/i,
        /^not\s*a\s*significant/i,
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
        const trailingMatch = cellText.match(/^(.+?)\s+(\d[\d,]*\.?\d*)\s*([a-zA-Zμ%]+)\s*$/);
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
export function parseAmountAndUnit(text: string): { amount: number | null; unit: string | null } {
    if (!text || text.trim().length === 0) {
        return { amount: null, unit: null };
    }

    const cleaned = text
        .replace(/[<>≤≥]/g, '')
        .replace(/,/g, '')
        .trim();

    // Match patterns like "25 mcg", "1000mg", "2.5 g"
    const match = cleaned.match(/^(\d+\.?\d*)\s*([a-zA-Zμ%]+)/i);
    if (!match) {
        return { amount: null, unit: null };
    }

    const amountRaw = parseFloat(match[1]);
    let unitRaw = match[2].toLowerCase();

    // Normalize unit
    if (UNIT_NORMALIZATIONS[unitRaw]) {
        unitRaw = UNIT_NORMALIZATIONS[unitRaw];
    }

    const normalizedUnit = unitRaw.toUpperCase() === 'IU' ? 'IU' : unitRaw;

    return {
        amount: isNaN(amountRaw) ? null : amountRaw,
        unit: normalizedUnit,
    };
}

function parseDvPercent(text: string): number | null {
    const match = text.replace(/[%†*]/g, '').trim().match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
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

    for (const issue of issues) {
        score -= severityMap[issue.type] ?? 0.05;
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
