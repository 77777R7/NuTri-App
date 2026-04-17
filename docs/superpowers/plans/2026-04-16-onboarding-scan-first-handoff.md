# Onboarding Scan-First Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `plan-preview -> first-stack -> scan` handoff into a scan-first flow that feels personalized and increases first real-use conversion.

**Architecture:** Keep the existing onboarding/personalization wiring, but change the handoff UX. `plan-preview` becomes a stronger bridge into the final page, while `first-stack` stops being a three-way selector and becomes a scan-first hero with lightweight proof and weaker secondary exits. Preserve scan routing and result behavior by limiting changes to onboarding pages, shared flow scenes, and onboarding analytics wiring.

**Tech Stack:** Expo Router, React Native, React Native Reanimated, existing onboarding shell components, Node `node:test` contract tests, ESLint

---

## File Structure

- Modify: `app/onboarding/plan-preview.tsx`
  - Refresh handoff copy and footer CTA so the page sets up a single “see my first step” transition.
- Modify: `app/onboarding/first-stack.tsx`
  - Replace equal-choice start options with a scan-first hero, concise personalized proof, and weak secondary exits.
- Modify: `components/onboarding/flow/SummaryFlowScenes.tsx`
  - Keep the shared-flow implementation in lockstep with standalone `plan-preview` and `first-stack`.
- Modify: `tests/onboarding/plan-preview.contract.test.ts`
  - Guard the new preview copy and CTA label.
- Modify: `tests/onboarding/first-stack.analytics.test.ts`
  - Guard analytics continuity after the scan-first refactor.
- Create: `tests/onboarding/scan-first-handoff.contract.test.ts`
  - Guard the new scan-first hero structure and shared-flow parity.

## Constraints

- Do **not** change barcode scan UX, scan result rendering, scan-side networking, or scan result navigation behavior.
- Reuse the existing onboarding completion path in `app/onboarding/done.tsx`; do not redesign scan entry.
- Keep shared-flow and standalone onboarding behavior aligned.
- Execute implementation in a clean worktree because the current checkout is dirty and has a previously enlarged commit in history.

### Task 1: Create an Isolated Worktree

**Files:**
- Create: none
- Modify: none
- Test: none

- [ ] **Step 1: Create a clean worktree for this feature**

```bash
cd /Users/howard07/NuTriApp/nutri-app
git worktree add /Users/howard07/NuTriApp/nutri-app-scan-first-handoff -b codex/onboarding-scan-first-handoff
```

Expected: Git prints `Preparing worktree` and creates `/Users/howard07/NuTriApp/nutri-app-scan-first-handoff`.

- [ ] **Step 2: Open the new worktree and confirm the plan/spec files are present**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
ls docs/superpowers/specs/2026-04-16-onboarding-scan-first-handoff-design.md
ls docs/superpowers/plans/2026-04-16-onboarding-scan-first-handoff.md
```

Expected: Both `ls` commands print the full file paths with no errors.

- [ ] **Step 3: Confirm the worktree starts clean before implementation**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
git status --short
```

Expected: no output.

- [ ] **Step 4: Commit the worktree setup checkpoint**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
git status --short
```

Expected: still no output, so there is nothing to commit yet and the worktree is safe to use.

### Task 2: Refresh `plan-preview` So It Hands Off to One First Step

**Files:**
- Modify: `app/onboarding/plan-preview.tsx`
- Modify: `tests/onboarding/plan-preview.contract.test.ts`
- Test: `tests/onboarding/plan-preview.contract.test.ts`

- [ ] **Step 1: Update the contract test to describe the new handoff copy**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app-scan-first-handoff/app/onboarding/plan-preview.tsx',
  'utf8',
);

test('plan-preview primes the user for one clear first step', () => {
  assert.match(source, /We found your easiest first step/);
  assert.match(
    source,
    /We used your goals, preferences, and routine to choose the easiest place to begin\./,
  );
  assert.match(source, /QAContinueCTA title="See my first step"/);
  assert.doesNotMatch(source, /Here is your plan/);
  assert.doesNotMatch(source, /Unlock My Plan/);
});

test('plan-preview preserves route flow', () => {
  assert.match(source, /router\.replace\('\/onboarding\/setup'\)/);
  assert.match(source, /router\.replace\('\/onboarding\/first-stack'\)/);
});
```

