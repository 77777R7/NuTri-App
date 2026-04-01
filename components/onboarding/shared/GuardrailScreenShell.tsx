import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StepSlide } from '@/components/animation/StepSlide';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { OnboardingTopChrome } from './OnboardingTopChrome';
import { onboardingPalette } from './theme';

type GuardrailScreenShellProps = {
  screenKey: string;
  topMode: 'brand' | 'back' | 'progress';
  questionIndex?: number;
  onBack?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export const GuardrailScreenShell = ({
  screenKey,
  topMode,
  questionIndex,
  onBack,
  children,
  footer,
}: GuardrailScreenShellProps) => {
  const insets = useSafeAreaInsets();
  const { consumeDirection } = useTransitionDir();
  const isWelcome = screenKey === 'welcome';

  const enterDir = useMemo(() => {
    const direction = consumeDirection();
    return direction === 'none' ? 'forward' : direction;
  }, [consumeDirection]);

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <View style={styles.bg} />
        <View style={isWelcome ? styles.mistOneWelcome : styles.mistOne} />
        {isWelcome ? null : <View style={styles.mistTwo} />}
      </View>
      <StepSlide direction={enterDir} mountKey={`${screenKey}-${enterDir}`} slideOnFirst>
        <View style={[styles.inner, { paddingTop: insets.top + 6, paddingBottom: Math.max(insets.bottom, 18) }]}> 
          <View style={styles.topArea}>
            {topMode === 'brand' ? <OnboardingTopChrome mode="brand" /> : null}
            {topMode === 'back' && onBack ? <OnboardingTopChrome mode="back" onBack={onBack} /> : null}
            {topMode === 'progress' && onBack ? (
              <OnboardingTopChrome mode="progress" onBack={onBack} questionIndex={questionIndex ?? 1} />
            ) : null}
          </View>
          <View style={[styles.content, isWelcome ? styles.contentWelcome : null]}>{children}</View>
          {footer ? <View style={[styles.footer, isWelcome ? styles.footerWelcome : null]}>{footer}</View> : null}
        </View>
      </StepSlide>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: onboardingPalette.background,
  },
  bg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: onboardingPalette.background,
  },
  mistOne: {
    position: 'absolute',
    top: 120,
    left: 30,
    right: 30,
    height: 220,
    borderRadius: 220,
    backgroundColor: 'rgba(79,125,255,0.06)',
    opacity: 0.35,
    transform: [{ scaleX: 1.2 }],
  },
  mistOneWelcome: {
    position: 'absolute',
    top: 108,
    left: 24,
    right: 24,
    height: 132,
    borderRadius: 132,
    backgroundColor: 'rgba(95,131,245,0.018)',
    opacity: 0.12,
    transform: [{ scaleX: 1.02 }],
  },
  mistTwo: {
    position: 'absolute',
    bottom: 180,
    left: 80,
    right: 80,
    height: 260,
    borderRadius: 260,
    backgroundColor: 'rgba(255,255,255,0.55)',
    opacity: 0.6,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
  },
  topArea: {
    height: 40,
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  contentWelcome: {
    paddingTop: 8,
  },
  footer: {
    paddingTop: 12,
  },
  footerWelcome: {
    paddingTop: 0,
  },
});

export default GuardrailScreenShell;
