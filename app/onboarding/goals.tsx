import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { buildSmartFilterConfig, GOAL_OPTIONS, ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding-v2';
import { colors } from '@/lib/theme';

export default function GoalsScreen() {
  const router = useRouter();
  const { draft, saveDraft } = useOnboarding();
  const [selectedGoals, setSelectedGoals] = useState<string[]>(draft?.goals ?? []);

  useEffect(() => {
    setSelectedGoals(draft?.goals ?? []);
  }, [draft?.goals]);

  const toggleGoal = useCallback((goal: string) => {
    setSelectedGoals((current) => {
      if (current.includes(goal)) {
        return current.filter((item) => item !== goal);
      }
      return [...current, goal];
    });
  }, []);

  const handleNext = useCallback(async () => {
    if (selectedGoals.length === 0) return;

    const smartFilterConfig = buildSmartFilterConfig({
      goals: selectedGoals,
      preferredTypes: draft?.preferredTypes ?? [],
    });

    await saveDraft(
      {
        goals: selectedGoals,
        smartFilterConfig,
      },
      6,
    );

    trackOnboardingEvent('question_answered', {
      question: 'goals',
      answerCount: selectedGoals.length,
      answers: selectedGoals,
    });
    router.replace('/onboarding/types');
  }, [draft?.preferredTypes, router, saveDraft, selectedGoals]);

  return (
    <OnboardingContainer
      step={6}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      title="What are your goals right now?"
      subtitle="Select at least one. Your selected goals will appear in Smart Filter."
      fallbackHref="/onboarding/experience"
      scrollable
      disableNext={selectedGoals.length === 0}
      onNext={handleNext}
    >
      <View style={styles.content}>
        <Text style={styles.why}>Why we ask: goals directly power your Smart Filter and recommendation focus.</Text>
        <View style={styles.list}>
          {GOAL_OPTIONS.map((goal) => {
            const selected = selectedGoals.includes(goal);
            return (
              <OnboardingCard
                key={goal}
                label={goal}
                selected={selected}
                onPress={() => toggleGoal(goal)}
                accessibilityLabel={`${goal}${selected ? ' selected' : ''}`}
              />
            );
          })}
        </View>
        {selectedGoals.length === 0 ? <Text style={styles.error}>Select at least one goal to continue.</Text> : null}
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
  error: {
    fontSize: 13,
    color: '#EF4444',
    fontWeight: '600',
  },
});
