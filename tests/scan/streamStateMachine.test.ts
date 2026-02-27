import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasMeaningfulPartialData,
  isUsableResultBundle,
  parseStreamErrorEvent,
  resolveDoneTerminalStatus,
  resolveTerminalStatus,
  shouldTreatStreamErrorAsPartialComplete,
} from '../../lib/scan/streamStateMachine';

const makeBundle = (params: { revision: number; statuses: Array<'pending' | 'complete' | 'limited' | 'error' | 'not_provided'> }) => ({
  meta: {
    schemaVersion: 4,
    promptVersion: 'test',
    sourceType: 'web',
    sourceTypeFinal: params.revision >= 1,
    scoreAvailable: false,
    detailReady: params.revision >= 1,
    authoritativeIdentity: { type: 'gtin14', value: '00012345678901' },
    locale: 'en',
    phase: params.revision >= 1 ? 'fast_ai' : 'skeleton',
    bundleId: 'bundle-test',
    revision: params.revision,
    factsDigestHash: 'digest',
    factsSourceVersion: 'test',
  },
  sections: {
    overview: { layout: 'overview_card', cover: null, detail: null, dataStatus: params.statuses[0] },
    ingredients: { layout: 'ingredients_list', cover: { items: [], totalCount: 0 }, detail: null, dataStatus: params.statuses[1] },
    usage: { layout: 'usage_bullets', cover: null, detail: null, dataStatus: params.statuses[2] },
    safety: { layout: 'safety_bullets', cover: null, detail: null, dataStatus: params.statuses[3] },
  },
}) as any;

test('terminal lock: not_found cannot be overwritten by done', () => {
  const next = resolveTerminalStatus({
    previousStatus: 'not_found',
    nextStatus: 'complete',
  });
  assert.equal(next, 'not_found');
});

test('terminal lock: error cannot be overwritten by complete', () => {
  const next = resolveTerminalStatus({
    previousStatus: 'error',
    nextStatus: 'complete',
  });
  assert.equal(next, 'error');
});

test('usable bundle gate: rev0 skeleton is not usable', () => {
  const skeleton = makeBundle({
    revision: 0,
    statuses: ['pending', 'pending', 'pending', 'pending'],
  });
  assert.equal(isUsableResultBundle(skeleton), false);
});

test('done transition: skeleton-only stream is error (not empty success)', () => {
  const terminal = resolveDoneTerminalStatus({
    analysisBundle: makeBundle({
      revision: 0,
      statuses: ['pending', 'pending', 'pending', 'pending'],
    }),
  });
  assert.equal(terminal, 'error');
});

test('done transition: usable bundle reaches complete', () => {
  const terminal = resolveDoneTerminalStatus({
    analysisBundle: makeBundle({
      revision: 1,
      statuses: ['complete', 'pending', 'pending', 'pending'],
    }),
  });
  assert.equal(terminal, 'complete');
});

test('done transition: empty legacy sections are error', () => {
  const terminal = resolveDoneTerminalStatus({
    analysisBundle: makeBundle({
      revision: 0,
      statuses: ['pending', 'pending', 'pending', 'pending'],
    }),
  });
  assert.equal(terminal, 'error');
});

test('done transition: legacy-only payload does not reach complete', () => {
  const terminal = resolveDoneTerminalStatus({
    analysisBundle: null,
  });
  assert.equal(terminal, 'error');
});

test('error parsing prefers code NOT_FOUND over message fallback', () => {
  const parsed = parseStreamErrorEvent({
    payload: {
      code: 'NOT_FOUND',
      stage: 'search',
      reasonCode: 'NO_SERP',
      message: 'Product not found',
    },
  });
  assert.equal(parsed.kind, 'not_found');
  assert.equal(parsed.reasonCode, 'NO_SERP');
  assert.equal(parsed.stage, 'search');
});

test('401 error routes to unauthorized recoverable error', () => {
  const parsed = parseStreamErrorEvent({
    xhrStatus: 401,
    fallbackMessage: 'Unauthorized',
  });
  assert.equal(parsed.kind, 'unauthorized');
});

test('network transport message routes to recoverable network error', () => {
  const parsed = parseStreamErrorEvent({
    fallbackMessage: 'Could not connect to the server',
  });
  assert.equal(parsed.kind, 'network');
});

test('global timeout rev0-only is treated as partial complete when product identity exists', () => {
  const shouldTreatAsComplete = shouldTreatStreamErrorAsPartialComplete({
    reasonCode: 'GLOBAL_TIMEOUT_REV0_ONLY',
    state: {
      analysisBundle: makeBundle({
        revision: 0,
        statuses: ['pending', 'pending', 'pending', 'pending'],
      }),
      productInfo: {
        name: 'Vitamin D3 1000IU',
        brand: 'Jamieson',
      },
      sources: [],
    },
  });
  assert.equal(shouldTreatAsComplete, true);
});

test('global timeout rev0-only without meaningful data remains an error', () => {
  const skeletonOnlyState = {
    analysisBundle: makeBundle({
      revision: 0,
      statuses: ['pending', 'pending', 'pending', 'pending'],
    }),
    productInfo: null,
    brandExtraction: null,
    sources: [],
  };
  assert.equal(hasMeaningfulPartialData(skeletonOnlyState), false);
  assert.equal(
    shouldTreatStreamErrorAsPartialComplete({
      reasonCode: 'GLOBAL_TIMEOUT_REV0_ONLY',
      state: skeletonOnlyState,
    }),
    false,
  );
});

test('rev1 watchdog timeout is treated as partial complete when usable rev1 bundle exists', () => {
  const shouldTreatAsComplete = shouldTreatStreamErrorAsPartialComplete({
    reasonCode: 'REV1_WATCHDOG_TIMEOUT',
    state: {
      analysisBundle: makeBundle({
        revision: 1,
        statuses: ['limited', 'pending', 'limited', 'limited'],
      }),
      productInfo: null,
      brandExtraction: null,
      sources: [],
    },
  });
  assert.equal(shouldTreatAsComplete, true);
});

test('degraded eventloop reason requires meaningful data before partial complete', () => {
  const shouldTreatAsComplete = shouldTreatStreamErrorAsPartialComplete({
    reasonCode: 'DEGRADED_EVENTLOOP',
    state: {
      analysisBundle: makeBundle({
        revision: 0,
        statuses: ['pending', 'pending', 'pending', 'pending'],
      }),
      productInfo: null,
      brandExtraction: null,
      sources: [],
    },
  });
  assert.equal(shouldTreatAsComplete, false);
});

test('bundle-only authoritative-miss reason is treated as partial complete when meaningful data exists', () => {
  const shouldTreatAsComplete = shouldTreatStreamErrorAsPartialComplete({
    reasonCode: 'BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH',
    state: {
      analysisBundle: makeBundle({
        revision: 1,
        statuses: ['limited', 'limited', 'limited', 'limited'],
      }),
      productInfo: {
        name: 'Unknown Product',
        brand: null,
      },
      brandExtraction: null,
      sources: [],
    },
  });
  assert.equal(shouldTreatAsComplete, true);
});
