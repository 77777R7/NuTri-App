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
import { useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { AlertCircle, Apple, Beef, Fish, Leaf, X } from 'lucide-react-native';
import Animated from 'react-native-reanimated';

import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { NeumorphicCard } from '@/components/base44/qa/NeumorphicCard';
import { SelectOption } from '@/components/base44/qa/SelectOption';
import { NeumorphicButton } from '@/components/base44/qa/NeumorphicButton';
import { colors, spacing } from '@/lib/theme';
import { getNextStep, getStepConfig } from '@/lib/base44/routes';
import { loadCurrentProfile, upsertProfile } from '@/lib/base44/profile';
import type { DietaryPreference } from '@/lib/base44/types';
import { useFadeSlideIn } from '@/hooks/useFadeSlideIn';

const PREFERENCES: { label: string; value: DietaryPreference; icon?: typeof Leaf }[] = [
  { label: 'Omnivore', value: 'omnivore', icon: Beef },
  { label: 'Vegetarian', value: 'vegetarian', icon: Apple },
  { label: 'Vegan', value: 'vegan', icon: Leaf },
  { label: 'Pescatarian', value: 'pescatarian', icon: Fish },
  { label: 'Keto', value: 'keto' },
  { label: 'Paleo', value: 'paleo' },
  { label: 'Other', value: 'other' },
];

export default function DietaryScreen() {
  const router = useRouter();
  const { stepNumber } = getStepConfig('dietary');
  const nextStep = getNextStep('dietary');

  const [preference, setPreference] = useState<DietaryPreference | ''>('');
  const [restrictions, setRestrictions] = useState<string[]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [restrictionInput, setRestrictionInput] = useState('');
  const [allergyInput, setAllergyInput] = useState('');
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
            setPreference((profile.dietary_preference as DietaryPreference) ?? '');
            setRestrictions(profile.dietary_restrictions ?? []);
            setAllergies(profile.allergies ?? []);
          }
        } catch (error) {
          console.warn('[base44] failed to load dietary info', error);
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

  const disableNext = useMemo(() => saving || !preference, [preference, saving]);

  const addRestriction = useCallback(() => {
    const value = restrictionInput.trim();
    if (!value) return;
    setRestrictions((prev) => [...prev, value]);
    setRestrictionInput('');
  }, [restrictionInput]);

  const addAllergy = useCallback(() => {
    const value = allergyInput.trim();
    if (!value) return;
    setAllergies((prev) => [...prev, value]);
    setAllergyInput('');
  }, [allergyInput]);

  const removeRestriction = useCallback((index: number) => {
    setRestrictions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const removeAllergy = useCallback((index: number) => {
    setAllergies((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleNext = useCallback(async () => {
    if (!nextStep || disableNext) return;
    setSaving(true);
    try {
      await upsertProfile({
        dietary_preference: preference as DietaryPreference,
        dietaryPreferences: restrictions,
        dietary_restrictions: restrictions,
        allergies,
        completed_steps: 4,
      });
      router.push(getStepConfig(nextStep).path as Href);
    } catch (error) {
      console.warn('[base44] failed to save dietary info', error);
    } finally {
      setSaving(false);
    }
  }, [allergies, disableNext, nextStep, preference, restrictions, router]);

  const preferenceAnim = useFadeSlideIn(120);
  const restrictionAnim = useFadeSlideIn(240);
  const allergyAnim = useFadeSlideIn(360);

  return (
    <OnboardingContainer
      step={stepNumber}
      totalSteps={7}
      title="Dietary Preferences"
      subtitle="Tell us about your eating habits"
      nextLabel={saving ? 'Saving…' : 'Continue'}
      disableNext={disableNext}
      fallbackHref="/base44/health-goals"
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
              <Animated.View style={preferenceAnim}>
                <NeumorphicCard>
                  <Text style={[styles.label, styles.sectionHeading]}>Dietary Preference *</Text>
                  <View style={styles.options}>
                    {PREFERENCES.map((option) => (
                      <SelectOption
                        key={option.value}
                      label={option.label}
                      value={option.value}
                      isSelected={preference === option.value}
                      onSelect={(val) => setPreference(val as DietaryPreference)}
                      icon={option.icon}
                    />
                  ))}
                  </View>
                </NeumorphicCard>
              </Animated.View>

              <Animated.View style={restrictionAnim}>
                <NeumorphicCard style={styles.card}>
                  <Text style={styles.label}>Dietary Restrictions (optional)</Text>
                  <View style={styles.inlineForm}>
                    <TextInput
                      value={restrictionInput}
                      onChangeText={setRestrictionInput}
                      placeholder="e.g., No red meat"
                      style={styles.input}
                    />
                    <NeumorphicButton variant="secondary" onPress={addRestriction} style={styles.inlineButton}>
                      Add
                    </NeumorphicButton>
                  </View>
                  <View style={styles.badgeWrap}>
                    {restrictions.map((item, index) => (
                      <View key={`${item}-${index}`} style={styles.badge}>
                        <Text style={styles.badgeText}>{item}</Text>
                        <NeumorphicButton
                          variant="ghost"
                          onPress={() => removeRestriction(index)}
                          style={styles.badgeRemove}
                        >
                          <X size={14} color={colors.subtext} />
                        </NeumorphicButton>
                      </View>
                    ))}
                  </View>
                </NeumorphicCard>
              </Animated.View>

              <Animated.View style={allergyAnim}>
                <NeumorphicCard style={styles.card}>
                  <View style={styles.allergyHeader}>
                    <AlertCircle size={18} color={colors.brand} />
                    <Text style={styles.label}>Allergies (optional but important)</Text>
                  </View>
                  <View style={styles.inlineForm}>
                    <TextInput
                      value={allergyInput}
                      onChangeText={setAllergyInput}
                      placeholder="e.g., Peanuts"
                      style={styles.input}
                    />
                    <NeumorphicButton variant="secondary" onPress={addAllergy} style={styles.inlineButton}>
                      Add
                    </NeumorphicButton>
                  </View>
                  <View style={styles.badgeWrap}>
                    {allergies.map((item, index) => (
                      <View key={`${item}-${index}`} style={[styles.badge, styles.badgeAlert]}>
                        <Text style={[styles.badgeText, styles.badgeAlertText]}>{item}</Text>
                        <NeumorphicButton
                          variant="ghost"
                          onPress={() => removeAllergy(index)}
                          style={styles.badgeRemove}
                        >
                          <X size={14} color={colors.brandDark} />
                        </NeumorphicButton>
                      </View>
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
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  sectionHeading: {
    marginBottom: spacing.sm,
  },
  options: {
    gap: spacing.sm,
  },
  inlineForm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
  },
  inlineButton: {
    minHeight: 48,
    paddingHorizontal: 18,
  },
  badgeWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeAlert: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: colors.brand,
  },
  badgeText: {
    fontSize: 14,
    color: colors.text,
  },
  badgeAlertText: {
    color: colors.brandDark,
  },
  badgeRemove: {
    minHeight: 32,
    paddingHorizontal: 8,
  },
  allergyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
});
