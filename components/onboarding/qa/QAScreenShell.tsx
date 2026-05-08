import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated as RNAnimated,
  BackHandler,
  Easing as RNEasing,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import Animated from 'react-native-reanimated';

import { StepSlide } from '@/components/animation/StepSlide';
import {
  FLOW_EASE_BEZIER,
  ONBOARDING_CHROME_PROGRESS_DURATION_MS,
  ONBOARDING_STEP_SLIDE_TIMING,
} from '@/components/onboarding/flow/onboardingMotion';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { useOnboardingLayoutTokens } from '@/hooks/useOnboardingLayoutTokens';

import { QAContinueCTA } from './QAContinueCTA';
import {
  getQaProgressFillWidth,
  QA_BG,
  QA_BG_BOTTOM,
  QA_BG_TOP,
  QA_EYEBROW,
  QA_FOREGROUND,
  QA_GLASS_BORDER,
  QA_GLASS_WHITE,
  QA_MUTED,
  QA_PROGRESS_TRACK_HEIGHT,
  QA_PROGRESS_TRACK_WIDTH,
  QA_SERIF_FONT,
} from './qaTokens';

const BLUR_PROPS =
  Platform.OS === 'android'
    ? ({ experimentalBlurMethod: 'dimezisBlurView' } as const)
    : ({} as const);

