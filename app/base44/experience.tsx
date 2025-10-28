import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { ChefHat, Dumbbell } from 'lucide-react-native';

import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { NeumorphicCard } from '@/components/base44/qa/NeumorphicCard';
import { SelectOption } from '@/components/base44/qa/SelectOption';
import { colors, spacing } from '@/lib/theme';
import { getNextStep, getStepConfig } from '@/lib/base44/routes';
import { loadCurrentProfile, upsertProfile } from '@/lib/base44/profile';
import type { CookingSkill, FitnessLevel } from '@/lib/base44/types';
import { useFadeSlideIn } from '@/hooks/useFadeSlideIn';

const FITNESS_LEVELS: { value: FitnessLevel; label: string }[] = [
  { value: 'beginner', label: 'Beginner (Just starting out)' },
  { value: 'intermediate', label: 'Intermediate (Regular exercise)' },
  { value: 'advanced', label: 'Advanced (Very active)' },
  { value: 'athlete', label: 'Athlete (Competitive/Professional)' },
];

const COOKING_SKILLS: { value: CookingSkill; label: string }[] = [
  { value: 'novice', label: 'Novice (Rarely cook)' },
  { value: 'basic', label: 'Basic (Simple meals)' },
  { value: 'intermediate', label: 'Intermediate (Comfortable cooking)' },
  { value: 'expert', label: 'Expert (Love to cook)' },
];

export default function ExperienceScreen() {
  const router = useRouter();
  const { stepNumber } = getStepConfig('experience');
  const nextStep = getNextStep('experience');

  const [fitnessLevel, setFitnessLevel] = useState<FitnessLevel | null>(null);
  const [cookingSkills, setCookingSkills] = useState<CookingSkill | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      const load = async () => {
        setLoading(true);
        try {
          const profile = await loadCurrentProfile();
          if (profile && isActive) {
            setFitnessLevel((profile.fitness_level as FitnessLevel) ?? null);
            setCookingSkills((profile.cooking_skills as CookingSkill) ?? null);
          }
        } catch (error) {
          console.warn('[base44] failed to load experience', error);
        } finally {
          if (isActive) setLoading(false);
        }
      };

      load();
      return () => {
        isActive = false;
      };
    }, []),
  );

  const disableNext = useMemo(
    () => saving || !fitnessLevel || !cookingSkills,
    [cookingSkills, fitnessLevel, saving],
  );

  const handleNext = useCallback(async () => {
    if (!nextStep || disableNext) return;
    setSaving(true);
    try {
      await upsertProfile({
        fitness_level: fitnessLevel ?? undefined,
        fitnessLevel: fitnessLevel ?? undefined,
        cooking_skills: cookingSkills ?? undefined,
        cookingSkills: cookingSkills ?? undefined,
        completed_steps: 5,
      });
      router.push(getStepConfig(nextStep).path as Href);
    } catch (error) {
      console.warn('[base44] failed to save experience', error);
    } finally {
      setSaving(false);
    }
  }, [cookingSkills, disableNext, fitnessLevel, nextStep, router]);

  const fitnessAnim = useFadeSlideIn(120);
  const cookingAnim = useFadeSlideIn(260);

  return (
    <OnboardingContainer
      step={stepNumber}
      totalSteps={7}
      title="Your Experience"
      subtitle="Let's understand your current fitness and cooking level"
      nextLabel={saving ? 'Saving…' : 'Continue'}
      disableNext={disableNext}
      fallbackHref={'/base44/dietary' as Href}
      onNext={handleNext}
    >
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Animated.View style={fitnessAnim}>
            <NeumorphicCard>
              <View style={styles.sectionHeader}>
                <Dumbbell size={18} color={colors.brand} />
                <Text style={styles.label}>Fitness Level *</Text>
              </View>
              <View style={styles.options}>
                {FITNESS_LEVELS.map((option) => (
                  <SelectOption
                    key={option.value}
                    label={option.label}
                    value={option.value}
                    isSelected={fitnessLevel === option.value}
                    onSelect={(val) => setFitnessLevel(val as FitnessLevel)}
                    icon={Dumbbell}
                  />
                ))}
              </View>
            </NeumorphicCard>
          </Animated.View>

          <Animated.View style={cookingAnim}>
            <NeumorphicCard>
              <View style={styles.sectionHeader}>
                <ChefHat size={18} color={colors.brand} />
                <Text style={styles.label}>Cooking Skills *</Text>
              </View>
              <View style={styles.options}>
                {COOKING_SKILLS.map((option) => (
                  <SelectOption
                    key={option.value}
                    label={option.label}
                    value={option.value}
                    isSelected={cookingSkills === option.value}
                    onSelect={(val) => setCookingSkills(val as CookingSkill)}
                    icon={ChefHat}
                  />
                ))}
              </View>
            </NeumorphicCard>
          </Animated.View>
        </ScrollView>
      )}
    </OnboardingContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  options: {
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
});
