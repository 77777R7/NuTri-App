import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet } from 'react-native';
import {
  cancelAnimation,
  Easing,
  useAnimatedScrollHandler,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  PlanPreviewBodyContent,
} from '@/app/onboarding/plan-preview';
import {
  buildFirstStackAnalyticsPayload,
  FirstStackBodyContent,
  type FirstStackActionPreference,
} from '@/app/onboarding/first-stack';
import { QAContentLayout } from '@/components/onboarding/qa/QAContentLayout';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { usePersonalization } from '@/contexts/PersonalizationContext';
import {
  trackEvaluatedLoopClick,
  trackEvaluatedLoopConversion,
  trackEvaluatedLoopExposure,
  trackEvaluatedLoopSave,
} from '@/lib/analytics/evaluated-loop';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import {
  buildAvoidItemsFromStructuredPreferences,
  buildSmartFilterConfig,
  GOAL_OPTIONS,
} from '@/lib/onboarding-v2';
import { getScheduleTemplateDisplayLabel } from '@/lib/personalization/uiLabels';
import type { GoalKey } from '@/types/personalization';

import type { OnboardingFlowDirection } from './OnboardingSceneViewport';
import {
  getSharedShellProgressFillWidth,
  ONBOARDING_SHARED_SHELL_SUMMARY_FOOTER_SPACE,
  type OnboardingSharedShellConfig,
} from './onboardingShell';
const SCROLLBAR_HIDE_DELAY_MS = 1200;
const SCROLLBAR_FADE_DURATION_MS = 720;

type SummaryFlowSceneProps = {
  sceneActive: boolean;
  direction: OnboardingFlowDirection;
  goToStep: (
    step: 'setup' | 'plan-preview' | 'first-stack',
    direction: OnboardingFlowDirection,
  ) => void;
  exitTo: (href: string, direction?: OnboardingFlowDirection) => void;
  setSharedShellConfig?: (config: OnboardingSharedShellConfig | null) => void;
};

const getDefaultFirstStackSelection = (draftValue?: string) =>
  (draftValue as FirstStackActionPreference | undefined) ?? 'later';

const humanizeGoal = (goalKey: GoalKey) =>
  goalKey
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const getPrimaryGoal = (goals?: string[]) => {
  if (!goals?.length) return 'General Wellness';
  if (goals.length === 1) return goals[0];
  return 'General Wellness';
};

const getDisplayGoal = (draftGoals?: string[]) => {
  if (!draftGoals?.length) return 'General Wellness';
  return humanizeGoal(draftGoals[0] as GoalKey);
};

const getRoutineStyleLabel = (templateKey?: string | null) => {
  if (!templateKey) return 'Guided simple plan';
  return getScheduleTemplateDisplayLabel(templateKey);
};

