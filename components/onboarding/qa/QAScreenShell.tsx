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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import Animated from 'react-native-reanimated';

import { StepSlide } from '@/components/animation/StepSlide';
import { useTransitionDir } from '@/contexts/TransitionContext';

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
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { consumeDirection } = useTransitionDir();

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
      duration: 420,
      easing: RNEasing.bezier(0.16, 1, 0.3, 1),
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
        <View style={[styles.screen, { paddingTop: insets.top + 10 }]}>
          <View style={styles.header}>
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

          <View style={styles.content}>
            <View style={styles.copyBlock}>
              {eyebrow ? (
                <Text allowFontScaling={false} style={styles.eyebrow}>
                  {eyebrow}
                </Text>
              ) : null}
              <Text allowFontScaling={false} style={styles.title}>
                {title}
              </Text>
              {subtitle ? (
                <Text allowFontScaling={false} style={styles.subtitle}>
                  {subtitle}
                </Text>
              ) : null}
            </View>

            <View style={styles.listViewport}>
              <Animated.ScrollView
                style={styles.listScroll}
                contentContainerStyle={[
                  styles.listContent,
                  listContentContainerStyle,
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
            </View>
          </View>

          <View
            style={[
              styles.footer,
              {
                paddingBottom: Math.max(insets.bottom, 18) + 10,
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
              <View style={styles.helperZone}>
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
              <View style={styles.skipZone}>
                <Pressable
                  onPress={() => void handleSkip()}
                  style={({ pressed }) => [
                    styles.skipWrap,
                    pressed && styles.skipPressed,
                  ]}
                >
                  <Text allowFontScaling={false} style={styles.skipText}>
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
      durationMs={420}
      fadeDurationMs={420}
      distancePctOverride={0.018}
      scaleFromOverride={1}
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
    backgroundColor: '#4D6EFF',
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  content: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 32,
    paddingTop: 48,
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
    marginBottom: 14,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 34,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -1.6,
    color: QA_FOREGROUND,
  },
  subtitle: {
    marginTop: 16,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '500',
    color: QA_MUTED,
  },
  listViewport: {
    flex: 1,
    minHeight: 0,
    marginTop: 38,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    gap: 14,
    paddingBottom: 12,
  },
  listOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  buttonZone: {
    width: '100%',
  },
  helperZone: {
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
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
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 12,
  },
  skipWrap: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  skipPressed: {
    transform: [{ scale: 0.98 }],
  },
  skipText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: 'rgba(122,133,159,0.9)',
    textAlign: 'center',
  },
});

export default QAScreenShell;