- [ ] **Step 2: Run the contract test and verify it fails on the old copy**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
node --test tests/onboarding/plan-preview.contract.test.ts
```

Expected: FAIL with missing matches for `We found your easiest first step` and `See my first step`.

- [ ] **Step 3: Update `plan-preview` copy and CTA to set up the scan-first page**

```tsx
<Text style={styles.eyebrow}>Your first path</Text>
<Text
  style={[
    styles.title,
    {
      fontSize: layoutTokens.summaryTitleSize,
      lineHeight: layoutTokens.summaryTitleLineHeight,
    },
  ]}
>
  We found your easiest first step
</Text>
<Text
  style={[
    styles.subtitle,
    {
      fontSize: layoutTokens.summarySubtitleSize,
      lineHeight: layoutTokens.summarySubtitleLineHeight,
    },
  ]}
>
  We used your goals, preferences, and routine to choose the easiest place to begin.
</Text>
```

```tsx
<QAContinueCTA title="See my first step" onPress={handleContinue} />
```

- [ ] **Step 4: Re-run the contract test and verify it passes**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
node --test tests/onboarding/plan-preview.contract.test.ts
```

Expected: PASS with `2 tests` and no failures.

- [ ] **Step 5: Commit the plan-preview handoff refresh**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
git add app/onboarding/plan-preview.tsx tests/onboarding/plan-preview.contract.test.ts
git commit -m "feat: strengthen plan preview handoff copy"
```

Expected: Git creates a commit containing only the preview page and its contract test.

### Task 3: Convert Standalone `first-stack` into a Scan-First Hero

**Files:**
- Modify: `app/onboarding/first-stack.tsx`
- Modify: `tests/onboarding/first-stack.analytics.test.ts`
- Create: `tests/onboarding/scan-first-handoff.contract.test.ts`
- Test: `tests/onboarding/first-stack.analytics.test.ts`
- Test: `tests/onboarding/scan-first-handoff.contract.test.ts`

- [ ] **Step 1: Add failing contracts for the scan-first hero structure**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app-scan-first-handoff/app/onboarding/first-stack.tsx',
  'utf8',
);

test('first-stack promotes scan as the only primary action', () => {
  assert.match(source, /continueLabel="Scan my first supplement"/);
  assert.match(source, /Search instead/);
  assert.match(source, /Do this later/);
  assert.doesNotMatch(source, /How do you want to start\?/);
  assert.doesNotMatch(source, /START_OPTIONS\.map/);
});

test('first-stack builds lightweight proof from onboarding inputs', () => {
  assert.match(source, /buildFirstStackProofItems/);
  assert.match(source, /draft\?\.preferredTypes/);
  assert.match(source, /draft\?\.adherenceBlocker/);
});
```

```ts
test('first stack analytics contract tracks scan-first selection and acceptance', () => {
  assert.match(source, /trackEvaluatedLoopExposure/);
  assert.match(source, /trackEvaluatedLoopClick/);
  assert.match(source, /trackEvaluatedLoopSave/);
  assert.match(source, /trackEvaluatedLoopConversion/);
  assert.match(source, /answer:\s*action/);
  assert.match(source, /actionKey:\s*action/);
  assert.match(source, /conversionType:\s*'first_stack_accepted'/);
});
```

- [ ] **Step 2: Run the first-stack tests and verify they fail**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
node --test tests/onboarding/first-stack.analytics.test.ts tests/onboarding/scan-first-handoff.contract.test.ts
```

Expected: FAIL because the page still renders `START_OPTIONS` and still asks `How do you want to start?`.

- [ ] **Step 3: Replace the equal-choice UI with a scan-first hero and proof model**

```tsx
const PRIMARY_FIRST_STACK_ACTION: FirstStackActionPreference = 'scan';

