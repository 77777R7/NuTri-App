import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { usePersonalization } from '@/contexts/PersonalizationContext';
import type { ExplanationResult } from '@/types/personalization';
import {
  buildBlockerStrategySummary,
  buildPlanPreviewSummary,
  getDietLaneDisplayLabel,
  getGoalDisplayLabel,
  getSupplementTypeDisplayLabel,
  getTimingAnchorDisplayLabel,
} from '@/lib/personalization/uiLabels';
import { ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding-v2';
import { colors } from '@/lib/theme';

const Pill = ({ label }: { label: string }) => (
  <View style={styles.pill}>
    <Text style={styles.pillText}>{label}</Text>
  </View>
);

export default function PlanPreviewScreen() {
  const router = useRouter();
  const { draft, saveDraft } = useOnboarding();
  const { loading, planPreview, smartFilter, explainSurface } = usePersonalization();
  const [explanation, setExplanation] = useState<ExplanationResult | null>(null);
  const [explanationState, setExplanationState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    let active = true;
    if (loading) return () => undefined;
    setExplanationState('loading');
    void explainSurface('plan_preview')
      .then((result) => {
        if (!active) return;
        setExplanation(result);
        setExplanationState('ready');
      })
      .catch((error) => {
        if (!active) return;
        console.warn('[plan-preview] explanation failed', error);
        setExplanation(null);
        setExplanationState('error');
      });
    return () => {
      active = false;
    };
  }, [explainSurface, loading]);

  const visibleGoals = useMemo(
    () => planPreview.goals.map((goal) => getGoalDisplayLabel(goal)),
    [planPreview.goals],
  );
  const preferredTypes = useMemo(
    () => planPreview.types.map((type) => getSupplementTypeDisplayLabel(type)),
    [planPreview.types],
  );
  const dietLaneLabels = useMemo(
    () => planPreview.dietLanes.map((lane) => getDietLaneDisplayLabel(lane)),
    [planPreview.dietLanes],
  );
  const activityAnchorLabels = useMemo(
    () => planPreview.activityAnchors.map((anchor) => getTimingAnchorDisplayLabel(anchor)),
    [planPreview.activityAnchors],
  );
  const explanationLabel = useMemo(() => {
    if (!explanation) return null;
    return explanation.source === 'deepseek' && !explanation.fallback ? 'AI summary' : 'Personalized summary';
  }, [explanation]);
  const explanationMeta = useMemo(() => {
    if (!explanation) return null;
    if (explanation.source === 'deepseek' && !explanation.fallback) {
      return explanation.model ? `Powered by ${explanation.model}` : 'Powered by AI';
    }
    return 'Rule-based fallback using the same personalization facts';
  }, [explanation]);

  const handleNext = useCallback(async () => {
    await saveDraft({
      smartFilterConfig: {
        visibleGoals: smartFilter.visibleGoals,
        preselectedTypes: smartFilter.preselectedTypes,
        preselectedTiming: [],
      },
    }, 10);

    router.replace('/onboarding/first-stack');
  }, [router, saveDraft, smartFilter.preselectedTypes, smartFilter.visibleGoals]);

  return (
    <OnboardingContainer
      step={10}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      title="Here is your plan"
      subtitle="This is how NuTri will personalize your first experience."
      fallbackHref="/onboarding/setup"
      scrollable
      onNext={handleNext}
      nextLabel="Build first stack"
    >
      <View style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Smart Filter goals</Text>
          <Text style={styles.sectionCopy}>Only goals selected in onboarding will appear in your Smart Filter.</Text>
          <View style={styles.pillsWrap}>
            {visibleGoals.map((goal) => (
              <Pill key={goal} label={goal} />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Type focus</Text>
          <Text style={styles.sectionCopy}>
            {preferredTypes.length > 0
              ? 'We will pre-select these types the first time you open Smart Filter.'
              : 'No type pre-selection yet. You can customize this anytime.'}
          </Text>
          <View style={styles.pillsWrap}>
            {preferredTypes.length > 0 ? (
              preferredTypes.map((type) => <Pill key={type} label={type} />)
            ) : (
              <Text style={styles.emptyText}>No types selected</Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How we will personalize</Text>
          <Text style={styles.sectionCopy}>{buildPlanPreviewSummary(planPreview)}</Text>
          <Text style={styles.inlineSummary}>{buildBlockerStrategySummary(planPreview.blockerStrategy)}</Text>
          {dietLaneLabels.length > 0 ? (
            <Text style={styles.inlineSummary}>Diet review lanes: {dietLaneLabels.join(', ')}</Text>
          ) : null}
          {activityAnchorLabels.length > 0 ? (
            <Text style={styles.inlineSummary}>Suggested timing anchors: {activityAnchorLabels.join(', ')}</Text>
          ) : null}
          {explanation ? (
            <View style={styles.explanationBox}>
              {explanationLabel ? <Text style={styles.explanationLabel}>{explanationLabel}</Text> : null}
              {explanationMeta ? <Text style={styles.explanationMeta}>{explanationMeta}</Text> : null}
              <Text style={styles.explanationSummary}>{explanation.summary}</Text>
              {explanation.bullets.map((bullet) => (
                <Text key={bullet} style={styles.explanationBullet}>
                  • {bullet}
                </Text>
              ))}
            </View>
          ) : explanationState === 'loading' ? (
            <View style={styles.explanationBox}>
              <Text style={styles.explanationLabel}>Personalized summary</Text>
              <Text style={styles.explanationMeta}>Loading explanation…</Text>
            </View>
          ) : explanationState === 'error' ? (
            <View style={styles.explanationBox}>
              <Text style={styles.explanationLabel}>Personalized summary</Text>
              <Text style={styles.explanationMeta}>
                We could not load the explainer right now, but the plan above still uses your saved personalization rules.
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </OnboardingContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: 18,
  },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  sectionCopy: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.textMuted,
  },
  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1D4ED8',
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  inlineSummary: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
  },
  explanationBox: {
    gap: 6,
    paddingTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  explanationLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: '#1D4ED8',
  },
  explanationMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  explanationSummary: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    color: colors.text,
  },
  explanationBullet: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
  },
});
