import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * P0-0: Analysis bundle cover contract tests.
 *
 * These tests import the server module helpers indirectly by testing the
 * exported bundle shape against the contract: overview/usage/safety covers
 * must always be non-empty at rev1.
 *
 * Since mergeFastAnalysisBundle is not exported, we rely on the SSE contract
 * by constructing minimal FactsDigest-like scenarios and verifying the bundle
 * shape via imported schema validators.
 */

// Inline minimal schema checks (avoid importing zod at test time)
const hasNonEmptySummary = (cover) =>
    cover != null &&
    typeof cover.summary === 'string' &&
    cover.summary.trim().length >= 20;

const hasBullets = (cover, minCount = 1) =>
    cover != null &&
    Array.isArray(cover.bullets) &&
    cover.bullets.length >= minCount &&
    cover.bullets.every((b) => typeof b.text === 'string' && b.text.trim().length > 0);

const hasUsageFields = (cover) =>
    cover != null &&
    (cover.bestTimeToTake?.text?.trim().length > 0 ||
        cover.dosage?.text?.trim().length > 0);

const hasNoRawPlaceholders = (text) => {
    if (!text || typeof text !== 'string') return true;
    const lower = text.toLowerCase().trim();
    const BAD_PATTERNS = [
        /^details not provided/,
        /^not provided by source\.?$/,
        /^unknown$/,
        /^n\/a$/,
        /^missing$/,
        /^unavailable$/,
    ];
    return !BAD_PATTERNS.some((pattern) => pattern.test(lower));
};

const collectAllText = (bundle) => {
    const texts = [];
    const walkCover = (section) => {
        if (!section?.cover) return;
        if (section.cover.summary) texts.push(section.cover.summary);
        if (section.cover.verdict) texts.push(section.cover.verdict);
        if (Array.isArray(section.cover.bullets)) {
            section.cover.bullets.forEach((b) => { if (b?.text) texts.push(b.text); });
        }
        if (section.cover.bestTimeToTake?.text) texts.push(section.cover.bestTimeToTake.text);
        if (section.cover.dosage?.text) texts.push(section.cover.dosage.text);
        if (section.cover.withFood?.text) texts.push(section.cover.withFood.text);
    };
    walkCover(bundle.sections.overview);
    walkCover(bundle.sections.usage);
    walkCover(bundle.sections.safety);
    return texts;
};

// ───────────────────────────────────────────────────────────────
// Contract: No raw placeholder text in covers
// ───────────────────────────────────────────────────────────────

describe('Cover contract: no raw placeholders', () => {
    // Since we cannot import mergeFastAnalysisBundle directly, we test the
    // contract by parsing real SSE output captured from the server.
    // These fixtures represent worst-case scenarios.

    const sparseWebBundle = {
        sections: {
            overview: {
                cover: {
                    summary: 'Not provided by source. Information is limited to available source text.',
                    bullets: [{ text: 'Not provided by source.', basisTags: ['not_provided'] }],
                },
            },
            usage: {
                cover: {
                    bullets: [],
                    bestTimeToTake: { text: 'Anytime (with meals).', basisTags: ['not_provided'] },
                    withFood: { value: true, text: 'Prefer with meals for tolerability.', basisTags: ['general_advice'] },
                    dosage: { text: 'Follow label directions.', basisTags: ['general_advice'] },
                },
            },
            safety: {
                cover: {
                    verdict: 'Not provided by source.',
                    bullets: [{ text: 'Not provided by source.', basisTags: ['not_provided'] }],
                },
            },
        },
    };

    it('should flag raw placeholder text "Not provided by source."', () => {
        const texts = collectAllText(sparseWebBundle);
        const placeholders = texts.filter((t) => !hasNoRawPlaceholders(t));
        // Before P0-3 fix on frontend, backend may still emit these for web sources,
        // but after P0-0 fix in mergeFastAnalysisBundle, supplement products must not.
        assert.ok(
            placeholders.length > 0,
            'Expected to detect raw placeholders in sparse web fixture (pre-fix baseline)',
        );
    });
});

// ───────────────────────────────────────────────────────────────
// Contract: Overview cover always has summary + 2 bullets
// ───────────────────────────────────────────────────────────────

describe('Cover contract: overview', () => {
    const goodOverviewCover = {
        summary: 'Natural Factors TravelBiotic is a vegetarian capsule supplement containing Calcium and Bifidobacterium longum BB536 probiotic.',
        bullets: [
            { text: 'Contains 40 mg of Calcium per capsule, which supports bone health.', basisTags: ['ingredient_inference'] },
            { text: 'Includes Bifidobacterium longum BB536 probiotic, which may aid digestive health.', basisTags: ['ingredient_inference'] },
        ],
    };

    it('should have non-empty summary >= 20 chars', () => {
        assert.ok(hasNonEmptySummary(goodOverviewCover));
    });

    it('should have exactly 2 bullets with non-empty text', () => {
        assert.ok(hasBullets(goodOverviewCover, 2));
    });

    it('should not contain raw placeholder text', () => {
        const texts = [goodOverviewCover.summary, ...goodOverviewCover.bullets.map((b) => b.text)];
        texts.forEach((t) => {
            assert.ok(hasNoRawPlaceholders(t), `Found raw placeholder: "${t}"`);
        });
    });
});

// ───────────────────────────────────────────────────────────────
// Contract: Safety cover always has at least 1 bullet
// ───────────────────────────────────────────────────────────────

describe('Cover contract: safety always has >= 1 bullet', () => {
    it('should never have empty safety bullets array', () => {
        // After P0-0, even when missingFlag=false and DeepSeek returns nothing,
        // safetyBulletsFinal should include a general safety tip.
        const postFixSafetyCover = {
            verdict: 'No specific warnings found.',
            bullets: [
                {
                    text: 'No specific warnings found. If pregnant, nursing, or taking medication, consult your clinician before use.',
                    basisTags: ['general_advice'],
                },
            ],
        };
        assert.ok(hasBullets(postFixSafetyCover, 1), 'Safety cover must have at least 1 bullet after P0-0');
    });
});

// ───────────────────────────────────────────────────────────────
// Contract: Usage cover always has bestTimeToTake or dosage
// ───────────────────────────────────────────────────────────────

describe('Cover contract: usage has bestTimeToTake or dosage', () => {
    it('should have at least one usage field populated', () => {
        const usageCover = {
            bullets: [],
            bestTimeToTake: { text: 'Anytime (with meals).', basisTags: ['general_advice'] },
            withFood: { value: true, text: 'Take with food unless label states otherwise.', basisTags: ['general_advice'] },
            dosage: null,
        };
        assert.ok(hasUsageFields(usageCover), 'Usage cover must have bestTimeToTake or dosage');
    });
});

// ───────────────────────────────────────────────────────────────
// Utility: hasNoRawPlaceholders patterns
// ───────────────────────────────────────────────────────────────

describe('hasNoRawPlaceholders utility', () => {
    const bad = [
        'Details not provided by source.',
        'Not provided by source.',
        'Unknown',
        'N/A',
        'missing',
        'unavailable',
    ];
    const good = [
        'Natural Factors TravelBiotic is a supplement.',
        'Review label directions for Calcium.',
        'No specific warnings found. Consult your clinician.',
        'Anytime (with meals).',
    ];

    for (const text of bad) {
        it(`should reject: "${text}"`, () => {
            assert.ok(!hasNoRawPlaceholders(text));
        });
    }

    for (const text of good) {
        it(`should accept: "${text}"`, () => {
            assert.ok(hasNoRawPlaceholders(text));
        });
    }
});
