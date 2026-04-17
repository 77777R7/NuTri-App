import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { QAOptionRow } from '@/components/onboarding/qa/QAOptionRow';
import { QAScreenShell } from '@/components/onboarding/qa/QAScreenShell';
import {
  QA_FOREGROUND,
  QA_MUTED,
} from '@/components/onboarding/qa/qaTokens';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { usePersonalization } from '@/contexts/PersonalizationContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { useOnboardingLayoutTokens } from '@/hooks/useOnboardingLayoutTokens';
import {
  trackEvaluatedLoopClick,
  trackEvaluatedLoopConversion,
  trackEvaluatedLoopExposure,
  trackEvaluatedLoopSave,
} from '@/lib/analytics/evaluated-loop';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import {
  getScheduleTemplateDisplayLabel,
} from '@/lib/personalization/uiLabels';
import type { FirstStackPlan, FirstStackPlanItem, GoalKey } from '@/types/personalization';

const START_OPTIONS = [
  {
    value: 'scan',
    label: 'Scan first supplement',
    description: 'Fastest way to unlock personalized insights.',
  },
  {
    value: 'manual',
    label: 'Search database',
    description: 'Search by name to quickly find your supplement.',
  },
  {
    value: 'later',
    label: 'I will do this later',
    description: 'Finish setup first and start from Home.',
  },
] as const;

export type FirstStackActionPreference = (typeof START_OPTIONS)[number]['value'];

type FirstStackAnalyticsPayloadInput = {
  snapshotId: string;
  rulesVersion: string;
  firstStackPlan?: FirstStackPlan | null;
  selectedAction?: FirstStackActionPreference;
};

const buildFirstStackRoleCounts = (plan?: FirstStackPlan | null) =>
  (plan?.items ?? []).reduce(
    (counts, item) => {
      counts[item.role] += 1;
      return counts;
    },
    {
      foundation: 0,
      goal_support: 0,
      optional: 0,
    } satisfies Record<FirstStackPlanItem['role'], number>,
  );

export const buildFirstStackAnalyticsPayload = ({
  snapshotId,
  rulesVersion,
  firstStackPlan,
  selectedAction,
}: FirstStackAnalyticsPayloadInput) => {
  const roleCounts = buildFirstStackRoleCounts(firstStackPlan);

  return {
    surface: 'first_stack' as const,
    snapshotId,
    rulesVersion,
    hasEvaluatedPlan: Boolean(firstStackPlan?.items.length),
    evaluatedItemCount: firstStackPlan?.items.length ?? 0,
    foundationCount: roleCounts.foundation,
    goalSupportCount: roleCounts.goal_support,
    optionalCount: roleCounts.optional,
    ...(firstStackPlan?.scheduleTemplateKey
      ? { scheduleTemplateKey: firstStackPlan.scheduleTemplateKey }
      : {}),
    ...(selectedAction ? { selectedAction } : {}),
  };
};

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

const getRoutineStyleLabel = (templateKey?: string | null) => {
  if (!templateKey) return 'Guided simple plan';
  return getScheduleTemplateDisplayLabel(templateKey);
};

const getCurrentStackLabel = (itemCount: number) => {
  if (itemCount <= 0) return 'No supplements selected yet.';
  return `${itemCount} evaluated item${itemCount > 1 ? 's' : ''}.`;
};

const getDisplayGoal = (draftGoals?: string[]) => {
  if (!draftGoals?.length) return 'General Wellness';
  const firstGoal = draftGoals[0];
  return humanizeGoal(firstGoal as GoalKey);
};

const getDefaultSelection = (draftValue?: string) =>
  (draftValue as FirstStackActionPreference | undefined) ?? 'later';

function DetailRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={[styles.detailRow, muted && styles.detailRowMuted]}>
      <Text allowFontScaling={false} style={styles.detailEyebrow}>
        {label}
      </Text>
      <Text allowFontScaling={false} style={styles.detailValue}>
        {value}
      </Text>
    </View>
  );
}

export type FirstStackScreenContentProps = {
  onBack: () => void | Promise<void>;
  onContinueSelection: (selected: FirstStackActionPreference) => void | Promise<void>;
  transitionDirection?: 'forward' | 'back' | 'none';
  disableStepSlide?: boolean;
  enableHardwareBackHandling?: boolean;
};

