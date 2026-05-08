import React, { useCallback, useEffect } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { OnboardingLogoPill } from '@/components/onboarding/welcome/OnboardingLogoPill';

const SERIF_FONT = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});
const INTRO_EASING = Easing.bezier(0.16, 1, 0.3, 1);

type ProblemIntroScreenProps = {
  onNext: () => void | Promise<void>;
};

export function ProblemIntroScreen({ onNext }: ProblemIntroScreenProps) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const isCompactHeight = height < 760;
  const buttonWidth = Math.min(Math.max(width - 48, 0), 392);
  const footerBottomPadding = Math.max(insets.bottom, 18) + 10;
  const cardButtonGap = Math.min(
    48,
    Math.max(isCompactHeight ? 22 : 34, Math.round(height * 0.045)),
  );
  const introProgress = useSharedValue(0);

  useEffect(() => {
    introProgress.value = 0;
    introProgress.value = withTiming(1, {
      duration: 560,
      easing: INTRO_EASING,
    });
  }, [introProgress]);

  const logoMotionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(introProgress.value, [0, 0.28], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(introProgress.value, [0, 0.28], [-6, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const titleMotionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(introProgress.value, [0.08, 0.42], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(introProgress.value, [0.08, 0.42], [8, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const promptMotionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(introProgress.value, [0.18, 0.54], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(introProgress.value, [0.18, 0.54], [10, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const whyCardMotionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(introProgress.value, [0, 0.62], [0.985, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(introProgress.value, [0.22, 0.7], [10, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const whyTitleMotionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(introProgress.value, [0.34, 0.78], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(introProgress.value, [0.34, 0.78], [7, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const whyCopyMotionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(introProgress.value, [0.5, 0.9], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(introProgress.value, [0.5, 0.9], [6, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const footerMotionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(introProgress.value, [0.58, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(introProgress.value, [0.58, 1], [10, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const handleNext = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    await onNext();
  }, [onNext]);

  return (
    <View style={styles.root}>
      <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
        <Animated.View style={[styles.logoWrap, logoMotionStyle]}>
          <OnboardingLogoPill />
        </Animated.View>

        <View style={[styles.content, isCompactHeight && styles.contentCompact]}>
          <Animated.View style={titleMotionStyle}>
            <Text allowFontScaling={false} style={[styles.title, isCompactHeight && styles.titleCompact]}>
              Problem
            </Text>
          </Animated.View>

          <Animated.View
            style={[
              styles.promptBlock,
              isCompactHeight && styles.promptBlockCompact,
              promptMotionStyle,
            ]}
          >
            <Text allowFontScaling={false} style={styles.promptTitle}>
              Labels only go so far
            </Text>
            <View style={[styles.promptPreview, isCompactHeight && styles.promptPreviewCompact]}>
              <Text allowFontScaling={false} style={styles.promptText}>
                Ingredients are listed. Fit, safety, and context are not.
              </Text>
            </View>
          </Animated.View>

          <Animated.View
            style={[
              styles.whyCard,
              isCompactHeight && styles.whyCardCompact,
              whyCardMotionStyle,
            ]}
          >
            <Animated.Text
              allowFontScaling={false}
              style={[styles.whyTitle, whyTitleMotionStyle]}
            >
              Why{'\n'}NuTri ?
            </Animated.Text>
            <Animated.Text
              allowFontScaling={false}
              style={[styles.whyCopy, whyCopyMotionStyle]}
            >
              Less guessing.{'\n'}Smarter supplement decisions.
            </Animated.Text>
          </Animated.View>
        </View>

        <Animated.View
          style={[
            styles.footer,
            isCompactHeight && styles.footerCompact,
            { paddingTop: cardButtonGap, paddingBottom: footerBottomPadding },
            footerMotionStyle,
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next step"
            testID="onboarding-problem-next"
            onPress={handleNext}
            style={({ pressed }) => [
              styles.nextButtonFrame,
              { width: buttonWidth },
              pressed && styles.nextButtonPressed,
            ]}
          >
            <View style={[styles.nextButtonSurface, { width: buttonWidth }]}>
              <Text allowFontScaling={false} style={styles.nextButtonText}>
                Next step
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  screen: {
    flex: 1,
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#FFFFFF',
  },
  logoWrap: {
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  content: {
    flex: 1,
    paddingTop: 16,
  },
  contentCompact: {
    paddingTop: 12,
  },
  title: {
    color: '#1A1A1A',
    fontFamily: SERIF_FONT,
    fontSize: 40,
    lineHeight: 64,
    fontWeight: '500',
    letterSpacing: -0.8,
    paddingTop: 8,
    marginBottom: 12,
  },
  titleCompact: {
    fontSize: 38,
    lineHeight: 58,
    paddingTop: 4,
    marginBottom: 10,
  },
  promptBlock: {
    backgroundColor: '#F6F6F6',
    borderRadius: 32,
    padding: 20,
  },
  promptBlockCompact: {
    padding: 18,
  },
  promptTitle: {
    color: '#1F2937',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    marginBottom: 16,
    paddingLeft: 4,
  },
  promptPreview: {
    backgroundColor: '#EBEBEB',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  promptPreviewCompact: {
    paddingVertical: 16,
  },
  promptText: {
    color: '#6B7280',
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '500',
  },
  whyCard: {
    flex: 1,
    minHeight: 0,
    marginTop: 20,
    borderRadius: 32,
    padding: 28,
    backgroundColor: '#1E40AF',
  },
  whyCardCompact: {
    minHeight: 0,
    marginTop: 18,
  },
  whyTitle: {
    marginTop: 4,
    color: '#FFFFFF',
    fontFamily: SERIF_FONT,
    fontSize: 44,
    lineHeight: 50,
    fontWeight: '500',
    letterSpacing: -0.8,
  },
  whyCopy: {
    marginTop: 'auto',
    marginLeft: 'auto',
    paddingBottom: 8,
    color: '#FFFFFF',
    opacity: 0.92,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
    textAlign: 'right',
  },
  footer: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  footerCompact: {
    minHeight: 0,
  },
  nextButtonFrame: {
    alignSelf: 'center',
  },
  nextButtonSurface: {
    height: 72,
    borderRadius: 36,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextButtonPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: '#1F2937',
  },
  nextButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
  },
});

export default ProblemIntroScreen;
