import React, { useCallback, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';

import AppHeader from '@/components/common/AppHeader';
import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { colors } from '@/lib/theme';
import { dietSchema, type DietFormValues } from '@/lib/validation/onboarding';

const DIET_OPTIONS: DietFormValues['diets'] = [
  'Omnivore',
  'Vegetarian',
  'Vegan',
  'Pescatarian',
  'Gluten-free',
  'Dairy-free',
  'Keto',
  'Other',
];

const DietScreen = () => {
  const router = useRouter();
  const { draft, loading, saveDraft } = useOnboarding();

  const {
    control,
    handleSubmit,
    formState: { isValid, isSubmitting },
    reset,
    watch,
  } = useForm<DietFormValues>({
    resolver: zodResolver(dietSchema),
    mode: 'onChange',
    defaultValues: {
      diets: draft?.diets?.length ? draft.diets : [],
    },
  });

  const selectedDiets = watch('diets');

  useEffect(() => {
    if (!loading) {
      reset({
        diets: draft?.diets?.length ? draft.diets : [],
      });
    }
  }, [draft?.diets, loading, reset]);

  const toggleDiet = useCallback(
    (current: string[], next: string) => {
      if (current.includes(next)) {
        return current.filter(item => item !== next);
      }
      return [...current, next];
    },
    [],
  );

  const onSubmit = useCallback(
    async (values: DietFormValues) => {
      const parsed = dietSchema.parse(values);
      try {
        await saveDraft({ diets: parsed.diets }, 4);
        console.log('🥗 Diets saved', parsed.diets);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.push('/onboarding/activity');
      } catch (error) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        console.error('Failed to save diets', error);
      }
    },
    [router, saveDraft],
  );

  const handleError = useCallback(async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, []);

  return (
    <>
      <AppHeader title="Step 3 of 7" showBack />
      <OnboardingContainer
        step={3}
        totalSteps={7}
        title="What’s your eating style?"
        subtitle="Pick the dietary patterns that best match your current routine."
        fallbackHref="/onboarding/welcome"
        onNext={handleSubmit(onSubmit, handleError)}
        disableNext={!isValid || isSubmitting}
        nextLabel={isSubmitting ? 'Saving...' : 'Next'}
      >
        <View style={styles.list}>
          <Controller<DietFormValues>
            control={control}
            name="diets"
            render={({ field }: { field: DietFieldController }) => (
              <>
                {DIET_OPTIONS.map(option => {
                  const selected = field.value?.includes(option) ?? false;
                  return (
                    <OnboardingCard
                      key={option}
                      label={option}
                      selected={selected}
                      onPress={() => field.onChange(toggleDiet(field.value ?? [], option))}
                      accessibilityLabel={`${option}${selected ? ' selected' : ''}`}
                    />
                  );
                })}
              </>
            )}
          />
          {!selectedDiets || selectedDiets.length === 0 ? (
            <Text style={styles.helper}>Select at least one dietary preference.</Text>
          ) : null}
        </View>
      </OnboardingContainer>
    </>
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

export default DietScreen;
type DietFieldController = {
  value: DietFormValues['diets'];
  onChange: (value: DietFormValues['diets']) => void;
};
