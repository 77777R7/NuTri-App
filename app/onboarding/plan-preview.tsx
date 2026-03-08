import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { ONBOARDING_TOTAL_STEPS, resolveTypeTags, resolveVisibleGoalTags } from '@/lib/onboarding-v2';
import { colors } from '@/lib/theme';

const Pill = ({ label }: { label: string }) => (
  <View style={styles.pill}>
    <Text style={styles.pillText}>{label}</Text>
  </View>
);

export default function PlanPreviewScreen() {
  const router = useRouter();
  const { draft, saveDraft } = useOnboarding();

  const visibleGoals = useMemo(() => resolveVisibleGoalTags(draft?.goals), [draft?.goals]);
  const preferredTypes = useMemo(() => resolveTypeTags(draft?.preferredTypes), [draft?.preferredTypes]);

  const handleNext = useCallback(async () => {
    await saveDraft({
      smartFilterConfig: {
        visibleGoals,
        preselectedTypes: preferredTypes,
        preselectedTiming: [],
      },
    }, 10);

    router.replace('/onboarding/first-stack');
  }, [preferredTypes, router, saveDraft, visibleGoals]);

  return (
    <OnboardingContainer
      step={10}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      title="Here is your plan"
      subtitle="This is how NuTri will personalize your first experience."
      fallbackHref="/onboarding/setup"
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
});