type FirstStackBodyContentProps = {
  topSummary: string;
  routineStyleLabel: string;
  displayGoal: string;
  evaluatedItemCount: number;
  selected: FirstStackActionPreference;
  onSelectOption: (value: FirstStackActionPreference) => void;
};

export function FirstStackBodyContent({
  topSummary,
  routineStyleLabel,
  displayGoal,
  evaluatedItemCount,
  selected,
  onSelectOption,
}: FirstStackBodyContentProps) {
  const layoutTokens = useOnboardingLayoutTokens();
  const compactSummary = layoutTokens.density !== 'regular';
  const optionTitleSize = compactSummary
    ? Math.max(layoutTokens.summaryCardTitleSize - 1, 18)
    : layoutTokens.summaryCardTitleSize;
  const optionTitleLineHeight = compactSummary
    ? Math.max(layoutTokens.summaryCardTitleLineHeight - 2, optionTitleSize + 7)
    : layoutTokens.summaryCardTitleLineHeight;
  const summaryBodySize = compactSummary ? 14 : 14.5;
  const summaryBodyLineHeight = compactSummary ? 21.5 : 23.563;
  const optionSectionGap = layoutTokens.density === 'tight' ? 10 : compactSummary ? 12 : layoutTokens.summaryCardSectionGap - 4;
  const primaryCardShadowOpacity = layoutTokens.density === 'tight' ? 0.10 : compactSummary ? 0.085 : 0.04;
  const primaryCardShadowRadius = layoutTokens.density === 'tight' ? 22 : compactSummary ? 26 : 32;
  const detailCardMarginTop = Math.max(layoutTokens.summaryCardSectionGap - 2, 10);
  const optionListGap = Math.max(layoutTokens.qaListGap - 1, 8);
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
          Your first stack plan
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
          What NuTri would start with
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
          {topSummary}
        </Text>

        <View
          style={[
            styles.routineChip,
            { marginTop: layoutTokens.summaryCardSectionGap },
          ]}
        >
          <Text allowFontScaling={false} style={styles.routineChipText}>
            {routineStyleLabel}
          </Text>
        </View>

        <View style={[styles.detailCard, { marginTop: detailCardMarginTop }]}>
          <DetailRow label="Starting focus" value={`${displayGoal} first.`} />
          <DetailRow label="Routine style" value={routineStyleLabel} />
          <DetailRow
            label="Current stack"
            value={getCurrentStackLabel(evaluatedItemCount)}
            muted
          />
        </View>
      </View>

      <View style={[styles.optionSection, { gap: optionSectionGap }]}>
        <Text
          allowFontScaling={false}
          style={[styles.optionEyebrow, compactSummary ? { opacity: 0.72 } : null]}
        >
          Choose your next move
        </Text>
        <Text
          allowFontScaling={false}
          style={[
            styles.optionTitle,
            {
              fontSize: optionTitleSize,
              lineHeight: optionTitleLineHeight,
            },
          ]}
        >
          How do you want to start?
        </Text>

        <View style={[styles.optionList, { gap: optionListGap }]}>
          {START_OPTIONS.map((option) => (
            <QAOptionRow
              key={option.value}
              label={option.label}
              description={option.description}
              selected={selected === option.value}
              onPress={() => onSelectOption(option.value)}
              selectionMode="single"
            />
          ))}
        </View>
      </View>
    </>
  );
}

