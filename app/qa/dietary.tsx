import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import AppHeader from '@/components/common/AppHeader';
import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useQA } from '@/contexts/QAContext';
import { colors, spacing } from '@/lib/theme';

const DIETARY_OPTIONS = [
  { id: 'vegetarian', emoji: '🥗', label: 'Vegetarian' },
  { id: 'vegan', emoji: '🌱', label: 'Vegan' },
  { id: 'gluten-free', emoji: '🌾', label: 'Gluten-free' },
  { id: 'dairy-free', emoji: '🥛', label: 'Dairy-free' },
  { id: 'nut-allergy', emoji: '🥜', label: 'Nut allergy' },
  { id: 'shellfish-allergy', emoji: '🦐', label: 'Shellfish allergy' },
  { id: 'soy-free', emoji: '🫘', label: 'Soy-free' },
  { id: 'kosher', emoji: '✡️', label: 'Kosher' },
  { id: 'halal', emoji: '☪️', label: 'Halal' },
  { id: 'pescatarian', emoji: '🐟', label: 'Pescatarian' },
  { id: 'keto', emoji: '🥓', label: 'Keto' },
  { id: 'paleo', emoji: '🥩', label: 'Paleo' },
];

export default function DietaryScreen() {
  const router = useRouter();
  const { data, updateData, setStep } = useQA();
  const [selectedDietary, setSelectedDietary] = useState<string[]>(data.dietaryRestrictions || []);

  const toggleDietary = useCallback(
    (dietId: string) => {
      setSelectedDietary((prev) => {
        const isSelected = prev.includes(dietId);
        if (isSelected) {
          return prev.filter((id) => id !== dietId);
        }
        return [...prev, dietId];
      });
      Haptics.selectionAsync().catch(() => {});
    },
    []
  );

  const handleContinue = useCallback(async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      updateData({
        dietaryRestrictions: selectedDietary,
      });
      setStep(6);
      router.push('/qa/experience');
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error('Failed to save dietary restrictions', error);
    }
  }, [selectedDietary, router, updateData, setStep]);

  const handleSkip = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
      updateData({
        dietaryRestrictions: [],
      });
      setStep(6);
      router.push('/qa/experience');
    } catch (error) {
      console.error('Failed to skip dietary', error);
    }
  }, [router, updateData, setStep]);

  return (
    <>
      <AppHeader title="Step 5 of 7" showBack />
      <OnboardingContainer
        step={5}
        totalSteps={7}
        title="Dietary preferences"
        subtitle="Help us avoid recommending unsuitable supplements"
        fallbackHref="/qa/health-goals"
        onNext={handleContinue}
        disableNext={false}
        nextLabel="Continue →"
        showSkip
        onSkip={handleSkip}
        skipLabel="Skip - No restrictions"
      >
        <View style={styles.content}>
          {/* Selection Counter */}
          {selectedDietary.length > 0 && (
            <View style={styles.counterBadge}>
              <Text style={styles.counterText}>
                {selectedDietary.length} {selectedDietary.length === 1 ? 'restriction' : 'restrictions'} selected
              </Text>
            </View>
          )}

          {/* Dietary Grid */}
          <View style={styles.dietaryGrid}>
            {DIETARY_OPTIONS.map((option) => (
              <OnboardingCard
                key={option.id}
                label={`${option.emoji} ${option.label}`}
                selected={selectedDietary.includes(option.id)}
                onPress={() => toggleDietary(option.id)}
                accessibilityLabel={`${option.label}${selectedDietary.includes(option.id) ? ' selected' : ''}`}
              />
            ))}
          </View>

          {/* Helper Text */}
          <Text style={styles.helper}>
            💡 {selectedDietary.length === 0 
              ? 'Select your dietary restrictions or skip if you have none' 
              : 'We\'ll filter out supplements that don\'t match your preferences'}
          </Text>
        </View>
      </OnboardingContainer>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: spacing.md,
  },
  counterBadge: {
    alignSelf: 'center',
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    shadowColor: colors.brandDark,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  counterText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dietaryGrid: {
    gap: spacing.md,
  },
  helper: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});