export function PlanPreviewFlowScene({
  sceneActive,
  goToStep,
  setSharedShellConfig,
}: SummaryFlowSceneProps) {
  const { draft, commitDraft, flushDraft } = useOnboarding();
  const scrollProgress = useSharedValue(0);
  const scrollbarOpacity = useSharedValue(1);

  const selectedGoals = useMemo(
    () => (draft?.goals?.length ? draft.goals : [...GOAL_OPTIONS.slice(0, 2)]),
    [draft?.goals],
  );
  const [expandedGoal, setExpandedGoal] = useState<string>(selectedGoals[0] ?? 'Energy');

  useEffect(() => {
    setExpandedGoal(selectedGoals[0] ?? 'Energy');
  }, [selectedGoals]);

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
      continueLabel: 'Unlock My Plan',
      footerReserveHeight: ONBOARDING_SHARED_SHELL_SUMMARY_FOOTER_SPACE,
    }),
    [commitDraft, draft?.goals, draft?.preferredTypes, flushDraft, goToStep],
  );

  useLayoutEffect(() => {
    if (!sceneActive || !setSharedShellConfig) return;
    setSharedShellConfig(shellConfig);
  }, [sceneActive, setSharedShellConfig, shellConfig]);

  const showScrollbar = useCallback(() => {
    'worklet';
    cancelAnimation(scrollbarOpacity);
    scrollbarOpacity.value = withTiming(1, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
  }, [scrollbarOpacity]);

  const fadeOutScrollbar = useCallback(() => {
    'worklet';
    cancelAnimation(scrollbarOpacity);
    scrollbarOpacity.value = withTiming(0, {
      duration: SCROLLBAR_FADE_DURATION_MS,
      delay: SCROLLBAR_HIDE_DELAY_MS,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    });
  }, [scrollbarOpacity]);

  const handleScroll = useAnimatedScrollHandler({
    onBeginDrag: () => {
      showScrollbar();
    },
    onScroll: (event) => {
      const range = Math.max(
        event.contentSize.height - event.layoutMeasurement.height,
        1,
      );
      scrollProgress.value = event.contentOffset.y / range;
    },
    onEndDrag: (event) => {
      const velocityY = Math.abs(event.velocity?.y ?? 0);
      if (velocityY < 0.05) {
        fadeOutScrollbar();
      }
    },
    onMomentumBegin: () => {
      showScrollbar();
    },
    onMomentumEnd: () => {
      fadeOutScrollbar();
    },
  });

  useEffect(() => {
    cancelAnimation(scrollbarOpacity);
    scrollbarOpacity.value = withTiming(0, {
      duration: SCROLLBAR_FADE_DURATION_MS,
      delay: 1800,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    });
  }, [scrollbarOpacity]);

  const selectedAvoid = useMemo(
    () =>
      buildAvoidItemsFromStructuredPreferences({
        avoidItems: draft?.avoidItems,
        allergyFlags: draft?.allergyFlags,
        ingredientRestrictions: draft?.ingredientRestrictions,
        noKnownAllergies: draft?.noKnownAllergies,
      }),
    [draft?.allergyFlags, draft?.avoidItems, draft?.ingredientRestrictions, draft?.noKnownAllergies],
  );
  const selectedTypes = draft?.preferredTypes ?? [];
  const visibleSafeguard = useMemo(() => {
    if (!selectedAvoid.length || selectedAvoid.includes('No known allergies')) return null;
    return `${selectedAvoid[0]} Free`;
  }, [selectedAvoid]);

  const guideGoals = useMemo(
    () => (selectedGoals.length > 0 ? selectedGoals : ['Energy', 'Sleep']),
    [selectedGoals],
  );

  return (
    <PlanPreviewBodyContent
      selectedAge={draft?.ageRange ?? ''}
      selectedSex={draft?.sex ?? draft?.gender ?? ''}
      selectedExperience={draft?.supplementExperience ?? ''}
      selectedGoals={selectedGoals}
      selectedTypes={selectedTypes}
      adherenceBlocker={draft?.adherenceBlocker}
      visibleSafeguard={visibleSafeguard}
      guideGoals={guideGoals}
      expandedGoal={expandedGoal}
      onSelectGoal={setExpandedGoal}
      onListScroll={handleScroll}
      scrollProgress={scrollProgress}
      scrollbarOpacity={scrollbarOpacity}
      scrollbarBottomInset={12}
    />
  );
}

