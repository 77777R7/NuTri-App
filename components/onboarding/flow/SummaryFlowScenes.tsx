import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  type FirstStackActionPreference,
} from '@/app/onboarding/first-stack';
import { QAContentLayout } from '@/components/onboarding/qa/QAContentLayout';
import {
  QA_FOREGROUND,
  QA_MUTED,
} from '@/components/onboarding/qa/qaTokens';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { usePersonalization } from '@/contexts/PersonalizationContext';
import { useOnboardingLayoutTokens } from '@/hooks/useOnboardingLayoutTokens';
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
const PRIMARY_FIRST_STACK_ACTION: FirstStackActionPreference = 'scan';

type SummaryFlowSceneProps = {
  sceneActive: boolean;
  direction: OnboardingFlowDirection;
  goToStep: (
    step: 'allergy' | 'plan-preview' | 'first-stack',
    direction: OnboardingFlowDirection,
  ) => void;
  exitTo: (href: string, direction?: OnboardingFlowDirection) => void;
  setSharedShellConfig?: (config: OnboardingSharedShellConfig | null) => void;
};

const humanizeGoal = (goalKey: GoalKey) =>
  goalKey
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const getDisplayGoal = (draftGoals?: string[]) => {
  if (!draftGoals?.length) return 'General Wellness';
  return humanizeGoal(draftGoals[0] as GoalKey);
};

const getRoutineStyleLabel = (templateKey?: string | null) => {
  if (!templateKey) return 'Guided simple plan';
  return getScheduleTemplateDisplayLabel(templateKey);
};

const getCurrentStackLabel = (itemCount: number) => {
  if (itemCount <= 0) return 'No supplements selected yet.';
  return `${itemCount} evaluated item${itemCount > 1 ? 's' : ''}.`;
};

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

const buildFirstStackHeroSummary = ({
  displayGoal,
  routineStyleLabel,
}: {
  displayGoal: string;
  routineStyleLabel: string;
}) =>
  `Scan one supplement and we will anchor ${displayGoal.toLowerCase()} support to a ${routineStyleLabel.toLowerCase()} routine you can actually start today.`;

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
      onBack: () => goToStep('allergy', 'back'),
      onContinue: () => {
        commitDraft(
          {
            smartFilterConfig: buildSmartFilterConfig({
              goals: draft?.goals ?? [],
              preferredTypes: draft?.preferredTypes ?? [],
            }),
          },
          5,
        );
        goToStep('first-stack', 'forward');
        void flushDraft();
      },
      continueLabel: 'See my first step',
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

type SharedFirstStackHeroBodyContentProps = {
  heroSummary: string;
  proofItems: string[];
  routineStyleLabel: string;
  displayGoal: string;
  evaluatedItemCount: number;
  onSearchInstead: () => void;
  onDoLater: () => void;
};

