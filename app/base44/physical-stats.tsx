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
import { Activity } from 'lucide-react-native';

import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { NeumorphicCard } from '@/components/base44/qa/NeumorphicCard';
import { SelectOption } from '@/components/base44/qa/SelectOption';
import { colors, spacing } from '@/lib/theme';
import { getNextStep, getStepConfig } from '@/lib/base44/routes';
import { loadCurrentProfile, upsertProfile } from '@/lib/base44/profile';
import type { BodyType } from '@/lib/base44/types';
import { useFadeSlideIn } from '@/hooks/useFadeSlideIn';

const BODY_TYPES: { value: string; label: string }[] = [
  { value: 'ectomorph', label: 'Ectomorph (Lean, hard to gain weight)' },
  { value: 'mesomorph', label: 'Mesomorph (Athletic, muscular)' },
  { value: 'endomorph', label: 'Endomorph (Larger frame, easier to gain weight)' },
  { value: 'not-sure', label: 'Not sure' },
];

export default function PhysicalStatsScreen() {
  const router = useRouter();
  const { stepNumber } = getStepConfig('physical-stats');
  const nextStep = getNextStep('physical-stats');

  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [bodyType, setBodyType] = useState<BodyType | ''>('');
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
            setHeight(profile.heightCm ? String(profile.heightCm) : profile.height_cm ? String(profile.height_cm) : '');
            setWeight(profile.weightKg ? String(profile.weightKg) : profile.weight_kg ? String(profile.weight_kg) : '');
            setBodyType((profile.bodyType ?? profile.body_type ?? '') as BodyType | '');
          }
        } catch (error) {
          console.warn('[base44] failed to load physical stats', error);
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
    () => saving || !height.trim() || !weight.trim() || !bodyType,
    [bodyType, height, saving, weight],
  );

  const metricsAnim = useFadeSlideIn(120);
  const bodyAnim = useFadeSlideIn(260);

  const handleNext = useCallback(async () => {
    if (!nextStep || disableNext) return;
    setSaving(true);
    try {
      const heightValue = Number(height);
      const weightValue = Number(weight);

      await upsertProfile({
        heightCm: heightValue,
        height_cm: heightValue,
        weightKg: weightValue,
        weight_kg: weightValue,
        bodyType: bodyType as BodyType,
        body_type: bodyType as BodyType,
        completed_steps: 2,
      });

      router.push(getStepConfig(nextStep).path as Href);
    } catch (error) {
      console.warn('[base44] failed to save physical stats', error);
    } finally {
      setSaving(false);
    }
  }, [bodyType, disableNext, height, nextStep, router, weight]);

  return (
    <OnboardingContainer
      step={stepNumber}
      totalSteps={7}
      title="Physical Stats"
      subtitle="Help us understand your body metrics"
      nextLabel={saving ? 'Saving…' : 'Continue'}
      disableNext={disableNext}
      fallbackHref={'/base44/demographics' as Href}
      onNext={handleNext}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.select({ ios: 'padding', android: undefined })}
      >
        <ScrollView
          style={styles.scrollContainer}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : (
            <>
              <Animated.View style={metricsAnim}>
                <NeumorphicCard style={styles.card}>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Height (cm) *</Text>
                    <TextInput
                      value={height}
                      onChangeText={setHeight}
                    keyboardType="number-pad"
                    placeholder="e.g., 170"
                    style={styles.input}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Weight (kg) *</Text>
                  <TextInput
                    value={weight}
                    onChangeText={setWeight}
                    keyboardType="number-pad"
                    placeholder="e.g., 70"
                    style={styles.input}
                  />
                </View>
                </NeumorphicCard>
              </Animated.View>

              <Animated.View style={bodyAnim}>
                <NeumorphicCard>
                  <Text style={[styles.label, styles.sectionHeading]}>Body Type *</Text>
                  <View style={styles.options}>
                    {BODY_TYPES.map((option) => (
                      <SelectOption
                        key={option.value}
                        label={option.label}
                        value={option.value}
                        isSelected={bodyType === option.value}
                        onSelect={(val) => setBodyType(val as BodyType)}
                        icon={Activity}
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
  scrollContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
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
  card: {
    gap: spacing.md,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
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
  sectionHeading: {
    marginBottom: spacing.sm,
  },
  options: {
    gap: spacing.sm,
  },
});
