import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated as RNAnimated,
  Easing as RNEasing,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import {
  QA_FOREGROUND,
  QA_CTA_BLACK,
  QA_GLASS_BORDER,
  QA_GLASS_WHITE,
  QA_PROGRESS_TRACK_HEIGHT,
  QA_PROGRESS_TRACK_WIDTH,
} from '@/components/onboarding/qa/qaTokens';
import { useOnboardingLayoutTokens } from '@/hooks/useOnboardingLayoutTokens';

import {
  FLOW_EASE_BEZIER,
  ONBOARDING_CHROME_PROGRESS_DURATION_MS,
} from './onboardingMotion';
import type { OnboardingFlowDirection } from './OnboardingSceneViewport';

const BLUR_PROPS =
  Platform.OS === 'android'
    ? ({ experimentalBlurMethod: 'dimezisBlurView' } as const)
    : ({} as const);

type OnboardingChromeProps = {
  chromeIdentity: string;
  progressFillWidth: number;
  handoffDirection?: OnboardingFlowDirection;
  onBack: () => void | Promise<void>;
};

export function OnboardingChrome({
  chromeIdentity,
  progressFillWidth,
  handoffDirection = 'none',
  onBack,
}: OnboardingChromeProps) {
  const insets = useSafeAreaInsets();
  const layoutTokens = useOnboardingLayoutTokens();
  const progressFill = useRef(new RNAnimated.Value(progressFillWidth)).current;
  const previousWidthRef = useRef(progressFillWidth);

  useEffect(() => {
    const previousWidth = previousWidthRef.current;
    if (previousWidth === progressFillWidth) {
      return;
    }

    progressFill.stopAnimation();
    progressFill.setValue(previousWidth);
    RNAnimated.timing(progressFill, {
      toValue: progressFillWidth,
      duration: ONBOARDING_CHROME_PROGRESS_DURATION_MS,
      easing: RNEasing.bezier(...FLOW_EASE_BEZIER),
      useNativeDriver: false,
    }).start();
    previousWidthRef.current = progressFillWidth;
  }, [progressFill, progressFillWidth]);

  void chromeIdentity;
  void handoffDirection;

  const handleBack = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    await onBack();
  }, [onBack]);

  return (
    <View
      style={[
        styles.root,
        {
          top: insets.top + layoutTokens.shellTopOffset,
          left: layoutTokens.shellHorizontal,
          right: layoutTokens.shellHorizontal,
          height: layoutTokens.sharedShellHeaderHeight,
        },
      ]}
    >
      <ChromeLayer
        progressWidth={progressFill}
        onBack={() => void handleBack()}
        interactive
      />
    </View>
  );
}

function ChromeLayer({
  progressWidth,
  onBack,
  interactive,
}: {
  progressWidth: number | RNAnimated.Value;
  onBack: () => void | Promise<void>;
  interactive: boolean;
}) {
  return (
    <View pointerEvents={interactive ? 'auto' : 'none'} style={styles.layerInner}>
      <Pressable
        onPress={() => void onBack()}
        style={({ pressed }) => [
          styles.backButtonWrap,
          styles.backButton,
          pressed && interactive && styles.backPressed,
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
          <RNAnimated.View style={[styles.progressFill, { width: progressWidth }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    zIndex: 20,
  },
  layerInner: {
    flex: 1,
    justifyContent: 'center',
  },
  backButtonWrap: {
    position: 'absolute',
    left: 0,
    top: 2,
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
    width: '100%',
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
    backgroundColor: QA_CTA_BLACK,
  },
});

export default OnboardingChrome;
