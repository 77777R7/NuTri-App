import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding-v2';
import { colors } from '@/lib/theme';

const START_OPTIONS = [
  { value: 'scan', label: 'Scan first supplement', description: 'Fastest way to unlock personalized insights.' },
  { value: 'manual', label: 'Add manually', description: 'Upload or enter details without a live scan.' },
  { value: 'later', label: 'I will do this later', description: 'Finish setup first and start from Home.' },
] as const;

export default function FirstStackScreen() {
  const router = useRouter();
  const { draft, saveDraft } = useOnboarding();
  const [selected, setSelected] = useState<'scan' | 'manual' | 'later'>(draft?.firstActionPreference ?? 'scan');

  useEffect(() => {
    setSelected((draft?.firstActionPreference as 'scan' | 'manual' | 'later' | undefined) ?? 'scan');
  }, [draft?.firstActionPreference]);

  const handleNext = useCallback(async () => {
    await saveDraft({ firstActionPreference: selected }, 11);
    router.push('/onboarding/done');
  }, [router, saveDraft, selected]);

  return (
    <OnboardingContainer
      step={11}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      title="Build your first stack"
      subtitle="Pick how you want to start so we can guide your next action."
      fallbackHref="/onboarding/plan-preview"
      onNext={handleNext}
      nextLabel="Finish setup"
    >
      <View style={styles.content}>
        <Text style={styles.why}>Why we ask: choosing your first move helps us reduce setup friction.</Text>
        <View style={styles.list}>
          {START_OPTIONS.map((option) => (
            <OnboardingCard
              key={option.value}
              label={option.label}
              description={option.description}
              selected={selected === option.value}
              onPress={() => setSelected(option.value)}
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
});
