import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';

import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { colors } from '@/lib/theme';
import { goalsSchema, type GoalsFormValues } from '@/lib/validation/onboarding';

const GOAL_OPTIONS: GoalsFormValues['goals'] = [
  'Boost energy',
  'Improve sleep',
  'Support immunity',
  'Enhance focus',
  'Manage stress',
  'Build muscle',
  'Weight management',
  'General wellness',
];

const GoalsScreen = () => {
  const router = useRouter();
  const { draft, loading, saveDraft } = useOnboarding();
  const [limitWarning, setLimitWarning] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isValid, isSubmitting },
    reset,
    watch,
  } = useForm<GoalsFormValues>({
    resolver: zodResolver(goalsSchema),
    mode: 'onChange',
    defaultValues: {
      goals: draft?.goals?.length ? draft.goals : [],
    },
  });

  const selectedGoals = watch('goals') ?? [];

  useEffect(() => {
    if (!loading) {
      reset({
        goals: draft?.goals?.length ? draft.goals : [],
      });
    }
  }, [draft?.goals, loading, reset]);

  const toggleGoal = useCallback(
    (current: string[], next: string) => {
      if (current.includes(next)) {
        return current.filter(item => item !== next);
      }
      if (current.length >= 3) {
        setLimitWarning('You can select up to 3 goals.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        return current;
      }
      setLimitWarning(null);
      return [...current, next];
    },
    [],
  );

  const onSubmit = useCallback(
    async (values: GoalsFormValues) => {
      const parsed = goalsSchema.parse(values);
      try {
        await saveDraft({ goals: parsed.goals }, 7);
        console.log('🎯 Goals saved', parsed.goals);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.push('/onboarding/privacy');
      } catch (error) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        console.error('Failed to save goals', error);
      }
    },
    [router, saveDraft],
  );

  const handleError = useCallback(async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, []);

  useEffect(() => {
    if (selectedGoals.length < 3 && limitWarning) {
      setLimitWarning(null);
    }
  }, [limitWarning, selectedGoals.length]);

  return (
    <OnboardingContainer
      step={6}
      totalSteps={7}
      title="What are your goals?"
      subtitle="Choose up to three areas you want to focus on."
      onBack={() => router.back()}
      onNext={handleSubmit(onSubmit, handleError)}
      disableNext={!isValid || isSubmitting}
      nextLabel={isSubmitting ? 'Saving...' : 'Next'}
    >
      <View style={styles.list}>
        <Controller
          control={control}
          name="goals"
          render={({ field: { value, onChange } }) => (
            <>
              {GOAL_OPTIONS.map(option => {
                const selected = value?.includes(option) ?? false;
                return (
                  <OnboardingCard
                    key={option}
                    label={option}
                    selected={selected}
                    onPress={() => onChange(toggleGoal(value ?? [], option))}
                    accessibilityLabel={`${option}${selected ? ' selected' : ''}`}
                  />
                );
              })}
            </>
          )}
        />
        <Text style={[styles.helper, selectedGoals.length === 0 && styles.helperError]}>
          {limitWarning ?? `Select ${selectedGoals.length === 0 ? 'at least one' : 'up to three'} goals.`}
        </Text>
      </View>
    </OnboardingContainer>
  );
};

const styles = StyleSheet.create({
  list: {
    flex: 1,
    gap: 16,
  },
  helper: {
    fontSize: 14,
    color: colors.textMuted,
  },
  helperError: {
    color: '#EF4444',
  },
});

export default GoalsScreen;
