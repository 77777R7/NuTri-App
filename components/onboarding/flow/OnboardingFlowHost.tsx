import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding-v2';
import {
  ONBOARDING_FLOW_PROGRESS,
  ONBOARDING_FLOW_STEPS,
  renderOnboardingScene,
  resolveInitialOnboardingFlowStep,
  type OnboardingFlowStep,
} from './OnboardingSceneRegistry';
import {
  FLOW_EASING,
  FLOW_TRANSITION_DURATION_MS,
} from './onboardingMotion';
import { OnboardingChrome } from './OnboardingChrome';
import { OnboardingFooter } from './OnboardingFooter';
import {
  OnboardingSceneViewport,
  type OnboardingFlowDirection,
} from './OnboardingSceneViewport';
import { OnboardingShellBackground } from './OnboardingShellBackground';
import {
  getSharedShellProgressFillWidth,
  isSharedShellStep,
  ONBOARDING_SHARED_SHELL_HEADER_HEIGHT,
  ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
  ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE_WITH_HELPER,
  ONBOARDING_SHARED_SHELL_TOP_OFFSET,
  type OnboardingSharedShellConfig,
} from './onboardingShell';

type OnboardingFlowHostProps = {
  initialStep?: string;
};

const QA_CHROME_MASK = [
  'rgba(243,245,251,0.98)',
  'rgba(243,245,251,0.98)',
  'rgba(243,245,251,0)',
] as const;

const SUMMARY_CHROME_MASK = [
  'rgba(246,247,249,0.98)',
  'rgba(246,247,249,0.98)',
  'rgba(246,247,249,0)',
] as const;

const getPreviousStep = (step: OnboardingFlowStep) => {
  const currentIndex = ONBOARDING_FLOW_STEPS.indexOf(step);
  if (currentIndex <= 0) {
    return null;
  }
  return ONBOARDING_FLOW_STEPS[currentIndex - 1] ?? null;
};

const buildFallbackShellConfig = ({
  step,
  goToStep,
}: {
  step: OnboardingFlowStep;
  goToStep: (step: OnboardingFlowStep, direction: OnboardingFlowDirection) => void;
}): OnboardingSharedShellConfig | null => {
  switch (step) {
    case 'age-range':
      return {
        backgroundVariant: 'qa',
        progressFillWidth: getSharedShellProgressFillWidth('age-range'),
        onBack: () => goToStep('data-trust', 'back'),
        onContinue: async () => {},
        onSkip: async () => {},
        continueLabel: 'Continue',
        continueDisabled: true,
        footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
      };
    case 'sex':
      return {
        backgroundVariant: 'qa',
        progressFillWidth: getSharedShellProgressFillWidth('sex'),
        onBack: () => goToStep('age-range', 'back'),
        onContinue: async () => {},
        onSkip: async () => {},
        continueLabel: 'Continue',
        continueDisabled: true,
        footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
      };
    case 'experience':
      return {
        backgroundVariant: 'qa',
        progressFillWidth: getSharedShellProgressFillWidth('experience'),
        onBack: () => goToStep('sex', 'back'),
        onContinue: async () => {},
        onSkip: async () => {},
        continueLabel: 'Continue',
        continueDisabled: true,
        footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
      };
    case 'goals':
      return {
        backgroundVariant: 'qa',
        progressFillWidth: getSharedShellProgressFillWidth('goals'),
        onBack: () => goToStep('experience', 'back'),
        onContinue: async () => {},
        onSkip: async () => {},
        continueLabel: 'Continue',
        continueDisabled: true,
        footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE_WITH_HELPER,
      };
    case 'types':
      return {
        backgroundVariant: 'qa',
        progressFillWidth: getSharedShellProgressFillWidth('types'),
        onBack: () => goToStep('goals', 'back'),
        onContinue: async () => {},
        onSkip: async () => {},
        continueLabel: 'Continue',
        continueDisabled: true,
        footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
      };
    case 'allergy':
      return {
        backgroundVariant: 'qa',
        progressFillWidth: getSharedShellProgressFillWidth('allergy'),
        onBack: () => goToStep('types', 'back'),
        onContinue: async () => {},
        onSkip: async () => {},
        continueLabel: 'Continue',
        continueDisabled: true,
        footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
      };
    case 'blocker':
      return {
        backgroundVariant: 'qa',
        progressFillWidth: getSharedShellProgressFillWidth('blocker'),
        onBack: () => goToStep('allergy', 'back'),
        onContinue: async () => {},
        onSkip: async () => {},
        continueLabel: 'Continue',
        continueDisabled: true,
        footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
      };
    case 'setup':
      return {
        backgroundVariant: 'qa',
        progressFillWidth: getSharedShellProgressFillWidth('setup'),
        onBack: () => goToStep('blocker', 'back'),
        onContinue: async () => {},
        onSkip: async () => {},
        continueLabel: 'Preview my plan',
        continueDisabled: true,
        footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
      };
    case 'plan-preview':
      return {
        backgroundVariant: 'summary',
        progressFillWidth: getSharedShellProgressFillWidth('plan-preview'),
        onBack: () => goToStep('setup', 'back'),
        onContinue: async () => {},
        continueLabel: 'Unlock My Plan',
        continueDisabled: true,
        footerReserveHeight: 120,
      };
    case 'first-stack':
      return {
        backgroundVariant: 'qa',
        progressFillWidth: getSharedShellProgressFillWidth('first-stack'),
        onBack: () => goToStep('plan-preview', 'back'),
        onContinue: async () => {},
        continueLabel: 'Finish setup',
        continueDisabled: true,
        footerReserveHeight: 120,
      };
    default:
      return null;
  }
};

