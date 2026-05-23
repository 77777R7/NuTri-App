import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated as RNAnimated,
  Easing as RNEasing,
  LayoutChangeEvent,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { QAMoreOptionsPill } from '@/components/onboarding/qa/QAMoreOptionsPill';
import { QAContentLayout } from '@/components/onboarding/qa/QAContentLayout';
import { QAOptionRow } from '@/components/onboarding/qa/QAOptionRow';
import { QA_EYEBROW } from '@/components/onboarding/qa/qaTokens';
import { WelcomeHeroCarousel } from '@/components/onboarding/welcome/WelcomeHeroCarousel';
import { WelcomeHeroGlow } from '@/components/onboarding/welcome/WelcomeHeroGlow';
import { WelcomePrimaryCTA } from '@/components/onboarding/welcome/WelcomePrimaryCTA';
import { openPrivacyPolicy } from '@/lib/legalLinks';
import {
  ACTIVE_BLUE,
  FOREGROUND,
  INACTIVE_DOT,
  MUTED,
  WELCOME_BG,
  WELCOME_BG_BOTTOM,
  WELCOME_BG_TOP,
} from '@/components/onboarding/welcome/welcomeTokens';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import {
  ADHERENCE_BLOCKER_OPTIONS,
  AGE_RANGE_OPTIONS,
  GOAL_OPTIONS,
  buildAvoidItemsFromStructuredPreferences,
  NO_KNOWN_ALLERGIES_LABEL,
  normalizeAvoidItemsSelection,
  PRIMARY_ALLERGY_UI_OPTIONS,
  RESTRICTION_UI_OPTIONS,
  SECONDARY_ALLERGY_UI_OPTIONS,
  SETUP_OPTIONS,
  SEX_OPTIONS,
  SUPPLEMENT_EXPERIENCE_OPTIONS,
  TYPE_OPTIONS,
  buildSmartFilterConfig,
} from '@/lib/onboarding-v2';

import type { OnboardingFlowDirection } from './OnboardingSceneViewport';
import {
  getSharedShellProgressFillWidth,
  type OnboardingSharedShellConfig,
  ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
  ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE_WITH_HELPER,
} from './onboardingShell';
import {
  FirstStackFlowScene,
  PlanPreviewFlowScene,
} from './SummaryFlowScenes';

const BLUR_PROPS =
  Platform.OS === 'android'
    ? ({ experimentalBlurMethod: 'dimezisBlurView' } as const)
    : ({} as const);

export const ONBOARDING_FLOW_STEPS = [
  'welcome',
  'data-trust',
  'age-range',
  'sex',
  'experience',
  'goals',
  'types',
  'allergy',
  'blocker',
  'setup',
  'plan-preview',
  'first-stack',
] as const;

export type OnboardingFlowStep = (typeof ONBOARDING_FLOW_STEPS)[number];

export const ONBOARDING_FLOW_PROGRESS: Record<OnboardingFlowStep, number> = {
  welcome: 1,
  'data-trust': 2,
  'age-range': 3,
  sex: 4,
  experience: 5,
  goals: 6,
  types: 7,
  allergy: 8,
  blocker: 9,
  setup: 10,
  'plan-preview': 11,
  'first-stack': 11,
};

type OnboardingFlowSceneProps = {
  sceneActive: boolean;
  direction: OnboardingFlowDirection;
  goToStep: (step: OnboardingFlowStep, direction: OnboardingFlowDirection) => void;
  exitTo: (href: string, direction?: OnboardingFlowDirection) => void;
  setSharedShellConfig?: (config: OnboardingSharedShellConfig | null) => void;
};

const isFlowStep = (value: string | undefined): value is OnboardingFlowStep =>
  Boolean(value && ONBOARDING_FLOW_STEPS.includes(value as OnboardingFlowStep));

export const resolveInitialOnboardingFlowStep = ({
  requestedStep,
  progress,
}: {
  requestedStep?: string;
  progress: number;
}): OnboardingFlowStep => {
  if (isFlowStep(requestedStep)) {
    return requestedStep;
  }

  if (progress <= 1) return 'welcome';
  if (progress === 2) return 'data-trust';
  if (progress === 3) return 'age-range';
  if (progress === 4) return 'sex';
  if (progress === 5) return 'experience';
  if (progress === 6) return 'goals';
  if (progress === 7) return 'types';
  if (progress === 8) return 'allergy';
  if (progress === 9) return 'blocker';
  if (progress === 10) return 'setup';
  return 'plan-preview';
};

const TRUST_ROWS = [
  {
    title: 'Private by default',
    body: 'We only ask for what helps narrow fit.',
    bodyMaxWidth: 232,
  },
  {
    title: 'Only what sharpens fit',
    body: 'Your answers shape recommendations, not ads.',
    bodyMaxWidth: 169,
  },
  {
    title: 'Still in your control',
    body: 'You can update this later in Profile.',
    bodyMaxWidth: 215,
  },
] as const;

const SCROLLBAR_HIDE_DELAY_MS = 1200;
const SCROLLBAR_FADE_DURATION_MS = 720;

type SetupPreferenceValue = 'camera' | 'notifications' | 'photos';

const SETUP_UI_OPTIONS = SETUP_OPTIONS.map((option, index) => ({
  label: option.title,
  value: index === 0 ? 'camera' : index === 1 ? 'notifications' : 'photos',
  description: option.description,
})) as const;

const DEFAULT_SETUP_VALUES: SetupPreferenceValue[] = [
  'camera',
  'notifications',
  'photos',
];

type QASelectionBodyProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  options: string[];
  selectionMode: 'single' | 'multiple';
  selectedValues: string[];
  onPressOption: (value: string) => void;
  listContentContainerStyle?: object;
};

function QASelectionBody({
  eyebrow,
  title,
  subtitle,
  options,
  selectionMode,
  selectedValues,
  onPressOption,
  listContentContainerStyle,
}: QASelectionBodyProps) {
  return (
    <QAContentLayout
      eyebrow={eyebrow}
      title={title}
      subtitle={subtitle}
      showBackground={false}
      listContentContainerStyle={listContentContainerStyle}
    >
      {options.map((option) => (
        <QAOptionRow
          key={option}
          label={option}
          selected={selectedValues.includes(option)}
          selectionMode={selectionMode}
          onPress={() => onPressOption(option)}
        />
      ))}
    </QAContentLayout>
  );
}

