import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  BackHandler,
  Easing as RNEasing,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  interpolate,
  interpolateColor,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { StepSlide } from '@/components/animation/StepSlide';
import {
  FLOW_EASE_BEZIER,
  ONBOARDING_CHROME_PROGRESS_DURATION_MS,
  ONBOARDING_STEP_SLIDE_TIMING,
} from '@/components/onboarding/flow/onboardingMotion';
import { QAContinueCTA } from '@/components/onboarding/qa/QAContinueCTA';
import { useOnboardingSceneZoneStyle } from '@/components/onboarding/flow/OnboardingSceneMotionContext';
import { PlanPreviewCornerGlow } from '@/components/onboarding/summary/PlanPreviewCornerGlow';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { useOnboardingLayoutTokens } from '@/hooks/useOnboardingLayoutTokens';
import {
  buildAvoidItemsFromStructuredPreferences,
  buildSmartFilterConfig,
  GOAL_OPTIONS,
} from '@/lib/onboarding-v2';

const BLUR_PROPS =
  Platform.OS === 'android'
    ? ({ experimentalBlurMethod: 'dimezisBlurView' } as const)
    : ({} as const);

const PAGE_BG_TOP = 'rgba(240,244,255,0.4)';
const PAGE_BG_BOTTOM = 'rgba(230,237,255,0.5)';
const PAGE_TEXT = '#0A1533';
const PAGE_MUTED = '#697591';
const PAGE_BLUE = '#3B6AF7';
const PAGE_PROGRESS_TRACK = 109.997;
const PAGE_PROGRESS_FILL = 97.772;
const SCROLLBAR_HIDE_DELAY_MS = 1200;
const SCROLLBAR_FADE_DURATION_MS = 720;

