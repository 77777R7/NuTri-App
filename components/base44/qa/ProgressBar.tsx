import React, { useEffect, useRef } from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, View } from 'react-native';

import { colors } from '@/lib/theme';

type ProgressBarProps = {
  currentStep: number;
  totalSteps: number;
};

export const ProgressBar = ({ currentStep, totalSteps }: ProgressBarProps) => {
  const progress = Math.min(Math.max(currentStep / totalSteps, 0), 1);
  const animatedWidth = useRef(new Animated.Value(0)).current;
  const trackWidth = useRef(0);

  useEffect(() => {
    if (!trackWidth.current) return;
    Animated.timing(animatedWidth, {
      toValue: trackWidth.current * progress,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }, [animatedWidth, progress]);

  const handleLayout = (event: LayoutChangeEvent) => {
    trackWidth.current = event.nativeEvent.layout.width;
    animatedWidth.setValue(trackWidth.current * progress);
  };

  return (
    <View style={styles.track} onLayout={handleLayout}>
      <Animated.View style={[styles.fill, { width: animatedWidth }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#E5F8F0',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.brand,
    borderRadius: 999,
  },
});
