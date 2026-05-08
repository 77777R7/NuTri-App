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
const FEATURE_CHIPS = [
  'Personalized Insights',
  'NuTri Score',
  'Deep Dive',
] as const;

type SolutionIntroScreenProps = {
  onScan: () => void | Promise<void>;
};

export function SolutionIntroScreen({ onScan }: SolutionIntroScreenProps) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const isCompactHeight = height < 760;
  const isNarrowWidth = width < 380;
  const buttonWidth = Math.min(Math.max(width - 48, 0), 392);
  const footerBottomPadding = Math.max(insets.bottom, 18) + 10;
  const cardButtonGap = Math.min(
    46,
    Math.max(isCompactHeight ? 18 : 30, Math.round(height * 0.038)),
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

  const solutionCardMotionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(introProgress.value, [0, 0.58], [0.985, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(introProgress.value, [0.18, 0.68], [10, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const solutionTitleMotionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(introProgress.value, [0.28, 0.72], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(introProgress.value, [0.28, 0.72], [7, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const solutionCopyMotionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(introProgress.value, [0.42, 0.84], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(introProgress.value, [0.42, 0.84], [6, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const chipsMotionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(introProgress.value, [0.54, 0.92], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(introProgress.value, [0.54, 0.92], [8, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const footerMotionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(introProgress.value, [0.62, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(introProgress.value, [0.62, 1], [10, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const handleScan = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    await onScan();
  }, [onScan]);

  return (
    <View style={styles.root}>
      <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
        <Animated.View style={[styles.logoWrap, logoMotionStyle]}>
          <OnboardingLogoPill />
        </Animated.View>

        <View style={[styles.content, isCompactHeight && styles.contentCompact]}>
          <Animated.View style={titleMotionStyle}>
            <Text allowFontScaling={false} style={[styles.title, isCompactHeight && styles.titleCompact]}>
              Solution
            </Text>
          </Animated.View>

          <Animated.View
            style={[
              styles.solutionCard,
              isCompactHeight && styles.solutionCardCompact,
              solutionCardMotionStyle,
            ]}
          >
            <Animated.Text
              allowFontScaling={false}
              style={[
                styles.solutionTitle,
                isCompactHeight && styles.solutionTitleCompact,
                solutionTitleMotionStyle,
              ]}
            >
              How we{'\n'}help you?
            </Animated.Text>
            <Animated.Text
              allowFontScaling={false}
              style={[
                styles.solutionCopy,
                isCompactHeight && styles.solutionCopyCompact,
                solutionCopyMotionStyle,
              ]}
            >
              One scan turns a label{'\n'}into a clear decision.
            </Animated.Text>
          </Animated.View>

          <Animated.View
            style={[
              styles.featureSection,
              isCompactHeight && styles.featureSectionCompact,
              chipsMotionStyle,
            ]}
          >
            <Text allowFontScaling={false} style={styles.featureLabel}>
              What you’ll see:
            </Text>
            <View style={styles.chipWrap}>
              {FEATURE_CHIPS.map((label) => (
                <View key={label} style={styles.chip}>
                  <Text
                    allowFontScaling={false}
                    adjustsFontSizeToFit
                    minimumFontScale={0.86}
                    numberOfLines={1}
                    style={styles.chipText}
                  >
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          </Animated.View>
        </View>

        <Animated.View
          style={[
            styles.footer,
            { paddingTop: cardButtonGap, paddingBottom: footerBottomPadding },
            footerMotionStyle,
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan Your First Supplement"
            testID="onboarding-solution-scan"
            onPress={handleScan}
            style={({ pressed }) => [
              styles.scanButtonFrame,
              { width: buttonWidth },
              pressed && styles.scanButtonPressed,
            ]}
          >
            <View style={[styles.scanButtonSurface, { width: buttonWidth }]}>
              <Text
                allowFontScaling={false}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                numberOfLines={1}
                style={[
                  styles.scanButtonText,
                  isNarrowWidth && styles.scanButtonTextNarrow,
                ]}
              >
                Scan Your First Supplement
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
    color: '#111827',
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
  solutionCard: {
    flex: 1,
    minHeight: 0,
    borderRadius: 32,
    borderCurve: 'continuous',
    padding: 28,
    backgroundColor: '#FACC15',
  },
  solutionCardCompact: {
    padding: 24,
  },
  solutionTitle: {
    color: '#111111',
    fontFamily: SERIF_FONT,
    fontSize: 44,
    lineHeight: 50,
    fontWeight: '500',
    letterSpacing: -0.8,
  },
  solutionTitleCompact: {
    fontSize: 40,
    lineHeight: 46,
  },
  solutionCopy: {
    marginTop: 'auto',
    marginLeft: 'auto',
    paddingBottom: 8,
    color: '#111111',
    opacity: 0.9,
    fontSize: 18,
    lineHeight: 28,
    fontWeight: '700',
    textAlign: 'right',
  },
  solutionCopyCompact: {
    fontSize: 16,
    lineHeight: 24,
  },
  featureSection: {
    paddingTop: 28,
  },
  featureSectionCompact: {
    paddingTop: 20,
  },
  featureLabel: {
    color: '#1F2937',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
    marginBottom: 14,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 12,
  },
  chip: {
    minHeight: 50,
    borderRadius: 999,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F4F4',
  },
  chipText: {
    color: '#1F2937',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  footer: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  scanButtonFrame: {
    alignSelf: 'center',
  },
  scanButtonSurface: {
    height: 72,
    borderRadius: 36,
    backgroundColor: '#0D0D0D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButtonPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: '#1F2937',
  },
  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  scanButtonTextNarrow: {
    fontSize: 16,
  },
});

export default SolutionIntroScreen;
