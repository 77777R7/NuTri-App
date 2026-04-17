import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAuthDisabled } from '../../lib/auth-mode-policy';

const baseInput = {
  disableFromEnv: false,
  forceAuthFromEnv: false,
  disableFromExtra: false,
  forceAuthFromExtra: false,
  isExpoGo: false,
  disableForPrivateApiHost: false,
  isDevRuntime: true,
};

test('auth bypass is always disabled outside dev runtime', () => {
  assert.equal(
    resolveAuthDisabled({
      ...baseInput,
      disableFromEnv: true,
      disableFromExtra: true,
      isExpoGo: true,
      disableForPrivateApiHost: true,
      isDevRuntime: false,
    }),
    false,
  );
});

test('dev runtime can disable auth for explicit dev flags and Expo Go/private hosts', () => {
  assert.equal(resolveAuthDisabled({ ...baseInput, disableFromEnv: true }), true);
  assert.equal(resolveAuthDisabled({ ...baseInput, disableFromExtra: true }), true);
  assert.equal(resolveAuthDisabled({ ...baseInput, isExpoGo: true }), true);
  assert.equal(resolveAuthDisabled({ ...baseInput, disableForPrivateApiHost: true }), true);
});

test('force auth wins over dev auth bypass inputs', () => {
  assert.equal(
    resolveAuthDisabled({
      ...baseInput,
      disableFromEnv: true,
      disableFromExtra: true,
      isExpoGo: true,
      disableForPrivateApiHost: true,
      forceAuthFromEnv: true,
    }),
    false,
  );

  assert.equal(
    resolveAuthDisabled({
      ...baseInput,
      disableFromEnv: true,
      forceAuthFromExtra: true,
    }),
    false,
  );
});
