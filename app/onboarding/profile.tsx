import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View as RNView,
} from 'react-native';
import type { NavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppHeader from '@/components/common/AppHeader';
import { BrandGradient } from '@/components/BrandGradient';
import { ProgressBar } from '@/components/onboarding/ProgressBar';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Buttons';
import { StepSlide } from '@/components/animation/StepSlide';
import { StaggerText } from '@/components/animation/StaggerText';
import { Pressable, Text, View } from '@/components/ui/nativewind-primitives';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { colors, radii, spacing, type } from '@/lib/theme';
import { safeBack } from '@/lib/navigation/safeBack';

type Unit = 'metric' | 'imperial';
type GenderOption = 'Male' | 'Female' | 'Other' | 'Prefer not to say';

const MIN_HEIGHT_CM = 120;
const MAX_HEIGHT_CM = 240;
const MIN_WEIGHT_KG = 30;
const MAX_WEIGHT_KG = 200;
const MIN_AGE = 13;
const MAX_AGE = 100;

const CM_PER_INCH = 2.54;
const LB_PER_KG = 2.20462262;

const formatNumeric = (value: number, decimals = 1) => {
  const fixed = value.toFixed(decimals);
  return fixed.replace(/(\.\d*?[1-9])0+$/g, '$1').replace(/\.0+$/, '');
};

const sanitizeDecimal = (value: string) => value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
const sanitizeInteger = (value: string) => value.replace(/[^0-9]/g, '');

const toCm = (value: number, unit: Unit) => (unit === 'metric' ? value : value * CM_PER_INCH);
const toKg = (value: number, unit: Unit) => (unit === 'metric' ? value : value / LB_PER_KG);
const fromCm = (value: number, unit: Unit) => (unit === 'metric' ? value : value / CM_PER_INCH);
const fromKg = (value: number, unit: Unit) => (unit === 'metric' ? value : value * LB_PER_KG);

const GENDER_OPTIONS: GenderOption[] = ['Male', 'Female', 'Other', 'Prefer not to say'];

let BlurViewComponent: typeof import('expo-blur').BlurView | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BlurViewComponent = require('expo-blur').BlurView;
} catch {
  BlurViewComponent = null;
}

const UNIT_ERROR = {
  metric: {
    height: `Valid range: ${MIN_HEIGHT_CM}–${MAX_HEIGHT_CM} cm.`,
    weight: `Valid range: ${MIN_WEIGHT_KG}–${MAX_WEIGHT_KG} kg.`,
  },
  imperial: {
    height: 'Valid range: 47–94 in.',
    weight: 'Valid range: 66–440 lb.',
  },
};