export function FirstStackScreenContent({
  onBack,
  onContinueSelection,
  transitionDirection,
  disableStepSlide = false,
  enableHardwareBackHandling = true,
}: FirstStackScreenContentProps) {
  const { draft } = useOnboarding();
  const { loading, snapshot, firstStackPlan } = usePersonalization();
  const layoutTokens = useOnboardingLayoutTokens();

  const [selected, setSelected] = useState<FirstStackActionPreference>(
    getDefaultSelection(draft?.firstActionPreference),
  );

  const evaluatedExposureTrackedRef = useRef(false);

  useEffect(() => {
    setSelected(getDefaultSelection(draft?.firstActionPreference));
  }, [draft?.firstActionPreference]);

  const selectedGoals = useMemo(() => draft?.goals ?? [], [draft?.goals]);
  const primaryGoal = useMemo(() => getPrimaryGoal(selectedGoals), [selectedGoals]);
  const displayGoal = useMemo(() => getDisplayGoal(selectedGoals), [selectedGoals]);
  const routineStyleLabel = useMemo(
    () => getRoutineStyleLabel(firstStackPlan?.scheduleTemplateKey),
    [firstStackPlan?.scheduleTemplateKey],
  );
  const evaluatedItemCount = useMemo(() => firstStackPlan?.items.length ?? 0, [firstStackPlan?.items.length]);

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
    if (loading || evaluatedExposureTrackedRef.current) return;
    if (!firstStackPlan?.items.length) return;
    evaluatedExposureTrackedRef.current = true;
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

  const handleNext = useCallback(async () => {
    await onContinueSelection(selected);
  }, [onContinueSelection, selected]);

  const handleBack = useCallback(async () => {
    await onBack();
  }, [onBack]);

  const topSummary = useMemo(
    () =>
      `We'll start with ${primaryGoal} using a ${routineStyleLabel.toLowerCase()} so your first routine stays manageable.`,
    [primaryGoal, routineStyleLabel],
  );

  return (
    <QAScreenShell
      screenKey="first-stack"
      qaStepIndex={7}
      transitionDirection={transitionDirection}
      disableStepSlide={disableStepSlide}
      enableHardwareBackHandling={enableHardwareBackHandling}
      eyebrow="Finish setup"
      title="Build your first stack"
      subtitle="Pick how you want to start so we can guide your next action."
      onBack={handleBack}
      onContinue={handleNext}
      continueLabel="Finish setup"
      progressFillWidthOverride={108.641}
      listContentContainerStyle={[
        styles.listContent,
        { gap: layoutTokens.firstStackListGap, paddingBottom: layoutTokens.firstStackListGap - 8 },
      ]}
    >
      <FirstStackBodyContent
        topSummary={topSummary}
        routineStyleLabel={routineStyleLabel}
        displayGoal={displayGoal}
        evaluatedItemCount={evaluatedItemCount}
        selected={selected}
        onSelectOption={handleSelectOption}
      />
    </QAScreenShell>
  );
}

export default function FirstStackScreen() {
  const router = useRouter();
  const { saveDraft } = useOnboarding();
  const { setDirection } = useTransitionDir();
  const { snapshot, firstStackPlan, recordOverrideEvents } = usePersonalization();

  const handleContinueSelection = useCallback(
    async (selected: FirstStackActionPreference) => {
      await saveDraft({ firstActionPreference: selected }, 11);
      await recordOverrideEvents([
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

      setDirection('forward');
      router.replace('/onboarding/done');
    },
    [
      firstStackPlan,
      recordOverrideEvents,
      router,
      saveDraft,
      setDirection,
      snapshot.rulesVersion,
      snapshot.snapshotId,
    ],
  );

  const handleBack = useCallback(async () => {
    setDirection('back');
    router.replace('/onboarding/plan-preview');
  }, [router, setDirection]);

  return (
    <FirstStackScreenContent
      onBack={handleBack}
      onContinueSelection={handleContinueSelection}
    />
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
  detailCard: {
    marginTop: 24,
    borderRadius: 22,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 0.678,
    borderColor: 'rgba(0,0,0,0.05)',
    backgroundColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  detailRow: {
    paddingHorizontal: 19.991,
    paddingTop: 15.997,
    paddingBottom: 15.997,
    borderBottomWidth: 0.678,
    borderBottomColor: 'rgba(0,0,0,0.04)',
    gap: 5.996,
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  detailRowMuted: {
    backgroundColor: 'rgba(248,250,252,0.8)',
    borderBottomWidth: 0,
  },
  detailEyebrow: {
    fontSize: 11.5,
    lineHeight: 17.25,
    fontWeight: '700',
    letterSpacing: 0.6087,
    textTransform: 'uppercase',
    color: '#90A1B9',
  },
  detailValue: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.3125,
    color: '#1D293D',
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
  optionTitle: {
    marginTop: -6,
    fontSize: 22,
    lineHeight: 33,
    fontWeight: '700',
    letterSpacing: -0.6978,
    color: QA_FOREGROUND,
  },
  optionList: {
    gap: 14,
  },
});
