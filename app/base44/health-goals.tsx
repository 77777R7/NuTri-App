import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Moon, Target, TrendingDown, TrendingUp, Zap, Activity as ActivityIcon } from 'lucide-react-native';

import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { NeumorphicCard } from '@/components/base44/qa/NeumorphicCard';
import { SelectOption } from '@/components/base44/qa/SelectOption';
import { colors, spacing } from '@/lib/theme';
import { getNextStep, getStepConfig } from '@/lib/base44/routes';
import { loadCurrentProfile, upsertProfile } from '@/lib/base44/profile';
import type { HealthGoal, Timeline } from '@/lib/base44/types';
import { useFadeSlideIn } from '@/hooks/useFadeSlideIn';

const GOALS: { value: HealthGoal; label: string; icon: typeof TrendingDown }[] = [
  { value: 'weight-loss', label: 'Weight Loss', icon: TrendingDown },
  { value: 'muscle-gain', label: 'Muscle Gain', icon: TrendingUp },
  { value: 'maintenance', label: 'Maintain Current Weight', icon: ActivityIcon },
  { value: 'energy-boost', label: 'Boost Energy', icon: Zap },
  { value: 'better-sleep', label: 'Better Sleep', icon: Moon },
  { value: 'disease-management', label: 'Disease Management', icon: Target },
];

const TIMELINES: { value: Timeline; label: string }[] = [
  { value: '1-month', label: '1 Month' },
  { value: '3-months', label: '3 Months' },
  { value: '6-months', label: '6 Months' },
  { value: '1-year', label: '1 Year' },
  { value: 'no-rush', label: 'No Rush, Long-term' },
];

export default function HealthGoalsScreen() {
  const router = useRouter();
  const { stepNumber } = getStepConfig('health-goals');
  const nextStep = getNextStep('health-goals');

  const [goals, setGoals] = useState<HealthGoal[]>([]);
  const [targetWeight, setTargetWeight] = useState('');
  const [timeline, setTimeline] = useState<Timeline | ''>('');
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
            setGoals((profile.health_goals ?? profile.goals ?? []) as HealthGoal[]);
            setTargetWeight(profile.target_weight_kg ? String(profile.target_weight_kg) : '');
            setTimeline((profile.timeline as Timeline) ?? '');
          }
        } catch (error) {
          console.warn('[base44] failed to load goals', error);
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

  const disableNext = useMemo(() => saving || goals.length === 0 || !timeline, [goals.length, saving, timeline]);

  const toggleGoal = useCallback(
    (value: HealthGoal) => {
      setGoals((prev) =>
        prev.includes(value)
          ? prev.filter((goal) => goal !== value)
          : [...prev, value],
      );
    },
    [],
  );

  const handleNext = useCallback(async () => {
    if (!nextStep || disableNext) return;
    setSaving(true);
    try {
      await upsertProfile({
        health_goals: goals,
        goals,
        target_weight_kg: targetWeight ? Number(targetWeight) : null,
        targetWeightKg: targetWeight ? Number(targetWeight) : null,
        timeline: timeline as Timeline,
        completed_steps: 3,
      });
      router.push(getStepConfig(nextStep).path as Href);
    } catch (error) {
      console.warn('[base44] failed to save goals', error);
    } finally {
      setSaving(false);
    }
  }, [disableNext, goals, nextStep, router, targetWeight, timeline]);

  const goalsAnim = useFadeSlideIn(120);
  const targetAnim = useFadeSlideIn(240);
  const timelineAnim = useFadeSlideIn(360);

  return (
    <OnboardingContainer
      step={stepNumber}
      totalSteps={7}
      title="Health Goals"
      subtitle="What would you like to achieve?"
      nextLabel={saving ? 'Saving…' : 'Continue'}
      disableNext={disableNext}
      fallbackHref="/base44/physical-stats"
      onNext={handleNext}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.select({ ios: 'padding', android: undefined })}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : (
            <>
              <Animated.View style={goalsAnim}>
                <NeumorphicCard>
                  <Text style={[styles.label, styles.sectionHeading]}>Select your goals (multiple allowed)</Text>
                  <View style={styles.options}>
                    {GOALS.map((goal) => (
                      <SelectOption
                        key={goal.value}
                      label={goal.label}
                      value={goal.value}
                      isSelected={goals.includes(goal.value)}
                      onSelect={(val) => toggleGoal(val as HealthGoal)}
                      icon={goal.icon}
                    />
                  ))}
                  </View>
                </NeumorphicCard>
              </Animated.View>

              <Animated.View style={targetAnim}>
                <NeumorphicCard style={styles.card}>
                  <Text style={styles.label}>Target Weight (kg) - Optional</Text>
                  <TextInput
                    value={targetWeight}
                    onChangeText={setTargetWeight}
                    keyboardType="number-pad"
                    placeholder="e.g., 65"
                    style={styles.input}
                  />
                </NeumorphicCard>
              </Animated.View>

              <Animated.View style={timelineAnim}>
                <NeumorphicCard>
                  <Text style={[styles.label, styles.sectionHeading]}>Timeline *</Text>
                  <View style={styles.options}>
                    {TIMELINES.map((option) => (
                      <SelectOption
                        key={option.value}
                        label={option.label}
                        value={option.value}
                        isSelected={timeline === option.value}
                        onSelect={(val) => setTimeline(val as Timeline)}
                        icon={Target}
                      />
                    ))}
                  </View>
                </NeumorphicCard>
              </Animated.View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </OnboardingContainer>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scroll: {
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  options: {
    gap: spacing.sm,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  sectionHeading: {
    marginBottom: spacing.sm,
  },
  card: {
    gap: spacing.sm,
  },
  input: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
  },
});