export default function ProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation<NavigationProp<ReactNavigation.RootParamList>>();
  const insets = useSafeAreaInsets();
  const { draft, loading, saveDraft } = useOnboarding();
  const { setDirection, consumeDirection } = useTransitionDir();

  const enterDir = useMemo(() => {
    const direction = consumeDirection();
    return direction !== 'none' ? direction : 'forward';
  }, [consumeDirection]);

  const [unit, setUnit] = useState<Unit>('metric');
  const [heightInput, setHeightInput] = useState('');
  const [weightInput, setWeightInput] = useState('');
  const [ageInput, setAgeInput] = useState('');
  const [gender, setGender] = useState<GenderOption | null>(null);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const heightRef = useRef<TextInput>(null);
  const weightRef = useRef<TextInput>(null);
  const ageRef = useRef<TextInput>(null);

  useEffect(() => {
    if (loading) return;

    if (typeof draft?.height === 'number') {
      setHeightInput(formatNumeric(draft.height));
    } else {
      setHeightInput('');
    }

    if (typeof draft?.weight === 'number') {
      setWeightInput(formatNumeric(draft.weight));
    } else {
      setWeightInput('');
    }

    if (typeof draft?.age === 'number') {
      setAgeInput(String(draft.age));
    } else {
      setAgeInput('');
    }

    if (draft?.gender && GENDER_OPTIONS.includes(draft.gender as GenderOption)) {
      setGender(draft.gender as GenderOption);
    } else {
      setGender(null);
    }
  }, [draft?.age, draft?.gender, draft?.height, draft?.weight, loading]);

  const handleUnitChange = useCallback(
    async (next: Unit) => {
      if (next === unit) return;

      try {
        await Haptics.selectionAsync();
      } catch {
        // noop
      }

      const currentHeight = Number.parseFloat(heightInput);
      const currentWeight = Number.parseFloat(weightInput);

      const heightCm = Number.isFinite(currentHeight) ? toCm(currentHeight, unit) : undefined;
      const weightKg = Number.isFinite(currentWeight) ? toKg(currentWeight, unit) : undefined;

      if (heightCm !== undefined) {
        setHeightInput(formatNumeric(fromCm(heightCm, next)));
      } else {
        setHeightInput('');
      }

      if (weightKg !== undefined) {
        setWeightInput(formatNumeric(fromKg(weightKg, next)));
      } else {
        setWeightInput('');
      }

      setUnit(next);
    },
    [heightInput, unit, weightInput],
  );

  const unitSwitch = useMemo(() => ({ unit, onChange: handleUnitChange }), [handleUnitChange, unit]);

  const heightNumeric = Number.parseFloat(heightInput);
  const weightNumeric = Number.parseFloat(weightInput);
  const ageNumeric = Number.parseInt(ageInput, 10);

  const heightCm = Number.isFinite(heightNumeric) ? toCm(heightNumeric, unit) : undefined;
  const weightKg = Number.isFinite(weightNumeric) ? toKg(weightNumeric, unit) : undefined;
  const ageNumber = Number.isFinite(ageNumeric) ? ageNumeric : undefined;

  const heightError = !heightInput
    ? 'Enter your height.'
    : !Number.isFinite(heightNumeric)
      ? 'Enter a valid height.'
      : heightCm !== undefined && (heightCm < MIN_HEIGHT_CM || heightCm > MAX_HEIGHT_CM)
        ? UNIT_ERROR[unit].height
        : null;

  const weightError = !weightInput
    ? 'Enter your weight.'
    : !Number.isFinite(weightNumeric)
      ? 'Enter a valid weight.'
      : weightKg !== undefined && (weightKg < MIN_WEIGHT_KG || weightKg > MAX_WEIGHT_KG)
        ? UNIT_ERROR[unit].weight
        : null;

  const ageError = !ageInput
    ? 'Enter your age.'
    : ageNumber === undefined
      ? 'Enter a valid age.'
      : ageNumber < MIN_AGE || ageNumber > MAX_AGE
        ? `Age must be between ${MIN_AGE} and ${MAX_AGE}.`
        : null;

  const genderError = gender ? null : 'Select a gender option.';

  const showHeightError = Boolean(heightError && (attemptedSubmit || heightInput.length > 0));
  const showWeightError = Boolean(weightError && (attemptedSubmit || weightInput.length > 0));
  const showAgeError = Boolean(ageError && (attemptedSubmit || ageInput.length > 0));
  const showGenderError = Boolean(genderError && attemptedSubmit);

  const isValid = !heightError && !weightError && !ageError && !genderError;

  const handleBack = useCallback(async () => {
    setDirection('back');
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    safeBack(navigation, { fallback: '/onboarding/welcome' });
  }, [navigation, setDirection]);

  const handleNext = useCallback(async () => {
    Keyboard.dismiss();
    if (!isValid) {
      setAttemptedSubmit(true);
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch {
        // noop
      }
      return;
    }

    if (!heightCm || !weightKg || !ageNumber || !gender) {
      return;
    }

    setIsSaving(true);
    setDirection('forward');

    try {
      await saveDraft(
        {
          height: Number.parseFloat(heightCm.toFixed(1)),
          weight: Number.parseFloat(weightKg.toFixed(1)),
          age: ageNumber,
          gender,
        },
        3,
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push('/onboarding/diet');
    } catch (error) {
      console.error('Failed to persist profile step', error);
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch {
        // noop
      }
    } finally {
      setIsSaving(false);
    }
  }, [ageNumber, gender, heightCm, isValid, router, saveDraft, setDirection, weightKg]);

  const contentInsetBottom = insets.bottom > spacing.md ? insets.bottom : spacing.lg;

  return (
    <BrandGradient>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
      >
        <StepSlide direction={enterDir} mountKey={`profile-${enterDir}`}>
          <View style={styles.root}>
            <AppHeader showBack title="Step 2 of 7" onBackPress={handleBack} fallbackHref="/onboarding/welcome" />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[styles.scrollContent, { paddingBottom: contentInsetBottom + 160 }]}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.progressWrapper}>
                <ProgressBar step={2} total={7} />
              </View>

              <View style={styles.copyBlock}>
                <StaggerText.H1
                  text="Tell us about you"
                  style={[type.h1 as any, { color: colors.text }]}
                  delay={80}
                  wordDelay={60}
                />
                <View style={{ marginTop: spacing.xs }}>
                  <StaggerText.P
                    text="We’ll use this information to personalize your plan."
                    style={[type.p as any, { color: colors.subtext }]}
                    delay={220}
                    wordDelay={40}
                  />
                </View>
              </View>

              <View style={styles.unitRow}>
                <Text style={styles.label}>Units</Text>
                <SegmentedUnitControl {...unitSwitch} />
              </View>

              <Field
                ref={heightRef}
                label="Height"
                placeholder="--"
                keyboardType="decimal-pad"
                value={heightInput}
                onChangeText={value => setHeightInput(sanitizeDecimal(value))}
                onSubmitEditing={() => weightRef.current?.focus()}
                suffix={unit === 'metric' ? 'cm' : 'in'}
                error={showHeightError ? heightError : null}
              />

              <Field
                ref={weightRef}
                label="Weight"
                placeholder="--"
                keyboardType="decimal-pad"
                value={weightInput}
                onChangeText={value => setWeightInput(sanitizeDecimal(value))}
                onSubmitEditing={() => ageRef.current?.focus()}
                suffix={unit === 'metric' ? 'kg' : 'lb'}
                error={showWeightError ? weightError : null}
              />

              <Field
                ref={ageRef}
                label="Age"
                placeholder="--"
                keyboardType="number-pad"
                value={ageInput}
                onChangeText={value => setAgeInput(sanitizeInteger(value))}
                onSubmitEditing={Keyboard.dismiss}
                returnKeyType="done"
                error={showAgeError ? ageError : null}
              />

              <Text style={styles.helper}>You must be at least 13 years old.</Text>

              <View style={styles.genderBlock}>
                <Text style={styles.label}>Gender</Text>
                <View style={styles.genderChips}>
                  {GENDER_OPTIONS.map(option => {
                    const selected = gender === option;
                    return (
                      <Pressable
                        key={option}
                        onPress={() => setGender(option)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={option}
                        style={({ pressed }: { pressed: boolean }) => [
                          styles.genderChip,
                          selected && styles.genderChipSelected,
                          pressed && styles.genderChipPressed,
                        ]}
                      >
                        <Text style={[styles.genderChipText, selected && styles.genderChipTextSelected]}>{option}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {showGenderError ? <Text style={styles.errorText}>{genderError}</Text> : null}
              </View>
            </ScrollView>

            <RNView pointerEvents="box-none" style={styles.ctaHost}>
              <CTAWrapper bottomOffset={contentInsetBottom + spacing.sm}>
                <SecondaryButton
                  title="Back"
                  onPress={handleBack}
                  style={styles.backButton}
                />
                <PrimaryButton
                  title={isSaving ? 'Saving…' : 'Next'}
                  onPress={handleNext}
                  disabled={!isValid || isSaving}
                  style={styles.nextButton}
                  testID="profile-next"
                />
              </CTAWrapper>
            </RNView>
          </View>
        </StepSlide>
      </KeyboardAvoidingView>
    </BrandGradient>
  );
}

type SegmentedUnitControlProps = {
  unit: Unit;
  onChange: (unit: Unit) => void;
};

const SegmentedUnitControl = ({ unit, onChange }: SegmentedUnitControlProps) => {
  const [width, setWidth] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(unit === 'metric' ? 0 : 1)).current;

  useEffect(() => {
    let isMounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then(value => {
      if (isMounted) {
        setReduceMotion(Boolean(value));
      }
    });

    const listener = AccessibilityInfo.addEventListener?.('reduceMotionChanged', value => {
      setReduceMotion(Boolean(value));
    });

    return () => {
      isMounted = false;
      listener?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(unit === 'metric' ? 0 : 1);
      return;
    }

    Animated.timing(progress, {
      toValue: unit === 'metric' ? 0 : 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, reduceMotion, unit]);

  const thumbWidth = width / 2;

  const animatedStyle = {
    transform: [
      {
        translateX: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, thumbWidth || 0],
        }),
      },
    ],
  };

  return (
    <View
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      style={styles.segmented}
      accessibilityRole="tablist"
      accessibilityLabel="Measurement units"
    >
      {thumbWidth ? <Animated.View style={[styles.segmentedThumb, { width: thumbWidth }, animatedStyle]} /> : null}
      <Pressable
        onPress={() => onChange('metric')}
        accessibilityRole="tab"
        accessibilityState={{ selected: unit === 'metric' }}
        style={styles.segmentedButton}
      >
        <Text style={[styles.segmentedText, unit === 'metric' && styles.segmentedTextActive]}>Metric</Text>
      </Pressable>
      <Pressable
        onPress={() => onChange('imperial')}
        accessibilityRole="tab"
        accessibilityState={{ selected: unit === 'imperial' }}
        style={styles.segmentedButton}
      >
        <Text style={[styles.segmentedText, unit === 'imperial' && styles.segmentedTextActive]}>Imperial</Text>
      </Pressable>
    </View>
  );
};

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType: 'decimal-pad' | 'number-pad';
  placeholder: string;
  onSubmitEditing: () => void;
  suffix?: string;
  error: string | null;
  returnKeyType?: 'next' | 'done';
};