type QAScreenShellProps = {
  screenKey: string;
  qaStepIndex: number;
  transitionDirection?: 'forward' | 'back' | 'none';
  disableStepSlide?: boolean;
  enableHardwareBackHandling?: boolean;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onBack: () => void | Promise<void>;
  onContinue: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
  continueLabel?: string;
  continueDisabled?: boolean;
  footerHint?: string;
  footerError?: string | null;
  progressFillWidthOverride?: number;
  onListScroll?: any;
  listScrollEventThrottle?: number;
  listOverlay?: React.ReactNode;
  listContentContainerStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

export function QAScreenShell({
  screenKey,
  qaStepIndex,
  transitionDirection,
  disableStepSlide = false,
  enableHardwareBackHandling = true,
  eyebrow,
  title,
  subtitle,
  onBack,
  onContinue,
  onSkip,
  continueLabel = 'Continue',
  continueDisabled = false,
  footerHint,
  footerError,
  progressFillWidthOverride,
  onListScroll,
  listScrollEventThrottle = 16,
  listOverlay,
  listContentContainerStyle,
  children,
}: QAScreenShellProps) {
  const { width } = useWindowDimensions();
  const { consumeDirection } = useTransitionDir();
  const layoutTokens = useOnboardingLayoutTokens();
  const titleLineCount = title.split('\n').length;
  const useTightTitle = layoutTokens.density === 'tight' || titleLineCount >= 2 || title.length >= 26;
  const titleSize = useTightTitle
    ? Math.max(layoutTokens.qaTitleSize - 2, 26)
    : layoutTokens.qaTitleSize;
  const titleLineHeight = useTightTitle
    ? Math.max(layoutTokens.qaTitleLineHeight - 2, titleSize + 2)
    : layoutTokens.qaTitleLineHeight;
  const subtitleMarginTop = useTightTitle
    ? Math.max(layoutTokens.qaSubtitleMarginTop - 2, 8)
    : layoutTokens.qaSubtitleMarginTop;
  const copyToListGap = useTightTitle
    ? Math.max(layoutTokens.qaCopyToListGap - 2, 10)
    : layoutTokens.qaCopyToListGap;
  const footerBottomPadding = layoutTokens.shellFooterInset;
  const helperMinHeight = footerError || footerHint ? 24 : 0;
  const listBottomFadeHeight =
    layoutTokens.density === 'tight' ? 30 : layoutTokens.density === 'compact' ? 34 : 40;
  const requestedListPaddingBottom = StyleSheet.flatten(listContentContainerStyle)?.paddingBottom;
  const listPaddingBottom = Math.max(
    layoutTokens.qaListGap - 2,
    listBottomFadeHeight + layoutTokens.qaListGap,
    typeof requestedListPaddingBottom === 'number' ? requestedListPaddingBottom : 0,
  );

  const enterDir = useMemo(() => {
    if (transitionDirection) {
      return transitionDirection;
    }
    const direction = consumeDirection();
    return direction === 'none' ? 'none' : direction;
  }, [consumeDirection, transitionDirection]);

  const handleBack = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    await onBack();
  }, [onBack]);

  const handleContinue = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    await onContinue();
  }, [onContinue]);

  const handleSkip = useCallback(async () => {
    if (!onSkip) return;

    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    await onSkip();
  }, [onSkip]);

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

  const ambientSize = width * 1.22;
  const progressFillWidth =
    progressFillWidthOverride ?? getQaProgressFillWidth(qaStepIndex);
  const progressFill = useRef(
    new RNAnimated.Value(progressFillWidth),
  ).current;

  useEffect(() => {
    const previousWidth =
      progressFillWidthOverride ??
      getQaProgressFillWidth(Math.max(1, qaStepIndex - 1));
    const nextWidth =
      progressFillWidthOverride ?? getQaProgressFillWidth(qaStepIndex + 1);

    const fromWidth =
      enterDir === 'forward'
        ? previousWidth
        : enterDir === 'back'
          ? nextWidth
          : progressFillWidth;

    progressFill.setValue(fromWidth);
    RNAnimated.timing(progressFill, {
      toValue: progressFillWidth,
      duration: ONBOARDING_CHROME_PROGRESS_DURATION_MS,
      easing: RNEasing.bezier(...FLOW_EASE_BEZIER),
      useNativeDriver: false,
    }).start();
  }, [
    enterDir,
    progressFill,
    progressFillWidth,
    progressFillWidthOverride,
    qaStepIndex,
  ]);

  const content = (
    <View style={styles.root}>
      <LinearGradient
        colors={[QA_BG_TOP, QA_BG_BOTTOM]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View
        pointerEvents="none"
        style={[
          styles.pageAmbient,
          {
            width: ambientSize,
            height: ambientSize,
            left: (width - ambientSize) / 2,
          },
        ]}
      />

      <View style={styles.slideWrap}>
        <View style={[styles.screen, { paddingTop: layoutTokens.welcomeTopPadding }]}>
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
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backPressed,
              ]}
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
                  stroke={QA_FOREGROUND}
                  strokeWidth={2.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>

            <View style={styles.progressTrackWrap}>
              <View style={styles.progressTrack}>
                <RNAnimated.View
                  style={[styles.progressFill, { width: progressFill }]}
                />
              </View>
            </View>

            <View style={styles.headerSpacer} />
          </View>

          <View
            style={[
              styles.content,
              {
                paddingHorizontal: layoutTokens.qaContentPaddingX,
                paddingTop: layoutTokens.qaContentPaddingTop,
              },
            ]}
          >
            <View style={styles.copyBlock}>
              {eyebrow ? (
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.eyebrow,
                    { marginBottom: layoutTokens.qaEyebrowMarginBottom },
                  ]}
                >
                  {eyebrow}
                </Text>
              ) : null}
              <Text
                allowFontScaling={false}
                  style={[
                    styles.title,
                    {
                      fontSize: titleSize,
                      lineHeight: titleLineHeight,
                    },
                  ]}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.subtitle,
                    {
                      marginTop: subtitleMarginTop,
                      fontSize: layoutTokens.qaSubtitleSize,
                      lineHeight: layoutTokens.qaSubtitleLineHeight,
                    },
                  ]}
                >
                  {subtitle}
                </Text>
              ) : null}
            </View>

            <View style={[styles.listViewport, { marginTop: copyToListGap }]}>
              <Animated.ScrollView
                style={styles.listScroll}
                contentContainerStyle={[
                  styles.listContent,
                  {
                    gap: layoutTokens.qaListGap,
                  },
                  listContentContainerStyle,
                  { paddingBottom: listPaddingBottom },
                ]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                onScroll={onListScroll}
                scrollEventThrottle={listScrollEventThrottle}
              >
                {children}
              </Animated.ScrollView>
              {listOverlay ? (
                <View pointerEvents="none" style={styles.listOverlay}>
                  {listOverlay}
                </View>
              ) : null}
              <LinearGradient
                pointerEvents="none"
                colors={['rgba(245,247,252,0)', QA_BG_BOTTOM]}
                locations={[0, 1]}
                style={[styles.listBottomFade, { height: listBottomFadeHeight }]}
              />
            </View>
          </View>

          <View
            style={[
              styles.footer,
              {
                paddingHorizontal: layoutTokens.shellHorizontal,
                paddingTop: layoutTokens.qaFooterTopPadding,
                paddingBottom: footerBottomPadding,
              },
            ]}
          >
              <View style={styles.buttonZone}>
                <QAContinueCTA
                title={continueLabel}
                onPress={() => void handleContinue()}
                disabled={continueDisabled}
              />
            </View>

            {footerError || footerHint ? (
              <View
                style={[
                  styles.helperZone,
                  {
                    minHeight: helperMinHeight,
                    paddingTop: layoutTokens.qaFooterHelperPaddingTop,
                  },
                ]}
              >
                {footerError ? (
                  <Text allowFontScaling={false} style={styles.footerError}>
                    {footerError}
                  </Text>
                ) : null}
                {footerHint ? (
                  <Text allowFontScaling={false} style={styles.footerHint}>
                    {footerHint}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {onSkip ? (
              <View
                style={[
                  styles.skipZone,
                  {
                    minHeight: layoutTokens.qaFooterSkipMinHeight,
                    paddingTop: Math.max(layoutTokens.qaFooterTopPadding - 2, 4),
                  },
                ]}
              >
                <Pressable
                  onPress={() => void handleSkip()}
                  style={({ pressed }) => [
                    styles.skipWrap,
                    pressed && styles.skipPressed,
                  ]}
                >
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.skipText,
                      {
                        fontSize: layoutTokens.qaFooterSkipTextSize,
                        lineHeight: layoutTokens.qaFooterSkipTextLineHeight,
                      },
                    ]}
                  >
                    Skip for now
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );

  if (disableStepSlide) {
    return content;
  }

  return (
    <StepSlide
      direction={enterDir}
      slideOnFirst={false}
      mountKey={`qa-${screenKey}-${enterDir}`}
      durationMs={ONBOARDING_STEP_SLIDE_TIMING.durationMs}
      fadeDurationMs={ONBOARDING_STEP_SLIDE_TIMING.fadeDurationMs}
      distancePctOverride={ONBOARDING_STEP_SLIDE_TIMING.distancePct}
      scaleFromOverride={ONBOARDING_STEP_SLIDE_TIMING.scaleFrom}
      style={styles.slideWrap}
    >
      {content}
    </StepSlide>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: QA_BG,
  },
  slideWrap: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: QA_BG,
  },
  pageAmbient: {
    position: 'absolute',
    top: 86,
    borderRadius: 9999,
    backgroundColor: 'rgba(235,239,248,0.68)',
    opacity: 0.74,
  },
  header: {
    height: 44,
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
    backgroundColor: QA_GLASS_WHITE,
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
    borderColor: QA_GLASS_BORDER,
  },
  progressTrackWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    width: QA_PROGRESS_TRACK_WIDTH,
    height: QA_PROGRESS_TRACK_HEIGHT,
    borderRadius: 999,
    backgroundColor: 'rgba(12,21,49,0.08)',
    overflow: 'hidden',
  },
  progressFill: {
    height: QA_PROGRESS_TRACK_HEIGHT,
    borderRadius: 999,
    backgroundColor: '#111111',
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  copyBlock: {
    alignItems: 'flex-start',
  },
  eyebrow: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 2.4,
    color: QA_EYEBROW,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: QA_SERIF_FONT,
    fontWeight: '500',
    letterSpacing: 0,
    color: QA_FOREGROUND,
  },
  subtitle: {
    fontWeight: '500',
    color: QA_MUTED,
  },
  listViewport: {
    flex: 1,
    minHeight: 0,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    gap: 14,
  },
  listOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  listBottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  footer: {
    paddingTop: 12,
  },
  buttonZone: {
    width: '100%',
  },
  helperZone: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 0,
    paddingTop: 0,
  },
  footerHint: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: QA_MUTED,
    textAlign: 'center',
  },
  footerError: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#E1567A',
    textAlign: 'center',
  },
  skipZone: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: 0,
    paddingTop: 0,
  },
  skipWrap: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  skipPressed: {
    transform: [{ scale: 0.98 }],
  },
  skipText: {
    fontWeight: '600',
    color: 'rgba(122,133,159,0.9)',
    textAlign: 'center',
  },
});

export default QAScreenShell;
