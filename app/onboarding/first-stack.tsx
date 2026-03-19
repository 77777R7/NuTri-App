import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import {
  trackEvaluatedLoopClick,
  trackEvaluatedLoopConversion,
  trackEvaluatedLoopExposure,
  trackEvaluatedLoopSave,
} from '@/lib/analytics/evaluated-loop';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { usePersonalization } from '@/contexts/PersonalizationContext';
import { useSavedSupplements } from '@/contexts/SavedSupplementsContext';
import {
  getFirstStackRoleLabel,
  getScheduleTemplateDisplayLabel,
} from '@/lib/personalization/uiLabels';
import type { FirstStackPlan, FirstStackPlanItem, GoalKey } from '@/types/personalization';
import { ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding-v2';
import { colors } from '@/lib/theme';

const START_OPTIONS = [
  { value: 'scan', label: 'Scan first supplement', description: 'Fastest way to unlock personalized insights.' },
  { value: 'manual', label: 'Add manually', description: 'Upload or enter details without a live scan.' },
  { value: 'later', label: 'I will do this later', description: 'Finish setup first and start from Home.' },
] as const;

const titleCase = (value: string) =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const looksOpaqueProductId = (value: string) =>
  /^[0-9a-f]{8,}$/i.test(value.replace(/-/g, '')) || /^prod[_-]/i.test(value) || /^sku[_-]/i.test(value);

const humanizeProductId = (productId: string) => {
  const trimmed = productId.trim();
  if (!trimmed || looksOpaqueProductId(trimmed)) {
    return 'Recommended product';
  }

  return titleCase(
    trimmed
      .replace(/^foundation[_-]/i, '')
      .replace(/^goal[_-]support[_-]/i, '')
      .replace(/^optional[_-]/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  );
};

const humanizeGoal = (goalKey: GoalKey) =>
  goalKey
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const extractSupportedGoals = (item: FirstStackPlanItem): string[] => {
  const rawValue = item.reasons.find((reason) => typeof reason.params?.supportedGoals === 'string')?.params?.supportedGoals;
  if (typeof rawValue !== 'string' || !rawValue.trim()) return [];

  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => humanizeGoal(value as GoalKey));
};

const buildItemSupportCopy = (item: FirstStackPlanItem) => {
  const supportedGoals = extractSupportedGoals(item);
  if (supportedGoals.length > 0) {
    return `Supports ${supportedGoals.join(' + ')}.`;
  }

  if (item.role === 'foundation') {
    return 'Keeps your first routine grounded in the essentials.';
  }

  if (item.role === 'goal_support') {
    return 'Adds targeted support for the goals you picked.';
  }

  return 'Held back as an optional add-on so your first plan stays manageable.';
};

type FirstStackActionPreference = (typeof START_OPTIONS)[number]['value'];

type FirstStackAnalyticsPayloadInput = {
  snapshotId: string;
  rulesVersion: string;
  firstStackPlan?: FirstStackPlan | null;
  hasExplanation: boolean;
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

const buildFirstStackAnalyticsPayload = ({
  snapshotId,
  rulesVersion,
  firstStackPlan,
  hasExplanation,
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
    hasExplanation,
    ...(selectedAction ? { selectedAction } : {}),
  };
};

export default function FirstStackScreen() {
  const router = useRouter();
  const { draft, saveDraft } = useOnboarding();
  const { savedSupplements } = useSavedSupplements();
  const { loading, snapshot, firstStackPlan, explainSurface, recordOverrideEvents } = usePersonalization();
  const [selected, setSelected] = useState<'scan' | 'manual' | 'later'>(draft?.firstActionPreference ?? 'scan');
  const [explanation, setExplanation] = useState<{ summary: string; bullets: string[] } | null>(null);
  const stackItems = useMemo(() => firstStackPlan?.items ?? [], [firstStackPlan]);
  const evaluatedExposureTrackedRef = React.useRef(false);
  const savedSupplementById = useMemo(
    () => new Map(savedSupplements.map((item) => [item.id, item] as const)),
    [savedSupplements],
  );
  const scheduleTemplateLabel = useMemo(
    () => (firstStackPlan ? getScheduleTemplateDisplayLabel(firstStackPlan.scheduleTemplateKey) : null),
    [firstStackPlan],
  );
  const stackCards = useMemo(
    () =>
      stackItems.map((item) => {
        const savedItem = savedSupplementById.get(item.productId);
        const title =
          item.display?.title?.trim() ||
          savedItem?.productName?.trim() ||
          humanizeProductId(item.productId);
        const brandName = item.display?.brandName?.trim() || savedItem?.brandName?.trim() || null;
        const dosageText = item.display?.dosageText?.trim() || savedItem?.dosageText?.trim() || null;

        return {
          item,
          title,
          meta: [brandName, dosageText].filter(Boolean).join(' · '),
          supportCopy: buildItemSupportCopy(item),
        };
      }),
    [savedSupplementById, stackItems],
  );

  useEffect(() => {
    setSelected((draft?.firstActionPreference as 'scan' | 'manual' | 'later' | undefined) ?? 'scan');
  }, [draft?.firstActionPreference]);

  useEffect(() => {
    let active = true;
    if (loading) return () => undefined;
    void explainSurface('first_stack')
      .then((result) => {
        if (!active) return;
        setExplanation({ summary: result.summary, bullets: result.bullets });
      })
      .catch((error) => {
        console.warn('[first-stack] explanation failed', error);
      });
    return () => {
      active = false;
    };
  }, [explainSurface, loading]);

  const analyticsPayload = useMemo(
    () =>
      buildFirstStackAnalyticsPayload({
        snapshotId: snapshot.snapshotId,
        rulesVersion: snapshot.rulesVersion,
        firstStackPlan,
        hasExplanation: Boolean(explanation),
      }),
    [explanation, firstStackPlan, snapshot.rulesVersion, snapshot.snapshotId],
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
        hasExplanation: Boolean(explanation),
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
    [explanation, firstStackPlan, selected, snapshot.rulesVersion, snapshot.snapshotId],
  );

  const handleNext = useCallback(async () => {
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
      hasExplanation: Boolean(explanation),
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
    router.replace('/onboarding/done');
  }, [explanation, firstStackPlan, recordOverrideEvents, router, saveDraft, selected, snapshot.rulesVersion, snapshot.snapshotId]);

  return (
    <OnboardingContainer
      step={11}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      title="Build your first stack"
      subtitle="Pick how you want to start so we can guide your next action."
      fallbackHref="/onboarding/plan-preview"
      scrollable
      onNext={handleNext}
      nextLabel="Finish setup"
    >
      <View style={styles.content}>
        {explanation ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Your first stack plan</Text>
            <Text style={styles.summaryBody}>{explanation.summary}</Text>
            {scheduleTemplateLabel ? (
              <Text style={styles.summaryTemplate}>Schedule template: {scheduleTemplateLabel}</Text>
            ) : null}
            {explanation.bullets.map((bullet) => (
              <Text key={bullet} style={styles.summaryBullet}>
                • {bullet}
              </Text>
            ))}
            {stackCards.length > 0 ? (
              <View style={styles.stackSection}>
                <Text style={styles.stackSectionTitle}>What we would start with</Text>
                <View style={styles.stackList}>
                  {stackCards.map(({ item, title, meta, supportCopy }, index) => (
                    <View key={`${item.productId}-${item.role}`} style={styles.stackItemCard}>
                      <View style={styles.stackItemHeader}>
                        <Text style={styles.stackItemIndex}>{index + 1}</Text>
                        <View style={styles.stackItemHeaderCopy}>
                          <Text style={styles.stackItemTitle}>{title}</Text>
                          <Text style={styles.stackItemRole}>{getFirstStackRoleLabel(item.role)}</Text>
                        </View>
                      </View>
                      {meta ? <Text style={styles.stackItemMeta}>{meta}</Text> : null}
                      <Text style={styles.stackItemSupport}>{supportCopy}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <Text style={styles.summaryMuted}>
                We will keep this simple until you add or scan the first supplement we can score.
              </Text>
            )}
          </View>
        ) : null}
        <Text style={styles.why}>Why we ask: choosing your first move helps us reduce setup friction.</Text>
        <View style={styles.list}>
          {START_OPTIONS.map((option) => (
            <OnboardingCard
              key={option.value}
              label={option.label}
              description={option.description}
              selected={selected === option.value}
              onPress={() => handleSelectOption(option.value)}
              accessibilityLabel={`${option.label}${selected === option.value ? ' selected' : ''}`}
            />
          ))}
        </View>
      </View>
    </OnboardingContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: 14,
  },
  why: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
  },
  list: {
    gap: 12,
  },
  summaryCard: {
    gap: 8,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  summaryBody: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
  },
  summaryBullet: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
  },
  summaryTemplate: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.text,
  },
  summaryMuted: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
  },
  stackList: {
    gap: 10,
    paddingTop: 4,
  },
  stackSection: {
    gap: 10,
    paddingTop: 4,
  },
  stackSectionTitle: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.text,
  },
  stackItemCard: {
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  stackItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stackItemIndex: {
    width: 22,
    height: 22,
    borderRadius: 999,
    overflow: 'hidden',
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 13,
    lineHeight: 22,
    fontWeight: '700',
    color: '#1D4ED8',
    backgroundColor: '#DBEAFE',
  },
  stackItemHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  stackItemTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.text,
  },
  stackItemRole: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  stackItemMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  stackItemSupport: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
});

export const firstStackScreenInternals = {
  buildFirstStackAnalyticsPayload,
  buildFirstStackRoleCounts,
};
