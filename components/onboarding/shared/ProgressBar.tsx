import React, { useCallback, useEffect, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { onboardingPalette } from './theme';

type ProgressBarProps = {
  step: number;
  total?: number;
  width?: number;
};

export const ProgressBar = ({ step, total = 10, width = 110 }: ProgressBarProps) => {
  const [containerWidth, setContainerWidth] = useState(0);
  const progressWidth = useSharedValue(0);

  useEffect(() => {
    if (!containerWidth || total <= 0) return;
    const clampedStep = Math.min(Math.max(step, 0), total);
    progressWidth.value = withTiming((clampedStep / total) * containerWidth, {
      duration: 700,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [containerWidth, progressWidth, step, total]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: progressWidth.value,
  }));

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  }, []);

  return (
    <View style={[styles.track, { width }]} onLayout={handleLayout}>
      <Animated.View style={[styles.fill, animatedStyle]} />
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    height: 6,
    borderRadius: 999,
    backgroundColor: onboardingPalette.progressTrack,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: onboardingPalette.progressFill,
  },
});

export default ProgressBar;