const buildFirstStackProofItems = ({
  displayGoal,
  preferredTypes,
  adherenceBlocker,
  supplementExperience,
}: {
  displayGoal: string;
  preferredTypes: string[];
  adherenceBlocker?: string;
  supplementExperience?: string;
}) => {
  const joinedTypes = preferredTypes.slice(0, 2).join(' / ');

  return [
    displayGoal ? `${displayGoal} is the first focus.` : null,
    joinedTypes ? `We will prioritize ${joinedTypes} options first.` : null,
    adherenceBlocker
      ? `We will keep the routine ${adherenceBlocker.toLowerCase()} from day one.`
      : supplementExperience
        ? `${supplementExperience} guidance keeps the first step approachable.`
        : 'We will keep the first step light so it is easy to follow through.',
  ].filter((item): item is string => Boolean(item));
};
```

```tsx
type FirstStackBodyContentProps = {
  heroSummary: string;
  proofItems: string[];
  routineStyleLabel: string;
  displayGoal: string;
  evaluatedItemCount: number;
  onSearchInstead: () => void;
  onDoLater: () => void;
};
```

```tsx
<Text allowFontScaling={false} style={styles.summaryEyebrow}>
  Your first step is ready
</Text>
<Text
  allowFontScaling={false}
  style={[
    styles.summaryTitle,
    {
      fontSize: layoutTokens.summaryCardTitleSize,
      lineHeight: layoutTokens.summaryCardTitleLineHeight,
    },
  ]}
>
  Scan your first supplement
</Text>
<Text
  allowFontScaling={false}
  style={[
    styles.summaryBody,
    {
      fontSize: summaryBodySize,
      lineHeight: summaryBodyLineHeight,
      maxWidth: compactSummary ? 292 : 306,
    },
  ]}
>
  {heroSummary}
</Text>
<View style={[styles.proofList, { marginTop: layoutTokens.summaryCardSectionGap }]}>
  {proofItems.map((item) => (
    <View key={item} style={styles.proofPill}>
      <Text allowFontScaling={false} style={styles.proofPillText}>
        {item}
      </Text>
    </View>
  ))}
</View>
```

```tsx
<View style={[styles.optionSection, { gap: optionSectionGap }]}>
  <Text allowFontScaling={false} style={styles.optionEyebrow}>
    Other ways to start
  </Text>
  <Pressable onPress={onSearchInstead} style={styles.secondaryAction}>
    <Text allowFontScaling={false} style={styles.secondaryActionTitle}>
      Search instead
    </Text>
    <Text allowFontScaling={false} style={styles.secondaryActionBody}>
      Use search if the bottle is not nearby right now.
    </Text>
  </Pressable>
  <Pressable onPress={onDoLater} style={styles.secondaryAction}>
    <Text allowFontScaling={false} style={styles.secondaryActionTitle}>
      Do this later
    </Text>
    <Text allowFontScaling={false} style={styles.secondaryActionBody}>
      Finish setup and start from Home when you are ready.
    </Text>
  </Pressable>
</View>
```

- [ ] **Step 4: Wire the standalone screen so the footer CTA is always scan and secondary exits still work**

```tsx
const trackFirstStackActionSelection = useCallback(
  (action: FirstStackActionPreference) => {
    const payload = buildFirstStackAnalyticsPayload({
      snapshotId: snapshot.snapshotId,
      rulesVersion: snapshot.rulesVersion,
      firstStackPlan,
      selectedAction: action,
    });

    trackOnboardingEvent('question_answered', {
      question: 'first_stack_action_preference',
      answer: action,
      source: 'first_stack',
      hasEvaluatedPlan: payload.hasEvaluatedPlan,
      evaluatedItemCount: payload.evaluatedItemCount,
    });

    trackEvaluatedLoopClick({
      ...payload,
      source: 'user',
      actionKey: action,
    });
  },
  [firstStackPlan, snapshot.rulesVersion, snapshot.snapshotId],
);
```

```tsx
const handlePrimaryScan = useCallback(async () => {
  trackFirstStackActionSelection(PRIMARY_FIRST_STACK_ACTION);
  await onContinueSelection(PRIMARY_FIRST_STACK_ACTION);
}, [onContinueSelection, trackFirstStackActionSelection]);