function SharedFirstStackHeroBodyContent({
  heroSummary,
  proofItems,
  routineStyleLabel,
  displayGoal,
  evaluatedItemCount,
  onSearchInstead,
  onDoLater,
}: SharedFirstStackHeroBodyContentProps) {
  const layoutTokens = useOnboardingLayoutTokens();
  const compactSummary = layoutTokens.density !== 'regular';
  const summaryBodySize = compactSummary ? 14 : 14.5;
  const summaryBodyLineHeight = compactSummary ? 21.5 : 23.563;
  const optionSectionGap =
    layoutTokens.density === 'tight'
      ? 10
      : compactSummary
        ? 12
        : layoutTokens.summaryCardSectionGap - 4;
  const primaryCardShadowOpacity =
    layoutTokens.density === 'tight' ? 0.10 : compactSummary ? 0.085 : 0.04;
  const primaryCardShadowRadius =
    layoutTokens.density === 'tight' ? 22 : compactSummary ? 26 : 32;

  return (
    <>
      <View
        style={[
          styles.summaryCard,
          {
            minHeight: 0,
            paddingHorizontal: layoutTokens.summaryCardPadding,
            paddingTop: layoutTokens.summaryCardPadding,
            paddingBottom: layoutTokens.summaryCardPadding,
            shadowOpacity: primaryCardShadowOpacity,
            shadowRadius: primaryCardShadowRadius,
          },
        ]}
      >
        <View style={styles.summaryCardFill} pointerEvents="none" />
        <View style={styles.summaryInset} pointerEvents="none" />

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
        <View style={[styles.routineChip, { marginTop: layoutTokens.summaryCardSectionGap }]}>
          <Text allowFontScaling={false} style={styles.routineChipText}>
            {routineStyleLabel}
          </Text>
        </View>
        <Text allowFontScaling={false} style={styles.supportingMeta}>
          {displayGoal} first. {getCurrentStackLabel(evaluatedItemCount)}
        </Text>
      </View>

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
    </>
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
  const exposureTrackedRef = useRef(false);

  const handleContinueSelection = useCallback(
    async (action: FirstStackActionPreference) => {
      const completedPayload = buildFirstStackAnalyticsPayload({
        snapshotId: snapshot.snapshotId,
        rulesVersion: snapshot.rulesVersion,
        firstStackPlan,
        selectedAction: action,
      });

      trackOnboardingEvent('question_answered', {
        question: 'first_stack_action_preference',
        answer: action,
        source: 'first_stack',
        hasEvaluatedPlan: completedPayload.hasEvaluatedPlan,
        evaluatedItemCount: completedPayload.evaluatedItemCount,
      });
      trackEvaluatedLoopClick({
        ...completedPayload,
        source: 'user',
        actionKey: action,
      });

      commitDraft({ firstActionPreference: action }, 5);
      await flushDraft();
      await recordOverrideEvents([
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
    ],
  );

  const shellConfig = useMemo<OnboardingSharedShellConfig>(
    () => ({
      backgroundVariant: 'qa',
      progressFillWidth: getSharedShellProgressFillWidth('first-stack'),
      onBack: () => goToStep('plan-preview', 'back'),
      onContinue: () => handleContinueSelection(PRIMARY_FIRST_STACK_ACTION),
      continueLabel: 'Scan my first supplement',
      footerReserveHeight: ONBOARDING_SHARED_SHELL_SUMMARY_FOOTER_SPACE,
    }),
    [
      goToStep,
      handleContinueSelection,
    ],
  );

  useLayoutEffect(() => {
    if (!sceneActive || !setSharedShellConfig) return;
    setSharedShellConfig(shellConfig);
  }, [sceneActive, setSharedShellConfig, shellConfig]);

  const selectedGoals = useMemo(() => draft?.goals ?? [], [draft?.goals]);
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
  const heroSummary = useMemo(
    () => buildFirstStackHeroSummary({ displayGoal, routineStyleLabel }),
    [displayGoal, routineStyleLabel],
  );
  const proofItems = useMemo(
    () =>
      buildFirstStackProofItems({
        displayGoal,
        preferredTypes: draft?.preferredTypes ?? [],
        adherenceBlocker: draft?.adherenceBlocker,
        supplementExperience: draft?.supplementExperience,
      }),
    [
      displayGoal,
      draft?.adherenceBlocker,
      draft?.preferredTypes,
      draft?.supplementExperience,
    ],
  );

  return (
    <QAContentLayout
      showBackground={false}
      eyebrow="Finish setup"
      title="Your first step is ready"
      subtitle="We matched your goals and routine to the easiest place to begin."
      listContentContainerStyle={styles.listContent}
    >
      <SharedFirstStackHeroBodyContent
        heroSummary={heroSummary}
        proofItems={proofItems}
        routineStyleLabel={routineStyleLabel}
        displayGoal={displayGoal}
        evaluatedItemCount={evaluatedItemCount}
        onSearchInstead={() => void handleContinueSelection('manual')}
        onDoLater={() => void handleContinueSelection('later')}
      />
    </QAContentLayout>
  );
}

const styles = StyleSheet.create({
  listContent: {
    gap: 32,
    paddingBottom: 24,
  },
  summaryCard: {
    borderRadius: 32,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 0.678,
    borderColor: 'rgba(255,255,255,0.8)',
    backgroundColor: 'rgba(255,255,255,0.5)',
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
  },
  summaryCardFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  summaryInset: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 32,
    borderCurve: 'continuous',
    shadowColor: '#FFFFFF',
    shadowOpacity: 1,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 1 },
  },
  summaryEyebrow: {
    fontSize: 11,
    lineHeight: 16.5,
    fontWeight: '700',
    letterSpacing: 1.1645,
    textTransform: 'uppercase',
    color: QA_MUTED,
  },
  summaryTitle: {
    marginTop: 16,
    fontWeight: '700',
    letterSpacing: -0.6978,
    color: QA_FOREGROUND,
  },
  summaryBody: {
    marginTop: 16,
    maxWidth: 306,
    fontSize: 14.5,
    lineHeight: 23.563,
    fontWeight: '400',
    letterSpacing: -0.1912,
    color: QA_MUTED,
  },
  routineChip: {
    marginTop: 24,
    alignSelf: 'flex-start',
    minHeight: 33.593,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 0.678,
    borderColor: 'rgba(255,255,255,0.8)',
    backgroundColor: 'rgba(220,232,255,0.6)',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.03,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  routineChipText: {
    fontSize: 13.5,
    lineHeight: 20.25,
    fontWeight: '600',
    letterSpacing: -0.1121,
    color: '#3B6AF7',
  },
  proofList: {
    gap: 10,
  },
  proofPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(59,106,247,0.12)',
    backgroundColor: 'rgba(255,255,255,0.78)',
  },
  proofPillText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    letterSpacing: -0.12,
    color: '#314158',
  },
  supportingMeta: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    letterSpacing: -0.08,
    color: '#52627A',
  },
  optionSection: {
    gap: 20,
  },
  optionEyebrow: {
    fontSize: 11,
    lineHeight: 16.5,
    fontWeight: '700',
    letterSpacing: 1.1645,
    textTransform: 'uppercase',
    color: QA_MUTED,
  },
  secondaryAction: {
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(29,41,61,0.08)',
    backgroundColor: 'rgba(255,255,255,0.82)',
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 6,
  },
  secondaryActionTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.2,
    color: QA_FOREGROUND,
  },
  secondaryActionBody: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: -0.08,
    color: QA_MUTED,
  },
});