const ingredientRecommendations: Record<string, { desc: string; items: string[] }> = {
  Sleep: {
    desc: "We'll prioritize ingredients that calm the nervous system and promote deep, restorative rest.",
    items: ['Magnesium', 'L-theanine', 'Chamomile'],
  },
  Energy: {
    desc: 'Focusing on sustained cellular ATP production without the crash.',
    items: ['Vitamin B12', 'CoQ10', 'Rhodiola'],
  },
  Immunity: {
    desc: 'Building a robust defense system with proven antioxidants and gut-supportive strains.',
    items: ['Vitamin C', 'Zinc', 'Vitamin D3'],
  },
  Recovery: {
    desc: 'Targeting inflammation reduction and muscle repair post-exertion.',
    items: ['Curcumin', 'Omega-3', 'L-Glutamine'],
  },
  Focus: {
    desc: 'Enhancing cognitive clarity and neurotransmitter balance for deep work.',
    items: ["Lion's Mane", 'Alpha-GPC', 'Bacopa'],
  },
  'Libido Enhancement': {
    desc: 'Supporting healthy hormone levels and blood flow.',
    items: ['Maca', 'Tribulus', 'Panax Ginseng'],
  },
  'Stress Support': {
    desc: 'Balancing cortisol levels to help your body adapt to daily pressures.',
    items: ['Ashwagandha', 'Magnesium', 'L-theanine'],
  },
  'Weight Management': {
    desc: 'Optimizing metabolic rate and supporting healthy blood sugar levels.',
    items: ['Fiber', 'Protein', 'Green Tea Extract'],
  },
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedChevron = Animated.createAnimatedComponent(Svg);

const getRhythmAdaptation = (rhythm?: string) => {
  if (!rhythm) return 'Simplified Guidance';
  if (rhythm.includes('forget') || rhythm.includes('habit')) return 'Habit-Building Focus';
  if (rhythm.includes('changes')) return 'Flexible Routine';
  if (rhythm.includes('not sure') || rhythm.includes('confusing')) return 'Simplified Guidance';
  return 'Consistent Support';
};

const getTypePreferenceLabel = (types: string[]) => {
  if (types.length === 1) return types[0];
  return 'Comprehensive (All Types)';
};

const getCoreObjectiveLabel = (goals: string[]) => {
  if (goals.length === 1) return goals[0];
  if (goals.length > 1) return 'General Wellness';
  return 'General Wellness';
};

type SummaryChipProps = {
  label: string;
  tone?: 'neutral' | 'purple' | 'danger';
};

function SummaryChip({ label, tone = 'neutral' }: SummaryChipProps) {
  return (
    <View
      style={[
        styles.summaryChip,
        tone === 'purple' ? styles.summaryChipPurple : null,
        tone === 'danger' ? styles.summaryChipDanger : null,
      ]}
    >
      <Text
        style={[
          styles.summaryChipText,
          tone === 'purple' ? styles.summaryChipTextPurple : null,
          tone === 'danger' ? styles.summaryChipTextDanger : null,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

type TopTagProps = {
  label: string;
  withBlueDot?: boolean;
  minHeight?: number;
  horizontalPadding?: number;
  textSize?: number;
};

function TopTag({
  label,
  withBlueDot = false,
  minHeight = 31.35,
  horizontalPadding = 10.7,
  textSize = 12,
}: TopTagProps) {
  return (
    <View style={[styles.topTag, { minHeight, paddingHorizontal: horizontalPadding }]}>
      {withBlueDot ? <View style={styles.topTagDot} /> : null}
      <Text style={[styles.topTagText, { fontSize: textSize, lineHeight: textSize + 6 }]}>
        {label}
      </Text>
    </View>
  );
}

type PlanGoalCardProps = {
  title: string;
  description: string;
  items: string[];
  expanded: boolean;
  onPress: () => void;
};

function PlanGoalCard({
  title,
  description,
  items,
  expanded,
  onPress,
}: PlanGoalCardProps) {
  const progress = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, {
      duration: 360,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [expanded, progress]);

  const cardStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ['rgba(255,255,255,0.30)', 'rgba(255,255,255,0.62)'],
    ),
    borderColor: interpolateColor(
      progress.value,
      [0, 1],
      ['rgba(255,255,255,0.42)', 'rgba(59,106,247,0.20)'],
    ),
    shadowOpacity: interpolate(progress.value, [0, 1], [0.02, 0.10]),
    shadowRadius: interpolate(progress.value, [0, 1], [4, 14]),
    shadowOffset: { width: 0, height: interpolate(progress.value, [0, 1], [2, 8]) },
    elevation: interpolate(progress.value, [0, 1], [0, 6]),
  }));

  const chevronShellStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ['rgba(255,255,255,0.60)', PAGE_BLUE],
    ),
    borderColor: interpolateColor(
      progress.value,
      [0, 1],
      ['rgba(0,0,0,0.05)', PAGE_BLUE],
    ),
  }));

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(progress.value, [0, 1], [0, 180])}deg` }],
  }));

  const titleStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], ['rgba(10,21,51,0.82)', PAGE_TEXT]),
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      style={[styles.goalCard, cardStyle]}
      layout={LinearTransition.duration(360).easing(Easing.bezier(0.16, 1, 0.3, 1))}
    >
      <View style={styles.goalCardHeader}>
        <Animated.Text style={[styles.goalCardTitle, titleStyle]}>{title}</Animated.Text>
        <Animated.View style={[styles.goalChevronShell, chevronShellStyle]}>
          <AnimatedChevron
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            style={chevronStyle}
          >
            <Path
              d="M6 9L12 15L18 9"
              stroke={expanded ? '#FFFFFF' : '#6E7B97'}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </AnimatedChevron>
        </Animated.View>
      </View>

      {expanded ? (
        <Animated.View
          entering={FadeIn.duration(220)}
          exiting={FadeOut.duration(160)}
          style={styles.goalCardBody}
        >
          <Text style={styles.goalCardDescription}>{description}</Text>
          <View style={styles.goalChipWrap}>
            {items.map((item) => (
              <SummaryChip key={item} label={item} />
            ))}
          </View>
        </Animated.View>
      ) : null}
    </AnimatedPressable>
  );
}

function PlanPreviewScrollbar({
  progress,
  opacity,
  top = 8,
  bottom = 12,
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
      style={[styles.scrollbarRoot, rootStyle, { top, bottom }]}
    >
      <Animated.View
        style={[styles.scrollbarThumb, thumbStyle, { height: thumbHeight }]}
      />
    </Animated.View>
  );
}

type PlanPreviewBodyContentProps = {
  selectedAge: string;
  selectedSex: string;
  selectedExperience: string;
  selectedGoals: string[];
  selectedTypes: string[];
  adherenceBlocker?: string;
  visibleSafeguard: string | null;
  guideGoals: string[];
  expandedGoal: string;
  onSelectGoal: (goal: string) => void;
  onListScroll: any;
  scrollProgress: Animated.SharedValue<number>;
  scrollbarOpacity: Animated.SharedValue<number>;
  scrollbarBottomInset: number;
};

export function PlanPreviewBodyContent({
  selectedAge,
  selectedSex,
  selectedExperience,
  selectedGoals,
  selectedTypes,
  adherenceBlocker,
  visibleSafeguard,
  guideGoals,
  expandedGoal,
  onSelectGoal,
  onListScroll,
  scrollProgress,
  scrollbarOpacity,
  scrollbarBottomInset,
}: PlanPreviewBodyContentProps) {
  const copyZoneStyle = useOnboardingSceneZoneStyle('copy');
  const contentZoneStyle = useOnboardingSceneZoneStyle('content');
  const layoutTokens = useOnboardingLayoutTokens();
  const compactSummary = layoutTokens.density !== 'regular';
  const topTagMarginTop = compactSummary
    ? Math.max(layoutTokens.summaryCardSectionGap - 10, 4)
    : Math.max(layoutTokens.summaryCardSectionGap - 16, 6);
  const topTagGap = layoutTokens.density === 'tight' ? 5 : compactSummary ? 6 : 8;
  const topTagMinHeight = layoutTokens.density === 'tight' ? 26 : compactSummary ? 28 : 31.35;
  const topTagHorizontal = layoutTokens.density === 'tight' ? 8 : compactSummary ? 9 : 10.7;
  const topTagTextSize = layoutTokens.density === 'tight' ? 11 : compactSummary ? 11.5 : 12;
  const primaryCardTitleSize = layoutTokens.summaryCardTitleSize;
  const primaryCardTitleLineHeight = layoutTokens.summaryCardTitleLineHeight;
  const secondaryCardTitleSize = compactSummary
    ? Math.max(layoutTokens.summaryCardTitleSize - 1, 18)
    : layoutTokens.summaryCardTitleSize;
  const secondaryCardTitleLineHeight = compactSummary
    ? Math.max(layoutTokens.summaryCardTitleLineHeight - 2, secondaryCardTitleSize + 7)
    : layoutTokens.summaryCardTitleLineHeight;
  const guideBodySize = compactSummary ? 13.5 : 14;
  const guideBodyLineHeight = compactSummary ? 21.5 : 22.75;
  const goalListGap = layoutTokens.density === 'tight' ? 10 : compactSummary ? 12 : 14;
  const contentToCardGap = compactSummary
    ? Math.max(layoutTokens.summaryListGap - 2, 10)
    : layoutTokens.summaryListGap;
  const listStackGap = compactSummary
    ? Math.max(layoutTokens.summaryListGap - 2, 10)
    : layoutTokens.summaryListGap;
  const primaryCardShadowOpacity = layoutTokens.density === 'tight' ? 0.095 : compactSummary ? 0.082 : 0.04;
  const primaryCardShadowRadius = layoutTokens.density === 'tight' ? 22 : compactSummary ? 26 : 32;
  const secondaryCardShadowOpacity = layoutTokens.density === 'tight' ? 0.012 : compactSummary ? 0.018 : 0.04;
  const secondaryCardShadowRadius = layoutTokens.density === 'tight' ? 16 : compactSummary ? 20 : 32;
  const secondaryCardTitleOpacity = compactSummary ? 0.92 : 1;
  const guideBodyOpacity = compactSummary ? 0.9 : 1;
  const listBottomFadeHeight =
    layoutTokens.density === 'tight' ? 34 : layoutTokens.density === 'compact' ? 38 : 44;
  const listPaddingBottom = Math.max(
    layoutTokens.summaryListGap - 8,
    listBottomFadeHeight + (compactSummary ? 6 : 10),
  );

  return (
    <View
      style={[
        styles.content,
        {
          paddingHorizontal: layoutTokens.summaryContentPaddingX,
          paddingTop: layoutTokens.summaryContentPaddingTop,
        },
      ]}
    >
      <Animated.View style={[styles.copyBlock, copyZoneStyle]}>
        <Text style={styles.eyebrow}>Your first path</Text>
        <Text
          style={[
            styles.title,
            {
              fontSize: layoutTokens.summaryTitleSize,
              lineHeight: layoutTokens.summaryTitleLineHeight,
            },
          ]}
        >
          We found your easiest first step
        </Text>
        <Text
          style={[
            styles.subtitle,
            {
              fontSize: layoutTokens.summarySubtitleSize,
              lineHeight: layoutTokens.summarySubtitleLineHeight,
            },
          ]}
        >
          We used your goals, preferences, and routine to choose the easiest place to begin.
        </Text>
        <View
          style={[
            styles.topTagWrap,
            {
              marginTop: topTagMarginTop,
              gap: topTagGap,
              opacity: compactSummary ? 0.92 : 1,
            },
          ]}
        >
          {(selectedAge || selectedSex) ? (
            <TopTag
              label={`${selectedAge}${selectedAge && selectedSex ? ' ' : ''}${selectedSex}`.trim()}
              withBlueDot
              minHeight={topTagMinHeight}
              horizontalPadding={topTagHorizontal}
              textSize={topTagTextSize}
            />
          ) : null}
          {selectedExperience ? (
            <TopTag
              label={selectedExperience}
              minHeight={topTagMinHeight}
              horizontalPadding={topTagHorizontal}
              textSize={topTagTextSize}
            />
          ) : null}
        </View>
      </Animated.View>

      <Animated.View
        style={[
          styles.listViewport,
          contentZoneStyle,
          { marginTop: contentToCardGap },
        ]}
      >
        <Animated.ScrollView
          style={styles.listScroll}
          contentContainerStyle={[
            styles.listContent,
            {
              gap: listStackGap,
              paddingBottom: listPaddingBottom,
            },
          ]}
          showsVerticalScrollIndicator={false}
          onScroll={onListScroll}
          scrollEventThrottle={16}
        >
          <View
            style={[
              styles.focusCard,
              {
                minHeight: 0,
                paddingHorizontal: layoutTokens.summaryCardPadding,
                paddingTop: layoutTokens.summaryCardPadding,
                paddingBottom: layoutTokens.summaryCardPadding,
                shadowOpacity: primaryCardShadowOpacity,
                shadowRadius: primaryCardShadowRadius,
              },
            ]}
          >
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(255,255,255,0.64)', 'rgba(255,255,255,0.50)', 'rgba(240,245,255,0.72)']}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <PlanPreviewCornerGlow style={styles.focusGlow} />
            <View style={styles.insetHighlight} pointerEvents="none" />

            <View style={styles.cardEyebrowRow}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M6 12.5L10 16.5L18 8.5"
                  stroke={PAGE_BLUE}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <Text style={styles.cardEyebrow}>Profile engine active</Text>
            </View>

            <Text
              style={[
                styles.cardTitle,
                {
                  fontSize: primaryCardTitleSize,
                  lineHeight: primaryCardTitleLineHeight,
                },
              ]}
            >
              What will stay in focus
            </Text>

            <View
              style={[
                styles.summarySection,
                { marginTop: layoutTokens.summaryCardSectionGap },
              ]}
            >
              <Text style={styles.sectionLabel}>Core objectives</Text>
              <View style={styles.sectionValueWrap}>
                <Text style={styles.sectionValue}>{getCoreObjectiveLabel(selectedGoals)}</Text>
              </View>
            </View>

            <View
              style={[
                styles.summarySection,
                { marginTop: layoutTokens.summaryCardSectionGap },
              ]}
            >
              <Text style={styles.sectionLabel}>Lifestyle adaptation</Text>
              <View style={styles.sectionChipWrap}>
                <SummaryChip label={getRhythmAdaptation(adherenceBlocker)} tone="purple" />
              </View>
            </View>

            <View
              style={[
                styles.summarySection,
                { marginTop: layoutTokens.summaryCardSectionGap },
              ]}
            >
              <Text style={styles.sectionLabel}>Type preference</Text>
              <View style={styles.sectionValueWrap}>
                <Text style={styles.sectionValue}>{getTypePreferenceLabel(selectedTypes)}</Text>
              </View>
            </View>

            {visibleSafeguard ? (
              <View
                style={[
                  styles.summarySection,
                  { marginTop: layoutTokens.summaryCardSectionGap },
                ]}
              >
                <Text style={[styles.sectionLabel, styles.sectionLabelDanger]}>
                  Strict safeguards
                </Text>
                <View style={styles.sectionChipWrap}>
                  <SummaryChip label={visibleSafeguard} tone="danger" />
                </View>
              </View>
            ) : null}
          </View>

          <View
            style={[
              styles.guideCard,
              {
                minHeight: 0,
                paddingHorizontal: layoutTokens.summaryCardPadding,
                paddingTop: layoutTokens.summaryCardPadding,
                paddingBottom: layoutTokens.summaryCardPadding,
                shadowOpacity: secondaryCardShadowOpacity,
                shadowRadius: secondaryCardShadowRadius,
              },
            ]}
          >
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(255,255,255,0.64)', 'rgba(255,255,255,0.50)', 'rgba(247,249,255,0.84)']}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={styles.insetHighlight} pointerEvents="none" />

            <Text
              style={[
                styles.cardEyebrow,
                styles.cardEyebrowBlue,
                compactSummary ? { marginBottom: 8, opacity: 0.78 } : null,
              ]}
            >
              How NuTri will guide you
            </Text>
            <Text
              style={[
                styles.cardTitle,
                {
                  fontSize: secondaryCardTitleSize,
                  lineHeight: secondaryCardTitleLineHeight,
                  opacity: secondaryCardTitleOpacity,
                },
              ]}
            >
              How we&apos;ll build your first stack
            </Text>
            <Text
              style={[
                styles.guideBody,
                {
                  fontSize: guideBodySize,
                  lineHeight: guideBodyLineHeight,
                  maxWidth: compactSummary ? 284 : 296,
                  opacity: guideBodyOpacity,
                },
              ]}
            >
              We&apos;ve mapped your goals to clinically-backed ingredients, perfectly tailored for you.
            </Text>

            <View style={[styles.goalList, { gap: goalListGap }]}>
              {guideGoals.map((goal) => {
                const recommendation = ingredientRecommendations[goal] ?? {
                  desc: 'Supporting your routine with clinically-backed ingredients tailored to your goals.',
                  items: ['Multivitamin', 'Omega-3'],
                };
                return (
                  <PlanGoalCard
                    key={goal}
                    title={goal}
                    description={recommendation.desc}
                    items={recommendation.items}
                    expanded={expandedGoal === goal}
                    onPress={() => {
                      void Haptics.selectionAsync().catch(() => {});
                      onSelectGoal(goal);
                    }}
                  />
                );
              })}
            </View>
          </View>
        </Animated.ScrollView>

        <PlanPreviewScrollbar
          progress={scrollProgress}
          opacity={scrollbarOpacity}
          top={layoutTokens.summaryScrollbarTop}
          bottom={scrollbarBottomInset}
        />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(245,247,252,0)', PAGE_BG_BOTTOM]}
          locations={[0, 1]}
          style={[styles.listBottomFade, { height: listBottomFadeHeight }]}
        />
      </Animated.View>
    </View>
  );
}

export type PlanPreviewScreenContentProps = {
  enterDir?: 'forward' | 'back' | 'none';
  onBack: () => void | Promise<void>;
  onContinue: () => void | Promise<void>;
  disableStepSlide?: boolean;
  enableHardwareBackHandling?: boolean;
};

export function PlanPreviewScreenContent({
  enterDir = 'none',
  onBack,
  onContinue,
  disableStepSlide = false,
  enableHardwareBackHandling = true,
}: PlanPreviewScreenContentProps) {
  const { draft } = useOnboarding();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const layoutTokens = useOnboardingLayoutTokens();
  const scrollProgress = useSharedValue(0);
  const scrollbarOpacity = useSharedValue(1);

  const progressFill = useRef(new RNAnimated.Value(PAGE_PROGRESS_FILL)).current;

  useEffect(() => {
    progressFill.setValue(enterDir === 'forward' ? 86.913 : PAGE_PROGRESS_FILL);
    RNAnimated.timing(progressFill, {
      toValue: PAGE_PROGRESS_FILL,
      duration: ONBOARDING_CHROME_PROGRESS_DURATION_MS,
      easing: RNEasing.bezier(...FLOW_EASE_BEZIER),
      useNativeDriver: false,
    }).start();
  }, [enterDir, progressFill]);

  const selectedGoals = useMemo(
    () => (draft?.goals?.length ? draft.goals : [...GOAL_OPTIONS.slice(0, 2)]),
    [draft?.goals],
  );
  const [expandedGoal, setExpandedGoal] = useState<string>(selectedGoals[0] ?? 'Energy');

  useEffect(() => {
    setExpandedGoal(selectedGoals[0] ?? 'Energy');
  }, [selectedGoals]);

  const selectedTypes = draft?.preferredTypes ?? [];
  const selectedAvoid = useMemo(
    () =>
      buildAvoidItemsFromStructuredPreferences({
        avoidItems: draft?.avoidItems,
        allergyFlags: draft?.allergyFlags,
        ingredientRestrictions: draft?.ingredientRestrictions,
        noKnownAllergies: draft?.noKnownAllergies,
      }),
    [draft?.allergyFlags, draft?.avoidItems, draft?.ingredientRestrictions, draft?.noKnownAllergies],
  );
  const selectedAge = draft?.ageRange ?? '';
  const selectedSex = draft?.sex ?? draft?.gender ?? '';
  const selectedExperience = draft?.supplementExperience ?? '';

  const guideGoals = useMemo(
    () => (selectedGoals.length > 0 ? selectedGoals : ['Energy', 'Sleep']),
    [selectedGoals],
  );

  const visibleSafeguard = useMemo(() => {
    if (!selectedAvoid.length || selectedAvoid.includes('No known allergies')) return null;
    return `${selectedAvoid[0]} Free`;
  }, [selectedAvoid]);

  const handleBack = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    await onBack();
  }, [onBack]);

  useFocusEffect(
    useCallback(() => {
      if (!enableHardwareBackHandling) {
        return undefined;
      }

      const onHardwareBackPress = () => {
        void handleBack();
        return true;
      };

      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        onHardwareBackPress,
      );
      return () => subscription.remove();
    }, [enableHardwareBackHandling, handleBack]),
  );

  const handleContinue = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    await onContinue();
  }, [onContinue]);

  const fadeOutScrollbar = useCallback(() => {
    'worklet';
    cancelAnimation(scrollbarOpacity);
    scrollbarOpacity.value = withTiming(0, {
      duration: SCROLLBAR_FADE_DURATION_MS,
      delay: SCROLLBAR_HIDE_DELAY_MS,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    });
  }, [scrollbarOpacity]);

  const showScrollbar = useCallback(() => {
    'worklet';
    cancelAnimation(scrollbarOpacity);
    scrollbarOpacity.value = withTiming(1, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
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

  useEffect(() => {
    cancelAnimation(scrollbarOpacity);
    scrollbarOpacity.value = withTiming(0, {
      duration: SCROLLBAR_FADE_DURATION_MS,
      delay: 1800,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    });
  }, [scrollbarOpacity]);

  const ambientSize = width * 1.18;
  const previewFooterBottom = layoutTokens.shellFooterInset;
  const previewScrollbarBottomInset =
    previewFooterBottom +
    layoutTokens.qaCtaHeight +
    layoutTokens.qaFooterTopPadding +
    10;

  const content = (
    <View style={[styles.screen, { paddingTop: insets.top + layoutTokens.shellTopOffset }]}>
      <View
        style={[
          styles.header,
          {
            height: layoutTokens.sharedShellHeaderHeight,
            paddingHorizontal: layoutTokens.shellHorizontal,
          },
        ]}
      >
        <Pressable
          onPress={() => void handleBack()}
          style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
        >
          <BlurView
            intensity={18}
            tint="light"
            style={[StyleSheet.absoluteFillObject, styles.backBlur]}
            {...BLUR_PROPS}
          />
          <View style={styles.backStroke} pointerEvents="none" />
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path
              d="M15 18L9 12L15 6"
              stroke={PAGE_TEXT}
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>

        <View style={styles.progressTrackWrap}>
          <View style={styles.progressTrack}>
            <RNAnimated.View style={[styles.progressFill, { width: progressFill }]} />
          </View>
        </View>

        <View style={styles.headerSpacer} />
      </View>

      <PlanPreviewBodyContent
        selectedAge={selectedAge}
        selectedSex={selectedSex}
        selectedExperience={selectedExperience}
        selectedGoals={selectedGoals}
        selectedTypes={selectedTypes}
        adherenceBlocker={draft?.adherenceBlocker}
        visibleSafeguard={visibleSafeguard}
        guideGoals={guideGoals}
        expandedGoal={expandedGoal}
        onSelectGoal={setExpandedGoal}
        onListScroll={handleScroll}
        scrollProgress={scrollProgress}
        scrollbarOpacity={scrollbarOpacity}
        scrollbarBottomInset={previewScrollbarBottomInset}
      />

      <View
        style={[
          styles.footer,
          {
            paddingHorizontal: layoutTokens.shellHorizontal,
            paddingTop: layoutTokens.qaFooterTopPadding,
            paddingBottom: previewFooterBottom,
          },
        ]}
      >
        <QAContinueCTA title="See my first step" onPress={handleContinue} />
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[PAGE_BG_TOP, PAGE_BG_BOTTOM]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View
        pointerEvents="none"
        style={[
          styles.pageAmbient,
          { width: ambientSize, height: ambientSize, left: (width - ambientSize) / 2 },
        ]}
      />

      {disableStepSlide ? (
        <View style={styles.slideWrap}>{content}</View>
      ) : (
        <StepSlide
          direction={enterDir}
          slideOnFirst={false}
          mountKey={`plan-preview-${enterDir}`}
          durationMs={ONBOARDING_STEP_SLIDE_TIMING.durationMs}
          fadeDurationMs={ONBOARDING_STEP_SLIDE_TIMING.fadeDurationMs}
          distancePctOverride={ONBOARDING_STEP_SLIDE_TIMING.distancePct}
          scaleFromOverride={ONBOARDING_STEP_SLIDE_TIMING.scaleFrom}
          style={styles.slideWrap}
        >
          {content}
        </StepSlide>
      )}
    </View>
  );
}

export default function PlanPreviewScreen() {
  const router = useRouter();
  const { draft, saveDraft } = useOnboarding();
  const { setDirection, consumeDirection } = useTransitionDir();

  const enterDir = useMemo(() => {
    const direction = consumeDirection();
    return direction === 'none' ? 'none' : direction;
  }, [consumeDirection]);

  const handleBack = useCallback(async () => {
    setDirection('back');
    router.replace('/onboarding/allergy');
  }, [router, setDirection]);

  const handleContinue = useCallback(async () => {
    await saveDraft(
      {
        smartFilterConfig: buildSmartFilterConfig({
          goals: draft?.goals ?? [],
          preferredTypes: draft?.preferredTypes ?? [],
        }),
      },
      7,
    );
    setDirection('forward');
    router.replace('/onboarding/first-stack');
  }, [draft?.goals, draft?.preferredTypes, router, saveDraft, setDirection]);

  return (
    <PlanPreviewScreenContent
      enterDir={enterDir}
      onBack={handleBack}
      onContinue={handleContinue}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F6F7F9',
  },
  slideWrap: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: '#F6F7F9',
  },
  pageAmbient: {
    position: 'absolute',
    top: 86,
    borderRadius: 9999,
    backgroundColor: 'rgba(235,239,248,0.68)',
    opacity: 0.82,
  },
  header: {
    height: 44,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 5,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.56)',
    shadowColor: '#C7D2E6',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  backPressed: {
    transform: [{ scale: 0.97 }],
  },
  backBlur: {
    borderRadius: 999,
  },
  backStroke: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.78)',
  },
  progressTrackWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    width: PAGE_PROGRESS_TRACK,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.05)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 4.64,
    marginTop: 0.68,
    marginLeft: 0.68,
    borderRadius: 999,
    backgroundColor: PAGE_BLUE,
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  content: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 32,
    paddingTop: 24,
  },
  copyBlock: {
    alignItems: 'flex-start',
  },
  eyebrow: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: PAGE_MUTED,
  },
  title: {
    marginTop: 12,
    fontSize: 34,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -1.21,
    color: PAGE_TEXT,
  },
  subtitle: {
    marginTop: 16,
    maxWidth: 314,
    fontSize: 16,
    lineHeight: 23.2,
    fontWeight: '500',
    color: PAGE_MUTED,
    letterSpacing: -0.31,
  },
  topTagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  topTag: {
    minHeight: 31.35,
    paddingHorizontal: 10.7,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderWidth: 0.678,
    borderColor: 'rgba(0,0,0,0.03)',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topTagDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: PAGE_BLUE,
    opacity: 0.5,
  },
  topTagText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: PAGE_MUTED,
  },
  listViewport: {
    flex: 1,
    minHeight: 0,
    marginTop: 24,
  },
  listScroll: {
    flex: 1,
  },
  listBottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  listContent: {
    gap: 24,
    paddingBottom: 16,
  },
  focusCard: {
    minHeight: 459,
    borderRadius: 32,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 0.678,
    borderColor: 'rgba(255,255,255,0.8)',
    backgroundColor: 'rgba(255,255,255,0.5)',
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
  },
  focusGlow: {
    position: 'absolute',
    top: -78,
    right: -40,
  },
  insetHighlight: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 32,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.95)',
  },
  cardEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardEyebrow: {
    fontSize: 11,
    lineHeight: 16.5,
    fontWeight: '700',
    letterSpacing: 1.16,
    textTransform: 'uppercase',
    color: PAGE_MUTED,
  },
  cardEyebrowBlue: {
    color: PAGE_BLUE,
    marginBottom: 12,
  },
  cardTitle: {
    marginTop: 14,
    fontSize: 22,
    lineHeight: 33,
    fontWeight: '700',
    letterSpacing: -0.7,
    color: PAGE_TEXT,
  },
  summarySection: {
    marginTop: 24,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 13,
    lineHeight: 19.5,
    fontWeight: '700',
    letterSpacing: 0.57,
    textTransform: 'uppercase',
    color: PAGE_MUTED,
  },
  sectionLabelDanger: {
    color: 'rgba(255,32,86,0.8)',
  },
  sectionValueWrap: {
    minHeight: 33.6,
    justifyContent: 'center',
  },
  sectionValue: {
    fontSize: 13.5,
    lineHeight: 20.25,
    fontWeight: '500',
    color: 'rgba(10,21,51,0.8)',
    letterSpacing: -0.11,
  },
  sectionChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryChip: {
    minHeight: 32.84,
    paddingHorizontal: 14,
    borderRadius: 999,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 0.678,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  summaryChipPurple: {
    backgroundColor: 'rgba(139,92,246,0.10)',
    borderColor: 'rgba(139,92,246,0.20)',
  },
  summaryChipDanger: {
    backgroundColor: 'rgba(255,32,86,0.10)',
    borderColor: 'rgba(255,32,86,0.30)',
    shadowColor: '#000000',
    shadowOpacity: 0.10,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  summaryChipText: {
    fontSize: 13.5,
    lineHeight: 20.25,
    fontWeight: '500',
    letterSpacing: -0.11,
    color: PAGE_MUTED,
  },
  summaryChipTextPurple: {
    fontWeight: '600',
    color: '#8B5CF6',
  },
  summaryChipTextDanger: {
    fontWeight: '700',
    color: '#EC003F',
  },
  guideCard: {
    minHeight: 482,
    borderRadius: 32,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 0.678,
    borderColor: 'rgba(255,255,255,0.8)',
    backgroundColor: 'rgba(255,255,255,0.5)',
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
  },
  guideBody: {
    marginTop: 8,
    maxWidth: 296,
    fontSize: 14,
    lineHeight: 22.75,
    fontWeight: '400',
    letterSpacing: -0.15,
    color: PAGE_MUTED,
  },
  goalList: {
    marginTop: 24,
    gap: 12,
  },
  goalCard: {
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 0.678,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
  },
  goalCardHeader: {
    minHeight: 60,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  goalCardTitle: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    letterSpacing: -0.63,
    color: PAGE_TEXT,
  },
  goalChevronShell: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderWidth: 0.678,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  goalCardBody: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 16,
  },
  goalCardDescription: {
    maxWidth: 250,
    fontSize: 13.5,
    lineHeight: 21.94,
    fontWeight: '400',
    letterSpacing: -0.11,
    color: PAGE_MUTED,
  },
  goalChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  scrollbarRoot: {
    position: 'absolute',
    right: 6,
    width: 6,
  },
  scrollbarThumb: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: 999,
    backgroundColor: 'rgba(79,125,255,0.72)',
    shadowColor: PAGE_BLUE,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
});
