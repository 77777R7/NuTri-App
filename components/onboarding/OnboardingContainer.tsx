import { useNavigation, type NavigationProp } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StepSlide } from '@/components/animation/StepSlide';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { safeBack } from '@/lib/navigation/safeBack';
import { colors, shadow } from '@/lib/theme';
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
  fallbackHref = '/onboarding/welcome',
}: OnboardingContainerProps) => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<ReactNavigation.RootParamList>>();
  const { setDirection, consumeDirection } = useTransitionDir();

  const enterDir = useMemo(() => {
    const direction = consumeDirection();
    if (direction !== 'none') {
      return direction;
    }
    return step > 1 ? 'forward' : 'none';
  }, [consumeDirection, step]);

  const handleNext = useCallback(async () => {
    if (disableNext) return;
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    setDirection('forward');
    onNext?.();
  }, [disableNext, onNext, setDirection]);

  const handleBack = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    setDirection('back');
    if (onBack) {
      onBack();
      return;
    }

    safeBack(navigation, { fallback: fallbackHref });
  }, [fallbackHref, navigation, onBack, setDirection]);

  const handleSkip = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    setDirection('forward');
    onSkip?.();
  }, [onSkip, setDirection]);

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

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <StepSlide
          direction={enterDir}
          slideOnFirst
          durationMs={360}
          mountKey={`${step}-${enterDir}`}
        >
          <View style={styles.content}>{children}</View>
        </StepSlide>
      </ScrollView>

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
  scrollView: {
    flex: 1,
    marginTop: 24,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    minHeight: '100%',
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