const Field = React.forwardRef<TextInput, FieldProps>(
  ({ label, value, onChangeText, keyboardType, onSubmitEditing, placeholder, suffix, error, returnKeyType = 'next' }, ref) => {
    return (
      <View style={styles.field}>
        <View style={styles.fieldHeader}>
          <Text style={styles.label}>{label}</Text>
        </View>
        <View style={[styles.inputRow, error && styles.inputRowError]}>
          <TextInput
            ref={ref}
            value={value}
            onChangeText={onChangeText}
            keyboardType={keyboardType}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            placeholder={placeholder}
            placeholderTextColor="rgba(15,23,42,0.32)"
            style={styles.input}
            inputMode={keyboardType === 'number-pad' ? 'numeric' : 'decimal'}
          />
          {suffix ? <Text style={styles.inputSuffix}>{suffix}</Text> : null}
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    );
  },
);

Field.displayName = 'Field';

type CTAWrapperProps = {
  children: React.ReactNode;
  bottomOffset: number;
};

const CTAWrapper = ({ children, bottomOffset }: CTAWrapperProps) => {
  const containerStyle = [styles.ctaContainer, { bottom: bottomOffset }];

  if (BlurViewComponent) {
    return (
      <View style={containerStyle}>
        <BlurViewComponent intensity={28} tint="light" style={StyleSheet.absoluteFillObject} />
        <View style={styles.ctaContent}>{children}</View>
      </View>
    );
  }

  return (
    <View style={[styles.ctaContainer, { bottom: bottomOffset }, styles.ctaFallbackBackground]}>
      <View style={styles.ctaContent}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
  },
  progressWrapper: {
    marginTop: spacing.lg,
  },
  copyBlock: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  unitRow: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  segmented: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16,185,129,0.10)',
    padding: 4,
    borderRadius: 999,
    minWidth: 156,
  },
  segmentedThumb: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: 999,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  segmentedButton: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  segmentedText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.subtext,
  },
  segmentedTextActive: {
    color: colors.text,
  },
  field: {
    marginTop: spacing.xl,
  },
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.12)',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    height: 60,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  inputRowError: {
    borderColor: '#F97373',
  },
  input: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  inputSuffix: {
    marginLeft: spacing.sm,
    width: 40,
    textAlign: 'right',
    fontSize: 15,
    fontWeight: '700',
    color: colors.subtext,
  },
  helper: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.subtext,
  },
  errorText: {
    marginTop: 8,
    fontSize: 13,
    color: '#EF4444',
  },
  genderBlock: {
    marginTop: spacing.xl,
  },
  genderChips: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  genderChip: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  genderChipSelected: {
    borderColor: colors.brand,
    backgroundColor: 'rgba(16,185,129,0.12)',
  },
  genderChipPressed: {
    opacity: 0.85,
  },
  genderChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.subtext,
  },
  genderChipTextSelected: {
    color: colors.brandDark,
  },
  ctaHost: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  ctaContainer: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    borderRadius: radii.xl,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    backgroundColor: 'transparent',
  },
  ctaContent: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  ctaFallbackBackground: {
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  backButton: {
    flex: 1,
    height: 56,
    marginRight: spacing.sm,
  },
  nextButton: {
    flex: 1,
    height: 56,
    marginLeft: spacing.sm,
  },
});
