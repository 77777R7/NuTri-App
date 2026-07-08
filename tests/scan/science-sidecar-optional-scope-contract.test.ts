import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_PATH = path.resolve(process.cwd(), 'components/scan/AnalysisDashboard.tsx');

test('science sidecars can render from inline decision payloads without a precomputed scope hash', async () => {
    const source = await readFile(DASHBOARD_PATH, 'utf8');

    assert.match(
        source,
        /const scienceDecisionInputsHash =\s*normalizeText\(scienceSidecarDecisionPayload\?\.decisionInputsHash \?\? null\)\s*\|\| currentDecisionInputsHash/s,
    );
    assert.match(source, /const sciencePersonalizationScopeKey =/);
    assert.match(source, /shouldUseLocalDecisionSupport\s*\?\s*`local:\$\{localDecisionSupportProfileKey \?\? 'pending'\}`/);
    assert.match(
        source,
        /const shouldPrimeScienceSidecars =\s*scienceSidecarDecisionPayload != null\s*&& Boolean\(decisionBarcodeForScience\)\s*&& Boolean\(decisionDigestForScience\)\s*&& Boolean\(scienceDecisionInputsHash\);/s,
    );
    assert.equal(
        source.includes('&& Boolean(sciencePersonalizationScopeHash);'),
        false,
        'missing personalizationScopeHash should not block sidecar requests',
    );
    assert.equal(
        (source.match(/if \(personalizationScopeHashParam\) {\s*requestBody\.personalizationScopeHash = personalizationScopeHashParam;\s*}/g) ?? []).length,
        2,
        'ingredient overview and scientific background should send scope only when available',
    );
});
