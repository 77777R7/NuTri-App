import React, { useCallback, useEffect, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors } from '@/lib/theme';

type ProgressBarProps = {
  step: number;
  total?: number;
};

export const ProgressBar = ({ step, total = 7 }: ProgressBarProps) => {
  const [containerWidth, setContainerWidth] = useState(0);
  const progressWidth = useSharedValue(0);

  useEffect(() => {
    if (!containerWidth || total <= 0) return;

    const clampedStep = Math.min(Math.max(step, 0), total);
    const nextWidth = (clampedStep / total) * containerWidth;

    progressWidth.value = withTiming(nextWidth, {
      duration: 420,
      easing: Easing.out(Easing.cubic),
    });
  }, [containerWidth, step, total, progressWidth]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      width: progressWidth.value,
    };
  }, []);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  }, []);

  return (
    <View style={styles.track} onLayout={handleLayout}>
      <Animated.View style={[styles.fill, animatedStyle]} />
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#E2F4EE',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
});

export default ProgressBar;
