import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import AppHeader from '@/components/common/AppHeader';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useQA } from '@/contexts/QAContext';
import { colors, radii, spacing } from '@/lib/theme';

export default function PhysicalStatsScreen() {
  const router = useRouter();
  const { data, updateData, setStep } = useQA();
  
  const [weight, setWeight] = useState(data.weight?.toString() || '');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lbs'>(data.weightUnit);
  const [height, setHeight] = useState(data.height?.toString() || '');
  const [heightUnit, setHeightUnit] = useState<'cm' | 'ft'>(data.heightUnit);

  const handleContinue = useCallback(async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      updateData({
        weight: weight ? parseFloat(weight) : undefined,
        weightUnit,
        height: height ? parseFloat(height) : undefined,
        heightUnit,
      });
      setStep(4);
      router.push('/qa/health-goals');
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error('Failed to save physical stats', error);
    }
  }, [weight, weightUnit, height, heightUnit, router, updateData, setStep]);

  const handleSkip = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
      updateData({
        weight: undefined,
        weightUnit,
        height: undefined,
        heightUnit,
      });
      setStep(4);
      router.push('/qa/health-goals');
    } catch (error) {
      console.error('Failed to skip physical stats', error);
    }
  }, [weightUnit, heightUnit, router, updateData, setStep]);

  const toggleWeightUnit = useCallback(() => {
    const newUnit = weightUnit === 'kg' ? 'lbs' : 'kg';
    setWeightUnit(newUnit);
    
    // Convert existing value
    if (weight) {
      const num = parseFloat(weight);
      if (!isNaN(num)) {
        const converted = newUnit === 'lbs' ? num * 2.20462 : num / 2.20462;
        setWeight(converted.toFixed(1));
      }
    }
    Haptics.selectionAsync().catch(() => {});
  }, [weightUnit, weight]);

  const toggleHeightUnit = useCallback(() => {
    const newUnit = heightUnit === 'cm' ? 'ft' : 'cm';
    setHeightUnit(newUnit);
    
    // Convert existing value
    if (height) {
      const num = parseFloat(height);
      if (!isNaN(num)) {
        const converted = newUnit === 'ft' ? num / 30.48 : num * 30.48;
        setWeight(converted.toFixed(1));
      }
    }
    Haptics.selectionAsync().catch(() => {});
  }, [heightUnit, height]);

  return (
    <>
      <AppHeader title="Step 3 of 7" showBack />
      <OnboardingContainer
        step={3}
        totalSteps={7}
        title="Physical measurements"
        subtitle="Optional - helps calculate optimal dosages"
        fallbackHref="/qa/demographics"
        onNext={handleContinue}
        disableNext={false}
        nextLabel="Continue →"
        showSkip
        onSkip={handleSkip}
      >
        <View style={styles.content}>
          {/* Weight Input */}
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Weight (optional)</Text>
              <UnitToggle
                value={weightUnit}
                options={['kg', 'lbs']}
                onChange={toggleWeightUnit}
              />
            </View>
            <View style={styles.inputContainer}>
              <TextInput
                value={weight}
                onChangeText={setWeight}
                placeholder={`Enter weight in ${weightUnit}`}
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={styles.input}
              />
              <Text style={styles.unit}>{weightUnit}</Text>
            </View>
          </View>

          {/* Height Input */}
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Height (optional)</Text>
              <UnitToggle
                value={heightUnit}
                options={['cm', 'ft']}
                onChange={toggleHeightUnit}
              />
            </View>
            <View style={styles.inputContainer}>
              <TextInput
                value={height}
                onChangeText={setHeight}
                placeholder={`Enter height in ${heightUnit}`}
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={styles.input}
              />
              <Text style={styles.unit}>{heightUnit}</Text>
            </View>
          </View>

          {/* Info Box */}
          <View style={styles.infoBox}>
            <Text style={styles.infoIcon}>💡</Text>
            <Text style={styles.infoText}>
              Physical stats help us recommend more accurate dosages based on your body composition.
              You can skip this step if you prefer.
            </Text>
          </View>
        </View>
      </OnboardingContainer>
    </>
  );
}

// Unit Toggle Component
interface UnitToggleProps {
  value: string;
  options: string[];
  onChange: () => void;
}

function UnitToggle({ value, options, onChange }: UnitToggleProps) {
  return (
    <Pressable onPress={onChange} style={styles.toggle}>
      {options.map((option, index) => (
        <View
          key={option}
          style={[
            styles.toggleOption,
            value === option && styles.toggleOptionActive,
            index === 0 && styles.toggleOptionFirst,
            index === options.length - 1 && styles.toggleOptionLast,
          ]}
        >
          <Text
            style={[
              styles.toggleText,
              value === option && styles.toggleTextActive,
            ]}
          >
            {option}
          </Text>
        </View>
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: spacing.xl,
  },
  field: {
    gap: spacing.sm,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    height: 60,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  input: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  unit: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textMuted,
    marginLeft: spacing.sm,
    minWidth: 40,
    textAlign: 'right',
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(16,185,129,0.10)',
    borderRadius: 999,
    padding: 2,
  },
  toggleOption: {
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  toggleOptionActive: {
    backgroundColor: colors.surface,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  toggleOptionFirst: {},
  toggleOptionLast: {},
  toggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  toggleTextActive: {
    color: colors.text,
    fontWeight: '700',
  },
  infoBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surfaceSoft,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.15)',
  },
  infoIcon: {
    fontSize: 16,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
});