export function OnboardingFlowHost({
  initialStep,
}: OnboardingFlowHostProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { loading, onbCompleted, progress, commitProgress, flushDraft } = useOnboarding();
  const { setDirection } = useTransitionDir();

  const resolvedInitialStep = useMemo(
    () =>
      resolveInitialOnboardingFlowStep({
        requestedStep: initialStep,
        progress,
      }),
    [initialStep, progress],
  );

  const [activeStep, setActiveStep] =
    useState<OnboardingFlowStep>(resolvedInitialStep);
  const [leavingStep, setLeavingStep] = useState<OnboardingFlowStep | null>(null);
  const [direction, setFlowDirection] =
    useState<OnboardingFlowDirection>('none');
  const [sharedShellConfig, setSharedShellConfig] =
    useState<OnboardingSharedShellConfig | null>(null);

  const transitionProgress = useSharedValue(1);
  const transitionTokenRef = useRef(0);
  const isTransitioningRef = useRef(false);

  useEffect(() => {
    if (!initialStep) return;
    if (activeStep === resolvedInitialStep || isTransitioningRef.current) return;
    setLeavingStep(null);
    setFlowDirection('none');
    transitionProgress.value = 1;
    setActiveStep(resolvedInitialStep);
  }, [activeStep, initialStep, resolvedInitialStep, transitionProgress]);

  useEffect(() => {
    if (!isSharedShellStep(activeStep)) {
      setSharedShellConfig(null);
    }
  }, [activeStep]);

  useEffect(() => {
    if (loading) return;

    if (!initialStep && !onbCompleted && progress >= ONBOARDING_TOTAL_STEPS) {
      setDirection('forward');
      router.replace('/onboarding/done');
    }
  }, [initialStep, loading, onbCompleted, progress, router, setDirection]);

  useEffect(() => {
    if (loading) return;

    const nextProgress = ONBOARDING_FLOW_PROGRESS[activeStep];
    if (progress < nextProgress) {
      commitProgress(nextProgress);
      void flushDraft();
    }
  }, [activeStep, commitProgress, flushDraft, loading, progress]);

  const finishTransition = useCallback((token: number) => {
    if (token !== transitionTokenRef.current) return;
    isTransitioningRef.current = false;
    setLeavingStep(null);
    setFlowDirection('none');
  }, []);

  const goToStep = useCallback(
    (nextStep: OnboardingFlowStep, nextDirection: OnboardingFlowDirection) => {
      if (nextStep === activeStep || isTransitioningRef.current) return;

      isTransitioningRef.current = true;
      transitionTokenRef.current += 1;
      const token = transitionTokenRef.current;

      setFlowDirection(nextDirection);
      setLeavingStep(activeStep);
      setActiveStep(nextStep);
      transitionProgress.value = 0;
      transitionProgress.value = withTiming(
        1,
        {
          duration: FLOW_TRANSITION_DURATION_MS,
          easing: FLOW_EASING,
        },
        (finished) => {
          if (finished) {
            runOnJS(finishTransition)(token);
          }
        },
      );
    },
    [activeStep, finishTransition, transitionProgress],
  );

  const exitTo = useCallback(
    (href: string, nextDirection: OnboardingFlowDirection = 'forward') => {
      setDirection(nextDirection === 'none' ? 'forward' : nextDirection);
      router.replace(href);
    },
    [router, setDirection],
  );

  const fallbackShellConfig = useMemo(
    () =>
      isSharedShellStep(activeStep)
        ? buildFallbackShellConfig({ step: activeStep, goToStep })
        : null,
    [activeStep, goToStep],
  );

  const effectiveShellConfig = sharedShellConfig ?? fallbackShellConfig;

  useFocusEffect(
    useCallback(() => {
      const onHardwareBackPress = () => {
        if (isTransitioningRef.current) {
          return true;
        }

        const previousStep = getPreviousStep(activeStep);
        if (!previousStep) {
          return true;
        }

        goToStep(previousStep, 'back');
        return true;
      };

      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        onHardwareBackPress,
      );
      return () => subscription.remove();
    }, [activeStep, goToStep]),
  );

  if (loading) {
    return null;
  }

  const showSharedShell = Boolean(effectiveShellConfig && isSharedShellStep(activeStep));
  const sharedShellFooterInset = Math.max(insets.bottom - 6, 14);
  const stagePaddingTop = showSharedShell
    ? insets.top + ONBOARDING_SHARED_SHELL_TOP_OFFSET + ONBOARDING_SHARED_SHELL_HEADER_HEIGHT
    : 0;
  const stagePaddingBottom = showSharedShell
    ? (effectiveShellConfig?.footerReserveHeight ?? ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE) +
      sharedShellFooterInset
    : 0;

  return (
    <View style={styles.root}>
      {showSharedShell && effectiveShellConfig ? (
        <OnboardingShellBackground variant={effectiveShellConfig.backgroundVariant} />
      ) : null}

      {showSharedShell && effectiveShellConfig ? (
        <LinearGradient
          pointerEvents="none"
          colors={
            effectiveShellConfig.backgroundVariant === 'summary'
              ? SUMMARY_CHROME_MASK
              : QA_CHROME_MASK
          }
          locations={[0, 0.74, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={[styles.chromeOccluder, { height: stagePaddingTop + 14 }]}
        />
      ) : null}

      <View
        style={[
          styles.sceneStage,
          {
            paddingTop: stagePaddingTop,
            paddingBottom: stagePaddingBottom,
          },
        ]}
      >
        <OnboardingSceneViewport
          activeStep={activeStep}
          leavingStep={leavingStep}
          direction={direction}
          progress={transitionProgress}
          renderScene={(step, sceneActive) =>
            renderOnboardingScene(step, {
              sceneActive,
              direction,
              goToStep,
              exitTo,
              setSharedShellConfig,
            })
          }
        />
      </View>

      {showSharedShell && effectiveShellConfig ? (
        <>
          <OnboardingChrome
            chromeIdentity={activeStep}
            progressFillWidth={effectiveShellConfig.progressFillWidth}
            handoffDirection={direction}
            onBack={effectiveShellConfig.onBack}
          />
          <OnboardingFooter
            footerIdentity={activeStep}
            continueLabel={effectiveShellConfig.continueLabel}
            onContinue={effectiveShellConfig.onContinue}
            continueDisabled={effectiveShellConfig.continueDisabled}
            onSkip={effectiveShellConfig.onSkip}
            footerHint={effectiveShellConfig.footerHint}
            footerError={effectiveShellConfig.footerError}
          />
        </>
      ) : null}
    </View>
  );
}

export default OnboardingFlowHost;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  chromeOccluder: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 14,
  },
  sceneStage: {
    flex: 1,
  },
});
