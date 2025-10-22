import React, { useCallback, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';

import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { colors } from '@/lib/theme';
import { activitySchema, type ActivityFormValues } from '@/lib/validation/onboarding';

const ACTIVITY_LEVELS: { value: ActivityFormValues['activity']; label: string; description: string }[] = [
  { value: 'sedentary', label: 'Sedentary', description: 'Little to no exercise' },
  { value: 'light', label: 'Lightly active', description: '1-2 days of light activity' },
  { value: 'moderate', label: 'Moderately active', description: '3-4 workouts per week' },
  { value: 'active', label: 'Active', description: 'Daily exercise or intense training' },
  { value: 'athlete', label: 'Athlete', description: 'Competitive or elite training schedule' },
];

const ActivityScreen = () => {
  const router = useRouter();
  const { draft, loading, saveDraft } = useOnboarding();

  const {
    control,
    handleSubmit,
    formState: { isValid, isSubmitting },
    reset,
  } = useForm<ActivityFormValues>({
    resolver: zodResolver(activitySchema),
    mode: 'onChange',
    defaultValues: {
      activity: draft?.activity ?? '',
    },
  });

  useEffect(() => {
    if (!loading) {
      reset({
        activity: draft?.activity ?? '',
      });
    }
  }, [draft?.activity, loading, reset]);

  const onSubmit = useCallback(
    async (values: ActivityFormValues) => {
      const parsed = activitySchema.parse(values);
      try {
        await saveDraft({ activity: parsed.activity }, 5);
        console.log('🏃 Activity selected', parsed.activity);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.push('/onboarding/location');
      } catch (error) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        console.error('Failed to save activity', error);
      }
    },
    [router, saveDraft],
  );

  const handleError = useCallback(async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, []);

  return (
    <OnboardingContainer
      step={4}
      totalSteps={7}
      title="How active are you?"
      subtitle="Choose the level that best describes your weekly activity."
      onBack={() => router.back()}
      onNext={handleSubmit(onSubmit, handleError)}
      disableNext={!isValid || isSubmitting}
      nextLabel={isSubmitting ? 'Saving...' : 'Next'}
    >
      <View style={styles.list}>
        <Controller
          control={control}
          name="activity"
          render={({ field: { value, onChange } }) => (
            <>
              {ACTIVITY_LEVELS.map(level => (
                <OnboardingCard
                  key={level.value}
                  label={level.label}
                  description={level.description}
                  selected={value === level.value}
                  onPress={() => onChange(level.value)}
                  accessibilityLabel={`${level.label}${value === level.value ? ' selected' : ''}`}
                />
              ))}
            </>
          )}
        />
        {!isValid ? <Text style={styles.helper}>Select the activity level that fits you best.</Text> : null}
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
});

export default ActivityScreen;
