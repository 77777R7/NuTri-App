// app/base44/demographics.tsx
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { User } from 'lucide-react-native';

import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { NeumorphicCard } from '@/components/base44/qa/NeumorphicCard';
import { SelectOption } from '@/components/base44/qa/SelectOption';
import { colors, spacing } from '@/lib/theme';
import { getNextStep, getStepConfig } from '@/lib/base44/routes';
import { loadCurrentProfile, upsertProfile } from '@/lib/base44/profile';
import type { Gender } from '@/lib/base44/types';
import { Text } from '@/components/ui/nativewind-primitives';
import { useFadeSlideIn } from '@/hooks/useFadeSlideIn';

const GENDERS: { label: string; value: Gender }[] = [
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
  { label: 'Non-binary', value: 'non-binary' },
  { label: 'Prefer not to say', value: 'prefer-not-to-say' },
];

export default function DemographicsScreen() {
  const router = useRouter();
  const { stepNumber } = getStepConfig('demographics');
  const nextStep = getNextStep('demographics');

  const [age, setAge] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      (async () => {
        setLoading(true);
        try {
          const profile = await loadCurrentProfile();
          if (profile && isActive) {
            setAge(profile.age ? String(profile.age) : '');
            setGender((profile.gender as Gender) ?? '');
            setLocation(profile.location ?? profile.locationCity ?? '');
          }
        } catch (error) {
          console.warn('[base44] failed to load demographics', error);
        } finally {
          if (isActive) setLoading(false);
        }
      })();
      return () => {
        isActive = false;
      };
    }, []),
  );

  const disableNext = useMemo(() => saving || !age.trim() || !gender, [age, gender, saving]);

  const handleNext = useCallback(async () => {
    if (!nextStep || disableNext) return;
    setSaving(true);
    try {
      await upsertProfile({
        age: Number(age),
        gender: gender as Gender,
        location,
        locationCity: location.trim() || undefined,
        completed_steps: 1, // 兼容旧字段
      });
      router.push(getStepConfig(nextStep).path as Href);
    } catch (error) {
      console.warn('[base44] failed to save demographics', error);
    } finally {
      setSaving(false);
    }
  }, [age, disableNext, gender, location, nextStep, router]);

  const inputsAnim = useFadeSlideIn(120);
  const genderAnim = useFadeSlideIn(260);

  return (
    <OnboardingContainer
      step={stepNumber}
      totalSteps={7}
      title="About You"
      subtitle="Let's start with some basic information"
      nextLabel={saving ? 'Saving…' : 'Continue'}
      backLabel="Back"
      disableNext={disableNext}
      fallbackHref={'/base44/welcome' as Href}
      onNext={handleNext}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        keyboardVerticalOffset={24}
      >
        <ScrollView
          style={styles.scrollContainer}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : (
            <>
              <Animated.View style={inputsAnim}>
                <NeumorphicCard style={styles.card}>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Age *</Text>
                    <View style={styles.inputSurface}>
                      <TextInput
                        value={age}
                        onChangeText={setAge}
                        keyboardType="number-pad"
                        placeholder="Enter your age"
                        placeholderTextColor="rgba(15,23,42,0.32)"
                        returnKeyType="next"
                        style={styles.input}
                      />
                    </View>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Location (optional)</Text>
                    <View style={styles.inputSurface}>
                      <TextInput
                        value={location}
                        onChangeText={setLocation}
                        placeholder="City, Country"
                        placeholderTextColor="rgba(15,23,42,0.32)"
                        autoCapitalize="words"
                        returnKeyType="done"
                        style={styles.input}
                      />
                    </View>
                  </View>
                </NeumorphicCard>
              </Animated.View>

              <Animated.View style={genderAnim}>
                <NeumorphicCard>
                  <Text style={[styles.label, styles.sectionHeading]}>Gender *</Text>
                  <View style={styles.options}>
                    {GENDERS.map((option) => (
                      <SelectOption
                        key={option.value}
                        label={option.label}
                        value={option.value}
                        isSelected={gender === option.value}
                        onSelect={(val) => setGender(val as Gender)}
                        icon={User}
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
  flex: { flex: 1 },
  scrollContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scroll: { paddingBottom: spacing.xl, gap: spacing.lg },
  loadingWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl,
  },
  card: { gap: spacing.md },
  fieldGroup: { gap: spacing.xs },
  label: { fontSize: 15, fontWeight: '600', color: colors.text },
  inputSurface: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: 'transparent',
  },
  sectionHeading: { marginBottom: spacing.sm },
  options: { gap: spacing.sm },
});