const handleAlternateAction = useCallback(
  async (action: Exclude<FirstStackActionPreference, 'scan'>) => {
    trackFirstStackActionSelection(action);
    await onContinueSelection(action);
  },
  [onContinueSelection, trackFirstStackActionSelection],
);
```

```tsx
<QAScreenShell
  screenKey="first-stack"
  qaStepIndex={7}
  transitionDirection={transitionDirection}
  disableStepSlide={disableStepSlide}
  enableHardwareBackHandling={enableHardwareBackHandling}
  eyebrow="Finish setup"
  title="Your first step is ready"
  subtitle="We matched your goals and routine to the easiest place to begin."
  onBack={handleBack}
  onContinue={handlePrimaryScan}
  continueLabel="Scan my first supplement"
  progressFillWidthOverride={108.641}
  listContentContainerStyle={[
    styles.listContent,
    { gap: layoutTokens.firstStackListGap, paddingBottom: layoutTokens.firstStackListGap - 8 },
  ]}
>
  <FirstStackBodyContent
    heroSummary={heroSummary}
    proofItems={proofItems}
    routineStyleLabel={routineStyleLabel}
    displayGoal={displayGoal}
    evaluatedItemCount={evaluatedItemCount}
    onSearchInstead={() => void handleAlternateAction('manual')}
    onDoLater={() => void handleAlternateAction('later')}
  />
</QAScreenShell>
```

- [ ] **Step 5: Re-run the standalone tests and verify they pass**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
node --test tests/onboarding/first-stack.analytics.test.ts tests/onboarding/scan-first-handoff.contract.test.ts
```

Expected: PASS with no missing matches and no failures.

- [ ] **Step 6: Commit the standalone scan-first hero refactor**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
git add app/onboarding/first-stack.tsx tests/onboarding/first-stack.analytics.test.ts tests/onboarding/scan-first-handoff.contract.test.ts
git commit -m "feat: convert first stack to scan-first hero"
```

Expected: Git creates a commit for the standalone hero page and its tests.

### Task 4: Keep Shared Flow and Standalone Handoff in Sync

**Files:**
- Modify: `components/onboarding/flow/SummaryFlowScenes.tsx`
- Modify: `app/onboarding/plan-preview.tsx`
- Modify: `app/onboarding/first-stack.tsx`
- Modify: `tests/onboarding/scan-first-handoff.contract.test.ts`
- Test: `tests/onboarding/scan-first-handoff.contract.test.ts`
- Test: `tests/onboarding/plan-preview.contract.test.ts`

- [ ] **Step 1: Extend the contract test so shared flow uses the same labels and action model**

```ts
const flowSource = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app-scan-first-handoff/components/onboarding/flow/SummaryFlowScenes.tsx',
  'utf8',
);

test('shared flow mirrors the scan-first handoff labels', () => {
  assert.match(flowSource, /continueLabel:\s*'See my first step'/);
  assert.match(flowSource, /continueLabel:\s*'Scan my first supplement'/);
  assert.match(flowSource, /handleAlternateAction\('manual'\)/);
  assert.match(flowSource, /handleAlternateAction\('later'\)/);
  assert.doesNotMatch(flowSource, /Pick how you want to start so we can guide your next action\./);
});
```

- [ ] **Step 2: Run the shared-flow contract tests and verify they fail before wiring changes**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
node --test tests/onboarding/plan-preview.contract.test.ts tests/onboarding/scan-first-handoff.contract.test.ts
```

Expected: FAIL because `SummaryFlowScenes.tsx` still uses `Unlock My Plan`, `Finish setup`, and the old first-stack subtitle.

- [ ] **Step 3: Update the shared flow scene labels and route handlers**