function useSharedShellRegistration(
  sceneActive: boolean,
  setSharedShellConfig: OnboardingFlowSceneProps['setSharedShellConfig'],
  config: OnboardingSharedShellConfig | null,
) {
  useLayoutEffect(() => {
    if (!sceneActive || !setSharedShellConfig || !config) return;
    setSharedShellConfig(config);
  }, [config, sceneActive, setSharedShellConfig]);
}

function AllergyScrollbar({
  progress,
  opacity,
  top = 8,
  bottom = 14,
  thumbHeight = 40,
}: {
  progress: Animated.SharedValue<number>;
  opacity: Animated.SharedValue<number>;
  top?: number;
  bottom?: number;
  thumbHeight?: number;
}) {
  const [trackHeight, setTrackHeight] = useState(0);

  const rootStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));
  const thumbStyle = useAnimatedStyle(() => {
    const clamped = Math.max(0, Math.min(progress.value, 1));
    const travel = Math.max(trackHeight - thumbHeight, 0);
    return {
      transform: [{ translateY: clamped * travel }],
    };
  });

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackHeight(event.nativeEvent.layout.height);
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={handleLayout}
      style={[flowStyles.scrollbarRoot, rootStyle, { top, bottom }]}
    >
      <Animated.View
        style={[flowStyles.scrollbarThumb, thumbStyle, { height: thumbHeight }]}
      />
    </Animated.View>
  );
}

