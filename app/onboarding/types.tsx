import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { buildSmartFilterConfig, ONBOARDING_TOTAL_STEPS, TYPE_OPTIONS } from '@/lib/onboarding-v2';
import { colors } from '@/lib/theme';

export default function TypesScreen() {
  const router = useRouter();
  const { draft, saveDraft } = useOnboarding();
  const [selectedTypes, setSelectedTypes] = useState<string[]>(draft?.preferredTypes ?? []);

  useEffect(() => {
    setSelectedTypes(draft?.preferredTypes ?? []);
  }, [draft?.preferredTypes]);

  const toggleType = useCallback((type: string) => {
    setSelectedTypes((current) => {
      if (current.includes(type)) {
        return current.filter((item) => item !== type);
      }
      return [...current, type];
    });
  }, []);

  const persistAndContinue = useCallback(async () => {
    const smartFilterConfig = buildSmartFilterConfig({
      goals: draft?.goals ?? [],
      preferredTypes: selectedTypes,
    });

    await saveDraft(
      {
        preferredTypes: selectedTypes,
        smartFilterConfig,
      },
      7,
    );

    trackOnboardingEvent('question_answered', {
      question: 'preferred_types',
      answerCount: selectedTypes.length,
      answers: selectedTypes,
    });

    router.replace('/onboarding/blocker');
  }, [draft?.goals, router, saveDraft, selectedTypes]);

  return (
    <OnboardingContainer
      step={7}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      title="Which supplement types do you want to focus on first?"
      subtitle="Optional. We will use this to pre-select your Smart Filter view."
      fallbackHref="/onboarding/goals"
      scrollable
      showSkip
      onSkip={persistAndContinue}
      onNext={persistAndContinue}
      nextLabel="Continue"
    >
      <View style={styles.content}>
        <Text style={styles.why}>Why we ask: type preferences make your first Smart Filter session faster.</Text>
        <View style={styles.list}>
          {TYPE_OPTIONS.map((type) => {
            const selected = selectedTypes.includes(type);
            return (
              <OnboardingCard
                key={type}
                label={type}
                selected={selected}
                onPress={() => toggleType(type)}
                accessibilityLabel={`${type}${selected ? ' selected' : ''}`}
              />
            );
          })}
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
});