export function FirstStackFlowScene({
  sceneActive,
  goToStep,
  exitTo,
  setSharedShellConfig,
}: SummaryFlowSceneProps) {
  const { draft, commitDraft, flushDraft } = useOnboarding();
  const { loading, snapshot, firstStackPlan, recordOverrideEvents } = usePersonalization();
  const [selected, setSelected] = useState<FirstStackActionPreference>(
    getDefaultFirstStackSelection(draft?.firstActionPreference),
  );
  const exposureTrackedRef = useRef(false);

  useEffect(() => {
    setSelected(getDefaultFirstStackSelection(draft?.firstActionPreference));
  }, [draft?.firstActionPreference]);

  const shellConfig = useMemo<OnboardingSharedShellConfig>(
    () => ({
      backgroundVariant: 'qa',
      progressFillWidth: getSharedShellProgressFillWidth('first-stack'),
      onBack: () => goToStep('plan-preview', 'back'),
      onContinue: () => {
        commitDraft({ firstActionPreference: selected }, 11);

        const completedPayload = buildFirstStackAnalyticsPayload({
          snapshotId: snapshot.snapshotId,
          rulesVersion: snapshot.rulesVersion,
          firstStackPlan,
          selectedAction: selected,
        });

        trackEvaluatedLoopSave({
          ...completedPayload,
          source: 'user',
          actionKey: selected,
        });
        trackEvaluatedLoopConversion({
          ...completedPayload,
          source: 'user',
          actionKey: selected,
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
            value: selected,
          },
        ]);

        exitTo('/onboarding/done', 'forward');
      },
      continueLabel: 'Finish setup',
      footerReserveHeight: ONBOARDING_SHARED_SHELL_SUMMARY_FOOTER_SPACE,
    }),
    [
      commitDraft,
      exitTo,
      firstStackPlan,
      flushDraft,
      goToStep,
      recordOverrideEvents,
      selected,
      snapshot.rulesVersion,
      snapshot.snapshotId,
    ],
  );

  useLayoutEffect(() => {
    if (!sceneActive || !setSharedShellConfig) return;
    setSharedShellConfig(shellConfig);
  }, [sceneActive, setSharedShellConfig, shellConfig]);

  const selectedGoals = useMemo(() => draft?.goals ?? [], [draft?.goals]);
  const primaryGoal = useMemo(() => getPrimaryGoal(selectedGoals), [selectedGoals]);
  const displayGoal = useMemo(() => getDisplayGoal(selectedGoals), [selectedGoals]);
  const routineStyleLabel = useMemo(
    () => getRoutineStyleLabel(firstStackPlan?.scheduleTemplateKey),
    [firstStackPlan?.scheduleTemplateKey],
  );
  const evaluatedItemCount = useMemo(
    () => firstStackPlan?.items.length ?? 0,
    [firstStackPlan?.items.length],
  );

  const analyticsPayload = useMemo(
    () =>
      buildFirstStackAnalyticsPayload({
        snapshotId: snapshot.snapshotId,
        rulesVersion: snapshot.rulesVersion,
        firstStackPlan,
      }),
    [firstStackPlan, snapshot.rulesVersion, snapshot.snapshotId],
  );

  useEffect(() => {
    if (loading || exposureTrackedRef.current) return;
    if (!firstStackPlan?.items.length) return;
    exposureTrackedRef.current = true;
    trackEvaluatedLoopExposure(analyticsPayload);
  }, [analyticsPayload, firstStackPlan?.items.length, loading]);

  const handleSelectOption = useCallback(
    (value: FirstStackActionPreference) => {
      setSelected(value);

      if (selected === value) return;

      const payload = buildFirstStackAnalyticsPayload({
        snapshotId: snapshot.snapshotId,
        rulesVersion: snapshot.rulesVersion,
        firstStackPlan,
        selectedAction: value,
      });

      trackOnboardingEvent('question_answered', {
        question: 'first_stack_action_preference',
        answer: value,
        source: 'first_stack',
        hasEvaluatedPlan: payload.hasEvaluatedPlan,
        evaluatedItemCount: payload.evaluatedItemCount,
      });
      trackEvaluatedLoopClick({
        ...payload,
        source: 'user',
        actionKey: value,
      });
    },
    [firstStackPlan, selected, snapshot.rulesVersion, snapshot.snapshotId],
  );

  const topSummary = useMemo(
    () =>
      `We'll start with ${primaryGoal} using a ${routineStyleLabel.toLowerCase()} so your first routine stays manageable.`,
    [primaryGoal, routineStyleLabel],
  );

  return (
    <QAContentLayout
      showBackground={false}
      eyebrow="Finish setup"
      title="Build your first stack"
      subtitle="Pick how you want to start so we can guide your next action."
      listContentContainerStyle={styles.listContent}
    >
      <FirstStackBodyContent
        topSummary={topSummary}
        routineStyleLabel={routineStyleLabel}
        displayGoal={displayGoal}
        evaluatedItemCount={evaluatedItemCount}
        selected={selected}
        onSelectOption={handleSelectOption}
      />
    </QAContentLayout>
  );
}

const styles = StyleSheet.create({
  listContent: {
    gap: 32,
    paddingBottom: 24,
  },
});