function TrustHeroPanel({ panelWidth }: { panelWidth: number }) {
  const pulse = useSharedValue(0);
  const diffuse = useSharedValue(0);
  const floatY = useSharedValue(0);

  useEffect(() => {
    floatY.value = withDelay(
      240,
      withRepeat(
        withSequence(
          withTiming(-5, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      ),
    );

    pulse.value = withDelay(
      240,
      withSequence(
        withTiming(0.34, {
          duration: 1200,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        withRepeat(
          withSequence(
            withTiming(0.62, { duration: 3200, easing: Easing.inOut(Easing.ease) }),
            withTiming(0.28, { duration: 3200, easing: Easing.inOut(Easing.ease) }),
          ),
          -1,
          false,
        ),
      ),
    );

    diffuse.value = withDelay(
      240,
      withSequence(
        withTiming(0.26, {
          duration: 1500,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        withRepeat(
          withSequence(
            withTiming(0.56, { duration: 4300, easing: Easing.inOut(Easing.ease) }),
            withTiming(0.2, { duration: 4300, easing: Easing.inOut(Easing.ease) }),
          ),
          -1,
          false,
        ),
      ),
    );

    return () => {
      cancelAnimation(floatY);
      cancelAnimation(pulse);
      cancelAnimation(diffuse);
    };
  }, [diffuse, floatY, pulse]);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }],
  }));

  const panelHeight = 236;
  const heroWidth = panelWidth;
  const heroHeight = panelHeight + 26;
  const glowCardHeight = Math.round(panelHeight * 0.76);

  return (
    <Animated.View
      style={[
        flowStyles.trustHeroShell,
        { width: heroWidth, height: heroHeight },
        floatStyle,
      ]}
    >
      <View pointerEvents="none" style={flowStyles.trustGlowMount}>
        <WelcomeHeroGlow
          cardWidth={panelWidth}
          cardHeight={glowCardHeight}
          pulse={pulse}
          diffuse={diffuse}
        />
      </View>

      <View
        style={[
          flowStyles.trustPanelShell,
          { width: panelWidth, height: panelHeight },
        ]}
      >
        <BlurView
          intensity={18}
          tint="light"
          style={[StyleSheet.absoluteFillObject, flowStyles.trustPanelBlur]}
          {...BLUR_PROPS}
        />
        <LinearGradient
          colors={[
            'rgba(255,255,255,0.56)',
            'rgba(251,253,255,0.42)',
            'rgba(244,248,255,0.28)',
          ]}
          start={{ x: 0.18, y: 0 }}
          end={{ x: 0.86, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={flowStyles.trustPanelBorder} pointerEvents="none" />
        <View style={flowStyles.trustPanelTopSpecular} pointerEvents="none" />

        <View style={flowStyles.trustPanelContent}>
          <View style={flowStyles.trustPanelGuide} pointerEvents="none" />
          {TRUST_ROWS.map((row) => (
            <View key={row.title} style={flowStyles.trustRowItem}>
              <View style={flowStyles.trustDotWrap}>
                <View style={flowStyles.trustDotShadow} />
                <View style={flowStyles.trustDot} />
              </View>
              <View style={flowStyles.trustRowTextWrap}>
                <Text allowFontScaling={false} style={flowStyles.trustRowTitle}>
                  {row.title}
                </Text>
                <Text
                  allowFontScaling={false}
                  style={[flowStyles.trustRowBody, { maxWidth: row.bodyMaxWidth }]}
                >
                  {row.body}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

function WelcomeFlowScene({
  goToStep,
}: Pick<OnboardingFlowSceneProps, 'goToStep'>) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const cardWidth = Math.min(width - 56, 320);
  const cardHeight = Math.round(cardWidth * 0.553);
  const isCompactHeight = height < 860;

  const floatY = useSharedValue(0);
  const pulse = useSharedValue(0);
  const diffuse = useSharedValue(0);
  const microcopyOpacity = useRef(new RNAnimated.Value(1)).current;
  const microcopyTranslate = useRef(new RNAnimated.Value(0)).current;
  const isNavigatingRef = useRef(false);

  useEffect(() => {
    floatY.value = withRepeat(
      withSequence(
        withTiming(-7, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );

    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2100, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 2100, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );

    diffuse.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: 3500,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );

    return () => {
      cancelAnimation(floatY);
      cancelAnimation(pulse);
      cancelAnimation(diffuse);
    };
  }, [diffuse, floatY, pulse]);

  const heroFloatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }],
  }));

  const handleGetStarted = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;

    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    RNAnimated.parallel([
      RNAnimated.timing(microcopyOpacity, {
        toValue: 0,
        duration: 280,
        easing: RNEasing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
      RNAnimated.timing(microcopyTranslate, {
        toValue: 8,
        duration: 280,
        easing: RNEasing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
    ]).start(() => {
      trackOnboardingEvent('onboarding_started', {
        version: 'welcome_cta_root_fix_v1',
      });
      goToStep('data-trust', 'forward');
      isNavigatingRef.current = false;
    });
  }, [goToStep, microcopyOpacity, microcopyTranslate]);

  return (
    <View style={flowStyles.welcomeRoot}>
      <LinearGradient
        colors={[WELCOME_BG_TOP, WELCOME_BG_BOTTOM]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[flowStyles.welcomeScreen, { paddingTop: insets.top + 10 }]}>
        <View style={flowStyles.welcomeLogoWrap}>
          <View style={flowStyles.welcomeLogoPill}>
            <BlurView
              intensity={18}
              tint="light"
              style={[StyleSheet.absoluteFillObject, flowStyles.welcomeLogoBlur]}
              {...BLUR_PROPS}
            />
            <LinearGradient
              colors={['rgba(255,255,255,0.58)', 'rgba(255,255,255,0.44)']}
              start={{ x: 0.18, y: 0 }}
              end={{ x: 0.82, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={flowStyles.welcomeLogoBorder} pointerEvents="none" />
            <Text allowFontScaling={false} style={flowStyles.welcomeLogoText}>
              NuTri
            </Text>
          </View>
        </View>

        <View style={flowStyles.welcomeMain}>
          <View
            style={[
              flowStyles.welcomeViewport,
              isCompactHeight && flowStyles.welcomeViewportCompact,
            ]}
          >
            <View
              style={[
                flowStyles.welcomeHeroArea,
                isCompactHeight && flowStyles.welcomeHeroAreaCompact,
              ]}
            >
              <Animated.View
                style={[flowStyles.welcomeHeroShell, heroFloatStyle]}
              >
                <WelcomeHeroGlow
                  cardWidth={cardWidth}
                  cardHeight={cardHeight}
                  pulse={pulse}
                  diffuse={diffuse}
                />
                <WelcomeHeroCarousel
                  cardWidth={cardWidth}
                  cardHeight={cardHeight}
                />
              </Animated.View>
            </View>

            <View
              style={[
                flowStyles.welcomeCopyWrap,
                isCompactHeight && flowStyles.welcomeCopyWrapCompact,
              ]}
            >
              <Text
                allowFontScaling={false}
                style={[
                  flowStyles.welcomeHeadline,
                  isCompactHeight && flowStyles.welcomeHeadlineCompact,
                ]}
              >
                Welcome to NuTri
              </Text>
              <Text
                allowFontScaling={false}
                style={[
                  flowStyles.welcomeSubtext,
                  isCompactHeight && flowStyles.welcomeSubtextCompact,
                ]}
              >
                Answer a few quick questions and NuTri will shape the clearest
                next picks for you.
              </Text>
            </View>
          </View>

          <View
            style={[
              flowStyles.welcomeFooter,
              isCompactHeight && flowStyles.welcomeFooterCompact,
              { paddingBottom: Math.max(insets.bottom, 18) + 10 },
            ]}
          >
            <View style={flowStyles.welcomeProgressRow}>
              <View style={flowStyles.welcomeProgressActivePill} />
              <View style={flowStyles.welcomeProgressInactiveDot} />
            </View>

            <WelcomePrimaryCTA title="Get Started" onPress={handleGetStarted} />

            <View style={flowStyles.welcomeMicrocopySlot}>
              <RNAnimated.Text
                allowFontScaling={false}
                style={[
                  flowStyles.welcomeMicrocopy,
                  {
                    opacity: microcopyOpacity,
                    transform: [{ translateY: microcopyTranslate }],
                  },
                ]}
              >
                Takes less than a minute
              </RNAnimated.Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function DataTrustFlowScene({
  sceneActive,
  goToStep,
}: OnboardingFlowSceneProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { commitDraft, flushDraft } = useOnboarding();
  const trackedRef = useRef(false);
  const panelWidth = Math.min(width - 110, 320);
  const isCompactHeight = height < 860;

  useEffect(() => {
    if (!sceneActive || trackedRef.current) return;
    trackedRef.current = true;
    trackOnboardingEvent('trust_page_viewed', {
      screen: 'data_trust',
      variant: 'figma_restore_v1',
    });
  }, [sceneActive]);

  const handleOpenPolicy = useCallback(() => {
    void openPrivacyPolicy();
  }, []);

  const handleGetStarted = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    commitDraft({ onboardingVersion: 'v2' });
    goToStep('age-range', 'forward');
    void flushDraft();
  }, [commitDraft, flushDraft, goToStep]);

  return (
    <View style={flowStyles.welcomeRoot}>
      <LinearGradient
        colors={[WELCOME_BG_TOP, WELCOME_BG_BOTTOM]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[flowStyles.welcomeScreen, { paddingTop: insets.top + 10 }]}>
        <View style={flowStyles.welcomeLogoWrap}>
          <View style={flowStyles.welcomeLogoPill}>
            <BlurView
              intensity={18}
              tint="light"
              style={[StyleSheet.absoluteFillObject, flowStyles.welcomeLogoBlur]}
              {...BLUR_PROPS}
            />
            <LinearGradient
              colors={['rgba(255,255,255,0.58)', 'rgba(255,255,255,0.44)']}
              start={{ x: 0.18, y: 0 }}
              end={{ x: 0.82, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={flowStyles.welcomeLogoBorder} pointerEvents="none" />
            <Text allowFontScaling={false} style={flowStyles.welcomeLogoText}>
              NuTri
            </Text>
          </View>
        </View>

        <View style={flowStyles.welcomeMain}>
          <View style={flowStyles.dataTrustViewport}>
            <View
              style={[
                flowStyles.dataTrustHeroArea,
                isCompactHeight && flowStyles.dataTrustHeroAreaCompact,
              ]}
            >
              <TrustHeroPanel panelWidth={panelWidth} />
            </View>

            <View
              style={[
                flowStyles.dataTrustCopyWrap,
                isCompactHeight && flowStyles.dataTrustCopyWrapCompact,
              ]}
            >
              <Text
                allowFontScaling={false}
                style={[
                  flowStyles.dataTrustHeadline,
                  isCompactHeight && flowStyles.dataTrustHeadlineCompact,
                ]}
              >
                Only what helps us{'\n'}narrow what fits.
              </Text>
              <Text
                allowFontScaling={false}
                style={[
                  flowStyles.dataTrustSubtext,
                  isCompactHeight && flowStyles.dataTrustSubtextCompact,
                ]}
              >
                A few answers help NuTri shape recommendations and setup.
                Nothing extra gets in the way.
              </Text>
            </View>
          </View>

          <View
            style={[
              flowStyles.dataTrustFooter,
              isCompactHeight && flowStyles.dataTrustFooterCompact,
              { paddingBottom: Math.max(insets.bottom, 18) + 8 },
            ]}
          >
            <View style={flowStyles.welcomeProgressRow}>
              <View style={flowStyles.welcomeProgressInactiveDot} />
              <View style={flowStyles.welcomeProgressActivePill} />
            </View>

            <WelcomePrimaryCTA title="Get Started" onPress={handleGetStarted} />

            <View style={flowStyles.dataTrustPolicySlot}>
              <Text
                allowFontScaling={false}
                style={flowStyles.dataTrustPolicyLink}
                onPress={handleOpenPolicy}
              >
                Read full Privacy Policy
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function AgeRangeFlowScene({
  sceneActive,
  goToStep,
  setSharedShellConfig,
}: OnboardingFlowSceneProps) {
  const { draft, commitDraft, flushDraft } = useOnboarding();
  const [selected, setSelected] = useState<string>(draft?.ageRange ?? '');

  useEffect(() => {
    setSelected(draft?.ageRange ?? '');
  }, [draft?.ageRange]);

  const goNext = useCallback(
    (skip: boolean) => {
      if (!skip && !selected) return;

      const answer = skip ? 'skipped' : selected;

      commitDraft({ ageRange: skip ? undefined : selected });
      trackOnboardingEvent('question_answered', {
        question: 'age_range',
        answer,
      });
      goToStep('sex', 'forward');
      void flushDraft();
    },
    [commitDraft, flushDraft, goToStep, selected],
  );

  const shellConfig = useMemo<OnboardingSharedShellConfig>(
    () => ({
      backgroundVariant: 'qa',
      progressFillWidth: getSharedShellProgressFillWidth('age-range'),
      onBack: () => goToStep('data-trust', 'back'),
      onContinue: () => goNext(false),
      onSkip: () => goNext(true),
      continueLabel: 'Continue',
      continueDisabled: !selected,
      footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
    }),
    [goNext, goToStep, selected],
  );

  useSharedShellRegistration(sceneActive, setSharedShellConfig, shellConfig);

  return (
    <QASelectionBody
      eyebrow="About you"
      title={'Which age range are\nyou in?'}
      subtitle="This helps tailor how guidance fits you."
      options={[...AGE_RANGE_OPTIONS]}
      selectionMode="single"
      selectedValues={selected ? [selected] : []}
      onPressOption={setSelected}
    />
  );
}

function SexFlowScene({
  sceneActive,
  goToStep,
  setSharedShellConfig,
}: OnboardingFlowSceneProps) {
  const { draft, commitDraft, flushDraft } = useOnboarding();
  const [selected, setSelected] = useState(draft?.sex ?? draft?.gender ?? '');

  useEffect(() => {
    setSelected(draft?.sex ?? draft?.gender ?? '');
  }, [draft?.gender, draft?.sex]);

  const persist = useCallback(() => {
    commitDraft({
      sex: selected || undefined,
      gender: selected || undefined,
    });
    trackOnboardingEvent('question_answered', {
      question: 'sex',
      answer: selected || 'skipped',
    });
    goToStep('experience', 'forward');
    void flushDraft();
  }, [commitDraft, flushDraft, goToStep, selected]);

  const shellConfig = useMemo<OnboardingSharedShellConfig>(
    () => ({
      backgroundVariant: 'qa',
      progressFillWidth: getSharedShellProgressFillWidth('sex'),
      onBack: () => goToStep('age-range', 'back'),
      onContinue: persist,
      onSkip: persist,
      continueLabel: 'Continue',
      footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
    }),
    [goToStep, persist],
  );

  useSharedShellRegistration(sceneActive, setSharedShellConfig, shellConfig);

  return (
    <QASelectionBody
      eyebrow="About you"
      title="How do you identify?"
      subtitle="Choose what feels right for your profile."
      options={[...SEX_OPTIONS]}
      selectionMode="single"
      selectedValues={selected ? [selected] : []}
      onPressOption={setSelected}
    />
  );
}

function ExperienceFlowScene({
  sceneActive,
  goToStep,
  setSharedShellConfig,
}: OnboardingFlowSceneProps) {
  const { draft, commitDraft, flushDraft } = useOnboarding();
  const [selected, setSelected] = useState(draft?.supplementExperience ?? '');

  useEffect(() => {
    setSelected(draft?.supplementExperience ?? '');
  }, [draft?.supplementExperience]);

  const persist = useCallback(() => {
    commitDraft({ supplementExperience: selected || undefined });
    trackOnboardingEvent('question_answered', {
      question: 'supplement_experience',
      answer: selected || 'skipped',
    });
    goToStep('goals', 'forward');
    void flushDraft();
  }, [commitDraft, flushDraft, goToStep, selected]);

  const shellConfig = useMemo<OnboardingSharedShellConfig>(
    () => ({
      backgroundVariant: 'qa',
      progressFillWidth: getSharedShellProgressFillWidth('experience'),
      onBack: () => goToStep('sex', 'back'),
      onContinue: persist,
      onSkip: persist,
      continueLabel: 'Continue',
      footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
    }),
    [goToStep, persist],
  );

  useSharedShellRegistration(sceneActive, setSharedShellConfig, shellConfig);

  return (
    <QASelectionBody
      eyebrow="About you"
      title="How familiar are you with supplements?"
      subtitle="This helps shape how much guidance feels right."
      options={[...SUPPLEMENT_EXPERIENCE_OPTIONS]}
      selectionMode="single"
      selectedValues={selected ? [selected] : []}
      onPressOption={setSelected}
    />
  );
}

function GoalsFlowScene({
  sceneActive,
  goToStep,
  setSharedShellConfig,
}: OnboardingFlowSceneProps) {
  const { draft, commitDraft, flushDraft } = useOnboarding();
  const [selectedGoals, setSelectedGoals] = useState<string[]>(draft?.goals ?? []);

  useEffect(() => {
    setSelectedGoals(draft?.goals ?? []);
  }, [draft?.goals]);

  const toggleGoal = useCallback((goal: string) => {
    setSelectedGoals((current) =>
      current.includes(goal)
        ? current.filter((item) => item !== goal)
        : [...current, goal],
    );
  }, []);

  const persist = useCallback(() => {
    commitDraft({
      goals: selectedGoals,
      smartFilterConfig: buildSmartFilterConfig({
        goals: selectedGoals,
        preferredTypes: draft?.preferredTypes ?? [],
      }),
    });
    trackOnboardingEvent('question_answered', {
      question: 'goals',
      answerCount: selectedGoals.length,
      answers: selectedGoals,
      source: 'gemini_port',
    });
    goToStep('types', 'forward');
    void flushDraft();
  }, [commitDraft, draft?.preferredTypes, flushDraft, goToStep, selectedGoals]);

  const shellConfig = useMemo<OnboardingSharedShellConfig>(
    () => ({
      backgroundVariant: 'qa',
      progressFillWidth: getSharedShellProgressFillWidth('goals'),
      onBack: () => goToStep('experience', 'back'),
      onContinue: persist,
      onSkip: persist,
      continueLabel: 'Continue',
      footerHint:
        selectedGoals.length === 0
          ? 'Select at least one goal to continue.'
          : undefined,
      footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE_WITH_HELPER,
    }),
    [goToStep, persist, selectedGoals.length],
  );

  useSharedShellRegistration(sceneActive, setSharedShellConfig, shellConfig);

  return (
    <QASelectionBody
      eyebrow="Your goal"
      title="What are your goals right now?"
      subtitle="Select at least one."
      options={[...GOAL_OPTIONS]}
      selectionMode="multiple"
      selectedValues={selectedGoals}
      onPressOption={toggleGoal}
    />
  );
}

function TypesFlowScene({
  sceneActive,
  goToStep,
  setSharedShellConfig,
}: OnboardingFlowSceneProps) {
  const { draft, commitDraft, flushDraft } = useOnboarding();
  const [selectedTypes, setSelectedTypes] = useState<string[]>(
    draft?.preferredTypes ?? [],
  );

  useEffect(() => {
    setSelectedTypes(draft?.preferredTypes ?? []);
  }, [draft?.preferredTypes]);

  const toggleType = useCallback((value: string) => {
    setSelectedTypes((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }, []);

  const persist = useCallback(() => {
    commitDraft({
      preferredTypes: selectedTypes,
      smartFilterConfig: buildSmartFilterConfig({
        goals: draft?.goals ?? [],
        preferredTypes: selectedTypes,
      }),
    });
    trackOnboardingEvent('question_answered', {
      question: 'preferred_types',
      answerCount: selectedTypes.length,
      answers: selectedTypes,
      source: 'gemini_port',
    });
    goToStep('allergy', 'forward');
    void flushDraft();
  }, [commitDraft, draft?.goals, flushDraft, goToStep, selectedTypes]);

  const shellConfig = useMemo<OnboardingSharedShellConfig>(
    () => ({
      backgroundVariant: 'qa',
      progressFillWidth: getSharedShellProgressFillWidth('types'),
      onBack: () => goToStep('goals', 'back'),
      onContinue: persist,
      onSkip: persist,
      continueLabel: 'Continue',
      footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
    }),
    [goToStep, persist],
  );

  useSharedShellRegistration(sceneActive, setSharedShellConfig, shellConfig);

  return (
    <QASelectionBody
      eyebrow="Your focus"
      title="Which supplement types do you want to focus on first?"
      subtitle="Optional. Choose any you want to focus on first."
      options={[...TYPE_OPTIONS]}
      selectionMode="multiple"
      selectedValues={selectedTypes}
      onPressOption={toggleType}
    />
  );
}

function AllergyFlowScene({
  sceneActive,
  direction,
  goToStep,
  setSharedShellConfig,
}: OnboardingFlowSceneProps) {
  const { draft, commitDraft, flushDraft } = useOnboarding();
  const [selected, setSelected] = useState<string[]>(
    buildAvoidItemsFromStructuredPreferences({
      avoidItems: draft?.avoidItems,
      allergyFlags: draft?.allergyFlags,
      ingredientRestrictions: draft?.ingredientRestrictions,
      noKnownAllergies: draft?.noKnownAllergies,
    }),
  );
  const [showMore, setShowMore] = useState(false);
  const [moreOptionsHeight, setMoreOptionsHeight] = useState(0);
  const expandProgress = useSharedValue(0);
  const scrollProgress = useSharedValue(0);
  const scrollbarOpacity = useSharedValue(1);

  const commonOptions = useMemo(
    () => PRIMARY_ALLERGY_UI_OPTIONS.map((option) => option.label),
    [],
  );
  const secondaryOptions = useMemo(
    () => SECONDARY_ALLERGY_UI_OPTIONS.map((option) => option.label),
    [],
  );
  const restrictionOptions = useMemo(
    () => [
      ...RESTRICTION_UI_OPTIONS.map((option) => option.label),
      NO_KNOWN_ALLERGIES_LABEL,
    ],
    [],
  );

  useEffect(() => {
    setSelected(
      buildAvoidItemsFromStructuredPreferences({
        avoidItems: draft?.avoidItems,
        allergyFlags: draft?.allergyFlags,
        ingredientRestrictions: draft?.ingredientRestrictions,
        noKnownAllergies: draft?.noKnownAllergies,
      }),
    );
  }, [draft?.allergyFlags, draft?.avoidItems, draft?.ingredientRestrictions, draft?.noKnownAllergies]);

  useEffect(() => {
    expandProgress.value = withTiming(showMore ? 1 : 0, {
      duration: 600,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [expandProgress, showMore]);

  const moreOptionsStyle = useAnimatedStyle(() => ({
    height: moreOptionsHeight * expandProgress.value,
    opacity: expandProgress.value,
    marginTop: 16 * expandProgress.value,
  }));

  const showScrollbar = useCallback(() => {
    'worklet';
    cancelAnimation(scrollbarOpacity);
    scrollbarOpacity.value = withTiming(1, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
  }, [scrollbarOpacity]);

  const fadeOutScrollbar = useCallback(() => {
    'worklet';
    cancelAnimation(scrollbarOpacity);
    scrollbarOpacity.value = withTiming(0, {
      duration: SCROLLBAR_FADE_DURATION_MS,
      delay: SCROLLBAR_HIDE_DELAY_MS,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    });
  }, [scrollbarOpacity]);

  const handleScroll = useAnimatedScrollHandler({
    onBeginDrag: () => {
      showScrollbar();
    },
    onScroll: (event) => {
      const range = Math.max(
        event.contentSize.height - event.layoutMeasurement.height,
        1,
      );
      scrollProgress.value = event.contentOffset.y / range;
    },
    onEndDrag: (event) => {
      const velocityY = Math.abs(event.velocity?.y ?? 0);
      if (velocityY < 0.05) {
        fadeOutScrollbar();
      }
    },
    onMomentumBegin: () => {
      showScrollbar();
    },
    onMomentumEnd: () => {
      fadeOutScrollbar();
    },
  });

  const toggleItem = useCallback((item: string) => {
    if (item === NO_KNOWN_ALLERGIES_LABEL) {
      setSelected((current) => (current.includes(item) ? [] : [item]));
      return;
    }

    setSelected((current) => {
      const withoutNoKnown = current.filter(
        (entry) => entry !== NO_KNOWN_ALLERGIES_LABEL,
      );
      return withoutNoKnown.includes(item)
        ? withoutNoKnown.filter((entry) => entry !== item)
        : [...withoutNoKnown, item];
    });
  }, []);

  const persist = useCallback(() => {
    const normalized = normalizeAvoidItemsSelection(selected);
    commitDraft({
      avoidItems: normalized.avoidItems,
      allergyFlags: normalized.allergyFlags,
      ingredientRestrictions: normalized.ingredientRestrictions,
      noKnownAllergies: normalized.noKnownAllergies,
    });
    trackOnboardingEvent('question_answered', {
      question: 'avoid_items',
      answerCount: selected.length,
      answers: selected,
    });
    goToStep('blocker', 'forward');
    void flushDraft();
  }, [commitDraft, flushDraft, goToStep, selected]);

  const shellConfig = useMemo<OnboardingSharedShellConfig>(
    () => ({
      backgroundVariant: 'qa',
      progressFillWidth: getSharedShellProgressFillWidth('allergy'),
      onBack: () => goToStep('types', 'back'),
      onContinue: persist,
      onSkip: persist,
      continueLabel: 'Continue',
      footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
    }),
    [goToStep, persist],
  );

  useSharedShellRegistration(sceneActive, setSharedShellConfig, shellConfig);

  return (
    <QAContentLayout
      showBackground={false}
      title="Anything to avoid?"
      subtitle="Optional. We'll flag ingredients that may not fit your routine."
      onListScroll={handleScroll}
      listOverlay={
        <AllergyScrollbar
          progress={scrollProgress}
          opacity={scrollbarOpacity}
          top={6}
          bottom={18}
        />
      }
      listContentContainerStyle={flowStyles.allergyListContent}
    >
      <Text allowFontScaling={false} style={flowStyles.allergySectionTitle}>
        Most common in supplements
      </Text>

      <View style={flowStyles.allergyGroupList}>
        {commonOptions.map((option) => (
          <QAOptionRow
            key={option}
            label={option}
            selected={selected.includes(option)}
            selectionMode="multiple"
            onPress={() => toggleItem(option)}
          />
        ))}
      </View>

      <View style={flowStyles.allergyMoreSection}>
        <QAMoreOptionsPill
          expanded={showMore}
          onPress={() => setShowMore((current) => !current)}
        />

        <Animated.View style={[flowStyles.allergyMoreRowsWrap, moreOptionsStyle]}>
          <View style={flowStyles.allergyMoreRowsInner}>
            {secondaryOptions.map((option) => (
              <QAOptionRow
                key={option}
                label={option}
                selected={selected.includes(option)}
                selectionMode="multiple"
                onPress={() => toggleItem(option)}
              />
            ))}
          </View>
        </Animated.View>

        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={flowStyles.allergyMeasureProxy}
        >
          <View
            onLayout={(event) =>
              setMoreOptionsHeight(event.nativeEvent.layout.height)
            }
            style={flowStyles.allergyMoreRowsInner}
          >
            {secondaryOptions.map((option) => (
              <QAOptionRow
                key={`measure-${option}`}
                label={option}
                selected={false}
                selectionMode="multiple"
                onPress={() => undefined}
              />
            ))}
          </View>
        </View>
      </View>

      <Text allowFontScaling={false} style={flowStyles.allergySectionTitle}>
        Restrictions
      </Text>

      <View style={flowStyles.allergyGroupList}>
        {restrictionOptions.map((option) => (
          <QAOptionRow
            key={option}
            label={option}
            selected={selected.includes(option)}
            selectionMode="multiple"
            onPress={() => toggleItem(option)}
          />
        ))}
      </View>
    </QAContentLayout>
  );
}

function BlockerFlowScene({
  sceneActive,
  goToStep,
  setSharedShellConfig,
}: OnboardingFlowSceneProps) {
  const { draft, commitDraft, flushDraft } = useOnboarding();
  const [selected, setSelected] = useState(draft?.adherenceBlocker ?? '');

  useEffect(() => {
    setSelected(draft?.adherenceBlocker ?? '');
  }, [draft?.adherenceBlocker]);

  const persist = useCallback(() => {
    commitDraft({ adherenceBlocker: selected || undefined });
    trackOnboardingEvent('question_answered', {
      question: 'adherence_blocker',
      answer: selected || 'skipped',
    });
    goToStep('setup', 'forward');
    void flushDraft();
  }, [commitDraft, flushDraft, goToStep, selected]);

  const shellConfig = useMemo<OnboardingSharedShellConfig>(
    () => ({
      backgroundVariant: 'qa',
      progressFillWidth: getSharedShellProgressFillWidth('blocker'),
      onBack: () => goToStep('allergy', 'back'),
      onContinue: persist,
      onSkip: persist,
      continueLabel: 'Continue',
      footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
    }),
    [goToStep, persist],
  );

  useSharedShellRegistration(sceneActive, setSharedShellConfig, shellConfig);

  return (
    <QASelectionBody
      eyebrow="Daily rhythm"
      title="What usually gets in the way?"
      subtitle="Pick the one that fits best right now."
      options={[...ADHERENCE_BLOCKER_OPTIONS]}
      selectionMode="single"
      selectedValues={selected ? [selected] : []}
      onPressOption={setSelected}
    />
  );
}

function SetupFlowScene({
  sceneActive,
  goToStep,
  setSharedShellConfig,
}: OnboardingFlowSceneProps) {
  const { draft, commitDraft, flushDraft } = useOnboarding();
  const permissionPreferences = draft?.permissionPreferences;

  const initialSelection = useMemo(() => {
    const hasExplicitPreference =
      typeof permissionPreferences?.camera === 'boolean' ||
      typeof permissionPreferences?.notifications === 'boolean' ||
      typeof permissionPreferences?.photos === 'boolean';

    if (!hasExplicitPreference) {
      return [...DEFAULT_SETUP_VALUES];
    }

    const selected: SetupPreferenceValue[] = [];
    if (permissionPreferences?.camera) selected.push('camera');
    if (permissionPreferences?.notifications) selected.push('notifications');
    if (permissionPreferences?.photos) selected.push('photos');
    return selected;
  }, [permissionPreferences]);

  const [selectedSetup, setSelectedSetup] =
    useState<SetupPreferenceValue[]>(initialSelection);

  useEffect(() => {
    setSelectedSetup(initialSelection);
  }, [initialSelection]);

  const toggle = useCallback(async (value: SetupPreferenceValue) => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    setSelectedSetup((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }, []);

  const persistSelection = useCallback(
    (values: SetupPreferenceValue[]) => {
      const permissionPreferences = {
        camera: values.includes('camera'),
        notifications: values.includes('notifications'),
        photos: values.includes('photos'),
      };
      const selectedSetupLabels = SETUP_UI_OPTIONS.filter((option) =>
        values.includes(option.value),
      ).map((option) => option.label);

      commitDraft({
        permissionPreferences,
        setupPreferences: selectedSetupLabels,
      });

      trackOnboardingEvent('question_answered', {
        question: 'setup_preferences',
        answers: selectedSetupLabels,
        permissionPreferences,
      });

      void flushDraft();
    },
    [commitDraft, flushDraft],
  );

  const handleContinue = useCallback(() => {
    persistSelection(selectedSetup);
    goToStep('plan-preview', 'forward');
  }, [goToStep, persistSelection, selectedSetup]);

  const handleSkip = useCallback(() => {
    persistSelection([]);
    goToStep('plan-preview', 'forward');
  }, [goToStep, persistSelection]);

  const shellConfig = useMemo<OnboardingSharedShellConfig>(
    () => ({
      backgroundVariant: 'qa',
      progressFillWidth: getSharedShellProgressFillWidth('setup'),
      onBack: () => goToStep('blocker', 'back'),
      onContinue: handleContinue,
      onSkip: handleSkip,
      continueLabel: 'Preview my plan',
      footerReserveHeight: ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE,
    }),
    [goToStep, handleContinue, handleSkip],
  );

  useSharedShellRegistration(sceneActive, setSharedShellConfig, shellConfig);

  return (
    <QAContentLayout
      showBackground={false}
      eyebrow="Start setup"
      title="Which setup would help you start strong?"
      subtitle="These are only preferences. We ask for access only when you use the feature."
      listContentContainerStyle={flowStyles.setupListContent}
    >
      {SETUP_UI_OPTIONS.map((option) => (
        <QAOptionRow
          key={option.value}
          label={option.label}
          description={option.description}
          selected={selectedSetup.includes(option.value)}
          selectionMode="multiple"
          onPress={() => void toggle(option.value)}
        />
      ))}
    </QAContentLayout>
  );
}

export function renderOnboardingScene(
  step: OnboardingFlowStep,
  props: OnboardingFlowSceneProps,
) {
  switch (step) {
    case 'welcome':
      return <WelcomeFlowScene {...props} />;
    case 'data-trust':
      return <DataTrustFlowScene {...props} />;
    case 'age-range':
      return <AgeRangeFlowScene {...props} />;
    case 'sex':
      return <SexFlowScene {...props} />;
    case 'experience':
      return <ExperienceFlowScene {...props} />;
    case 'goals':
      return <GoalsFlowScene {...props} />;
    case 'types':
      return <TypesFlowScene {...props} />;
    case 'allergy':
      return <AllergyFlowScene {...props} />;
    case 'blocker':
      return <BlockerFlowScene {...props} />;
    case 'setup':
      return <SetupFlowScene {...props} />;
    case 'plan-preview':
      return <PlanPreviewFlowScene {...props} />;
    case 'first-stack':
      return <FirstStackFlowScene {...props} />;
    default:
      return null;
  }
}

const flowStyles = StyleSheet.create({
  welcomeRoot: {
    flex: 1,
    backgroundColor: WELCOME_BG,
  },
  welcomeScreen: {
    flex: 1,
    backgroundColor: WELCOME_BG,
  },
  welcomeLogoWrap: {
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  welcomeLogoPill: {
    minWidth: 86,
    height: 40,
    paddingHorizontal: 22,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#CAD4E8',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  welcomeLogoBlur: {
    borderRadius: 999,
  },
  welcomeLogoBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  welcomeLogoText: {
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: -0.34,
    color: FOREGROUND,
  },
  welcomeMain: {
    flex: 1,
  },
  welcomeViewport: {
    flex: 1,
    marginTop: 4,
    paddingTop: 0,
    paddingBottom: 16,
    justifyContent: 'space-between',
  },
  welcomeViewportCompact: {
    paddingBottom: 10,
  },
  welcomeHeroArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 0,
    paddingBottom: 16,
  },
  welcomeHeroAreaCompact: {
    paddingBottom: 8,
  },
  welcomeHeroShell: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  welcomeCopyWrap: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 0,
  },
  welcomeCopyWrapCompact: {
    paddingBottom: 0,
  },
  welcomeHeadline: {
    fontSize: 44,
    lineHeight: 48,
    fontWeight: '700',
    letterSpacing: -2,
    textAlign: 'center',
    color: FOREGROUND,
  },
  welcomeHeadlineCompact: {
    fontSize: 42,
    lineHeight: 45,
    letterSpacing: -1.8,
  },
  welcomeSubtext: {
    marginTop: 12,
    maxWidth: 312,
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '500',
    textAlign: 'center',
    color: MUTED,
  },
  welcomeSubtextCompact: {
    fontSize: 16,
    lineHeight: 24,
  },
  welcomeFooter: {
    paddingHorizontal: 24,
    paddingTop: 10,
    alignItems: 'center',
    minHeight: 166,
  },
  welcomeFooterCompact: {
    paddingTop: 8,
    minHeight: 158,
  },
  welcomeProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  welcomeProgressActivePill: {
    width: 28,
    height: 6,
    borderRadius: 999,
    backgroundColor: ACTIVE_BLUE,
  },
  welcomeProgressInactiveDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: INACTIVE_DOT,
  },
  welcomeMicrocopySlot: {
    width: '100%',
    height: 20,
    marginTop: 14,
    position: 'relative',
  },
  welcomeMicrocopy: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '500',
    color: MUTED,
  },
  dataTrustViewport: {
    flex: 1,
    marginTop: 6,
    paddingTop: 10,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  dataTrustHeroArea: {
    flex: 1.02,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 22,
  },
  dataTrustHeroAreaCompact: {
    paddingTop: 14,
  },
  dataTrustCopyWrap: {
    alignItems: 'center',
    paddingHorizontal: 36,
    paddingBottom: 8,
  },
  dataTrustCopyWrapCompact: {
    paddingBottom: 0,
  },
  dataTrustHeadline: {
    fontSize: 46,
    lineHeight: 48,
    fontWeight: '700',
    letterSpacing: -2.2,
    textAlign: 'center',
    color: FOREGROUND,
  },
  dataTrustHeadlineCompact: {
    fontSize: 42,
    lineHeight: 44,
    letterSpacing: -2,
  },
  dataTrustSubtext: {
    marginTop: 14,
    maxWidth: 320,
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '500',
    textAlign: 'center',
    color: MUTED,
  },
  dataTrustSubtextCompact: {
    fontSize: 16,
    lineHeight: 24,
  },
  dataTrustFooter: {
    paddingHorizontal: 24,
    paddingTop: 8,
    alignItems: 'center',
    minHeight: 166,
  },
  dataTrustFooterCompact: {
    paddingTop: 6,
    minHeight: 158,
  },
  dataTrustPolicySlot: {
    width: '100%',
    height: 20,
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dataTrustPolicyLink: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    color: ACTIVE_BLUE,
  },
  trustHeroShell: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  trustGlowMount: {
    ...StyleSheet.absoluteFillObject,
    top: 28,
  },
  trustPanelShell: {
    position: 'relative',
    borderRadius: 32,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.24)',
    shadowColor: '#CCD4E6',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 9,
  },
  trustPanelBlur: {
    borderRadius: 32,
  },
  trustPanelBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
  },
  trustPanelTopSpecular: {
    position: 'absolute',
    top: 0,
    left: 18,
    right: 18,
    height: 8,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  trustPanelContent: {
    flex: 1,
    paddingHorizontal: 28,
    paddingVertical: 28,
    justifyContent: 'flex-start',
    gap: 24,
  },
  trustPanelGuide: {
    position: 'absolute',
    left: 32.5,
    top: 40,
    bottom: 40,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  trustRowItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  trustDotWrap: {
    width: 13,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 4,
  },
  trustDotShadow: {
    position: 'absolute',
    top: 4,
    width: 11,
    height: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(59,106,247,0.18)',
    shadowColor: ACTIVE_BLUE,
    shadowOpacity: 0.16,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  trustDot: {
    width: 11,
    height: 11,
    borderRadius: 999,
    backgroundColor: ACTIVE_BLUE,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.96)',
  },
  trustRowTextWrap: {
    flex: 1,
  },
  trustRowTitle: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: -0.53,
    color: FOREGROUND,
  },
  trustRowBody: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '500',
    letterSpacing: -0.08,
    color: MUTED,
  },
  allergyListContent: {
    paddingBottom: 14,
  },
  allergySectionTitle: {
    fontSize: 14.5,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: -0.19,
    color: QA_EYEBROW,
    marginBottom: 16,
  },
  allergyGroupList: {
    gap: 14,
    marginBottom: 24,
  },
  allergyMoreSection: {
    position: 'relative',
    marginBottom: 24,
  },
  allergyMoreRowsWrap: {
    overflow: 'hidden',
  },
  allergyMoreRowsInner: {
    gap: 14,
  },
  allergyMeasureProxy: {
    position: 'absolute',
    left: 0,
    right: 0,
    opacity: 0,
    zIndex: -1,
  },
  setupListContent: {
    gap: 18,
    paddingBottom: 18,
  },
  scrollbarRoot: {
    position: 'absolute',
    right: 4,
    width: 6,
  },
  scrollbarThumb: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: 999,
    backgroundColor: 'rgba(59,106,247,0.7)',
    shadowColor: '#60A5FA',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
});
