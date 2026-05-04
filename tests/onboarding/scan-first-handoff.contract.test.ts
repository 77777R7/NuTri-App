import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../app/onboarding/first-stack.tsx', import.meta.url),
  'utf8',
);
const sharedFlowSource = readFileSync(
  new URL('../../components/onboarding/flow/SummaryFlowScenes.tsx', import.meta.url),
  'utf8',
);

test('first-stack promotes scan as the only primary action', () => {
  assert.match(source, /<ScanFirstHeroBodyContent/);
  assert.match(source, /continueLabel="Scan my first supplement"/);
  assert.match(source, /Search instead/);
  assert.match(source, /Do this later/);
});

test('first-stack builds lightweight proof from onboarding inputs', () => {
  assert.match(source, /buildFirstStackProofItems/);
  assert.match(source, /draft\?\.preferredTypes/);
  assert.match(source, /draft\?\.adherenceBlocker/);
});

test('shared flow mirrors the scan-first handoff labels instead of the legacy chooser shell', () => {
  assert.match(sharedFlowSource, /continueLabel: 'See my first step'/);
  assert.match(sharedFlowSource, /continueLabel: 'Scan my first supplement'/);
  assert.match(sharedFlowSource, /title="Your first step is ready"/);
  assert.match(
    sharedFlowSource,
    /subtitle="We matched your goals and routine to the easiest place to begin\."/,
  );
  assert.match(sharedFlowSource, /Scan your first supplement/);
  assert.match(sharedFlowSource, /Search instead/);
  assert.match(sharedFlowSource, /Do this later/);
  assert.doesNotMatch(sharedFlowSource, /Unlock My Plan/);
  assert.doesNotMatch(sharedFlowSource, /Build your first stack/);
  assert.doesNotMatch(sharedFlowSource, /How do you want to start\?/);
  assert.doesNotMatch(sharedFlowSource, /<FirstStackBodyContent/);
});

test('shared flow uses the same scan manual later action model as standalone handoff', () => {
  assert.match(sharedFlowSource, /handleContinueSelection\(PRIMARY_FIRST_STACK_ACTION\)/);
  assert.match(sharedFlowSource, /onSearchInstead=\{\(\) => void handleContinueSelection\('manual'\)\}/);
  assert.match(sharedFlowSource, /onDoLater=\{\(\) => void handleContinueSelection\('later'\)\}/);
  assert.match(sharedFlowSource, /answer: action/);
  assert.match(sharedFlowSource, /selectedAction: action/);
  assert.match(sharedFlowSource, /actionKey: action/);
  assert.match(sharedFlowSource, /field: 'firstActionPreference'/);
  assert.match(sharedFlowSource, /value: action/);
});