```tsx
const shellConfig = useMemo<OnboardingSharedShellConfig>(
  () => ({
    backgroundVariant: 'summary',
    progressFillWidth: getSharedShellProgressFillWidth('plan-preview'),
    onBack: () => goToStep('setup', 'back'),
    onContinue: () => {
      commitDraft(
        {
          smartFilterConfig: buildSmartFilterConfig({
            goals: draft?.goals ?? [],
            preferredTypes: draft?.preferredTypes ?? [],
          }),
        },
        11,
      );
      goToStep('first-stack', 'forward');
      void flushDraft();
    },
    continueLabel: 'See my first step',
    footerReserveHeight: ONBOARDING_SHARED_SHELL_SUMMARY_FOOTER_SPACE,
  }),
  [commitDraft, draft?.goals, draft?.preferredTypes, flushDraft, goToStep],
);
```

```tsx
const handleAlternateAction = useCallback(
  (action: Exclude<FirstStackActionPreference, 'scan'>) => {
    commitDraft({ firstActionPreference: action }, 11);
    trackFirstStackActionSelection(action);

    const completedPayload = buildFirstStackAnalyticsPayload({
      snapshotId: snapshot.snapshotId,
      rulesVersion: snapshot.rulesVersion,
      firstStackPlan,
      selectedAction: action,
    });

    trackEvaluatedLoopSave({
      ...completedPayload,
      source: 'user',
      actionKey: action,
    });
    trackEvaluatedLoopConversion({
      ...completedPayload,
      source: 'user',
      actionKey: action,
      conversionType: 'first_stack_accepted',
    });

    void flushDraft();
    void recordOverrideEvents([
      {
        id: `first_action_${Date.now()}`,
        userId: null,
        timestamp: new Date().toISOString(),
        source: 'user',
        surface: 'first_stack',
        action: 'set',
        field: 'firstActionPreference',
        value: action,
      },
    ]);

    exitTo('/onboarding/done', 'forward');
  },
  [
    commitDraft,
    exitTo,
    firstStackPlan,
    flushDraft,
    recordOverrideEvents,
    snapshot.rulesVersion,
    snapshot.snapshotId,
    trackFirstStackActionSelection,
  ],
);
```

```tsx
const shellConfig = useMemo<OnboardingSharedShellConfig>(
  () => ({
    backgroundVariant: 'qa',
    progressFillWidth: getSharedShellProgressFillWidth('first-stack'),
    onBack: () => goToStep('plan-preview', 'back'),
    onContinue: () => {
      commitDraft({ firstActionPreference: 'scan' }, 11);
      trackFirstStackActionSelection('scan');

      const completedPayload = buildFirstStackAnalyticsPayload({
        snapshotId: snapshot.snapshotId,
        rulesVersion: snapshot.rulesVersion,
        firstStackPlan,
        selectedAction: 'scan',
      });

      trackEvaluatedLoopSave({
        ...completedPayload,
        source: 'user',
        actionKey: 'scan',
      });
      trackEvaluatedLoopConversion({
        ...completedPayload,
        source: 'user',
        actionKey: 'scan',
        conversionType: 'first_stack_accepted',
      });

      void flushDraft();
      void recordOverrideEvents([
        {
          id: `first_action_${Date.now()}`,
          userId: null,
          timestamp: new Date().toISOString(),
          source: 'user',
          surface: 'first_stack',
          action: 'set',
          field: 'firstActionPreference',
          value: 'scan',
        },
      ]);

      exitTo('/onboarding/done', 'forward');
    },
    continueLabel: 'Scan my first supplement',
    footerReserveHeight: ONBOARDING_SHARED_SHELL_SUMMARY_FOOTER_SPACE,
  }),
  [
    commitDraft,
    exitTo,
    firstStackPlan,
    flushDraft,
    goToStep,
    recordOverrideEvents,
    snapshot.rulesVersion,
    snapshot.snapshotId,
    trackFirstStackActionSelection,
  ],
);
```

```tsx
<QAContentLayout
  showBackground={false}
  eyebrow="Finish setup"
  title="Your first step is ready"
  subtitle="We matched your goals and routine to the easiest place to begin."
  listContentContainerStyle={styles.listContent}
>
  <FirstStackBodyContent
    heroSummary={heroSummary}
    proofItems={proofItems}
    routineStyleLabel={routineStyleLabel}
    displayGoal={displayGoal}
    evaluatedItemCount={evaluatedItemCount}
    onSearchInstead={() => handleAlternateAction('manual')}
    onDoLater={() => handleAlternateAction('later')}
  />
</QAContentLayout>
```

