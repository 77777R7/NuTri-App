import React, { type ReactNode } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, shadow } from '@/lib/theme';
import { safeBack } from '@/lib/navigation/safeBack';
import type { Href } from 'expo-router';

import { ProgressBar } from './ProgressBar';

type OnboardingContainerProps = {
  step: number;
  totalSteps?: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  nextLabel?: string;
  backLabel?: string;
  skipLabel?: string;
  onNext?: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  disableNext?: boolean;
  showBack?: boolean;
  showSkip?: boolean;
  fallbackHref?: Href;
};

export const OnboardingContainer = ({
  step,
  totalSteps = 7,
  title,
  subtitle,
  children,
  nextLabel = 'Next',
  backLabel = 'Back',
  skipLabel = 'Skip',
  onNext,
  onBack,
  onSkip,
  disableNext,
  showBack = true,
  showSkip = false,
  fallbackHref,
}: OnboardingContainerProps) => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<ReactNavigation.RootParamList>>();

  const handleNext = async () => {
    if (disableNext) return;
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    onNext?.();
  };

  const handleBack = async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    if (onBack) {
      onBack();
      return;
    }

    safeBack(navigation, { fallback: fallbackHref ?? '/onboarding/welcome' });
  };

  const handleSkip = async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    onSkip?.();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
      <View style={styles.header}>
        <ProgressBar step={step} total={totalSteps} />
        <Text style={styles.stepLabel}>
          Step {Math.min(step, totalSteps)} of {totalSteps}
        </Text>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      <View style={styles.content}>{children}</View>

      <View style={styles.footer}>
        {showBack ? (
          <TouchableOpacity style={styles.secondaryButton} onPress={handleBack}>
            <Text style={styles.secondaryButtonText}>{backLabel}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.placeholder} />
        )}

        <View style={styles.footerRight}>
          {showSkip && onSkip ? (
            <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
              <Text style={styles.skipButtonText}>{skipLabel}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.primaryButton, disableNext && styles.primaryButtonDisabled]}
            onPress={handleNext}
            disabled={disableNext}
          >
            <Text style={styles.primaryButtonText}>{nextLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 24,
    backgroundColor: '#ffffff',
  },
  header: {
    gap: 12,
  },
  stepLabel: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '600',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textMuted,
    lineHeight: 22,
  },
  content: {
    flex: 1,
    marginTop: 24,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  placeholder: {
    width: 96,
  },
  secondaryButton: {
    minWidth: 96,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  skipButton: {
    padding: 8,
  },
  skipButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textMuted,
  },
  primaryButton: {
    minWidth: 140,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 999,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  primaryButtonDisabled: {
    backgroundColor: '#A7DED0',
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
});

export default OnboardingContainer;