- [ ] **Step 4: Re-run contracts and lint for the shared-flow paths**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
node --test tests/onboarding/plan-preview.contract.test.ts tests/onboarding/first-stack.analytics.test.ts tests/onboarding/scan-first-handoff.contract.test.ts
npx eslint app/onboarding/plan-preview.tsx app/onboarding/first-stack.tsx components/onboarding/flow/SummaryFlowScenes.tsx
```

Expected: all tests PASS and ESLint exits with code `0`.

- [ ] **Step 5: Commit the shared-flow sync**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
git add app/onboarding/plan-preview.tsx app/onboarding/first-stack.tsx components/onboarding/flow/SummaryFlowScenes.tsx tests/onboarding/plan-preview.contract.test.ts tests/onboarding/first-stack.analytics.test.ts tests/onboarding/scan-first-handoff.contract.test.ts
git commit -m "feat: align shared onboarding flow with scan-first handoff"
```

Expected: Git creates a commit that keeps shared flow and standalone onboarding in parity.

### Task 5: Verification Pass Across Motion, Layout, and Real Handoff

**Files:**
- Modify: none
- Test: `tests/onboarding/motion-contract.test.mjs`
- Test: `tests/onboarding/plan-preview.contract.test.ts`
- Test: `tests/onboarding/first-stack.analytics.test.ts`
- Test: `tests/onboarding/scan-first-handoff.contract.test.ts`

- [ ] **Step 1: Run the full onboarding contract suite**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
node --test tests/onboarding/plan-preview.contract.test.ts tests/onboarding/first-stack.analytics.test.ts tests/onboarding/scan-first-handoff.contract.test.ts
node tests/onboarding/motion-contract.test.mjs
```

Expected: all tests PASS with no failures.

- [ ] **Step 2: Start Expo and walk the funnel manually**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
EXPO_NO_TELEMETRY=1 npx expo start --go --localhost --port 8083
```

Expected: Expo serves successfully and prints a local URL for the app bundle.

Manual QA checklist:

```text
1. Open onboarding at setup.
2. Continue into plan-preview and confirm the CTA reads "See my first step".
3. Enter first-stack and confirm the footer CTA reads "Scan my first supplement".
4. Confirm the page shows concise proof items and weaker "Search instead" / "Do this later" exits.
5. Tap the primary CTA and verify the app enters the existing onboarding -> done -> scan path.
6. Tap each secondary action in a fresh run and verify manual/home fallback still routes correctly.
7. Confirm there is no double flash or broken footer transition during the page handoff.
```

- [ ] **Step 3: Stop Expo after QA**

```bash
# In the Expo terminal
Ctrl+C
```

Expected: Metro stops and the shell prompt returns.

- [ ] **Step 4: Commit the verified handoff update**

```bash
cd /Users/howard07/NuTriApp/nutri-app-scan-first-handoff
git status --short
git add app/onboarding/plan-preview.tsx app/onboarding/first-stack.tsx components/onboarding/flow/SummaryFlowScenes.tsx tests/onboarding/plan-preview.contract.test.ts tests/onboarding/first-stack.analytics.test.ts tests/onboarding/scan-first-handoff.contract.test.ts
git commit -m "feat: ship scan-first onboarding handoff"
```

Expected: `git status --short` shows only the intended files, and the commit succeeds.

## Self-Review

- Spec coverage: the plan covers the preview bridge, standalone hero page, shared-flow parity, analytics continuity, and manual conversion-path QA.
- Placeholder scan: no unresolved placeholder markers or shortcut phrases remain.
- Type consistency: `FirstStackActionPreference`, `trackFirstStackActionSelection`, `heroSummary`, and the CTA labels stay consistent across standalone and shared flow.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-16-onboarding-scan-first-handoff.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
