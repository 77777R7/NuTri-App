import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

const TICK_COUNT = 12;
const DURATION = 1000; // 1 rotation per second

type OrganicSpinnerProps = {
  size?: number;
  color?: string;
};

export const OrganicSpinner: React.FC<OrganicSpinnerProps> = ({ size = 40, color = '#ffffff' }) => {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(TICK_COUNT, { duration: DURATION, easing: Easing.linear }),
      -1,
      false,
    );
  }, [progress]);

  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      {Array.from({ length: TICK_COUNT }).map((_, index) => (
        <Tick
          key={index}
          index={index}
          progress={progress}
          count={TICK_COUNT}
          size={size}
          baseColor={color}
        />
      ))}
    </View>
  );
};

type TickProps = {
  index: number;
  progress: SharedValue<number>;
  count: number;
  size: number;
  baseColor: string;
};

const Tick: React.FC<TickProps> = ({ index, progress, count, size, baseColor }) => {
  const angle = (2 * Math.PI * index) / count;
  const radius = size * 0.35;

  const x = Math.sin(angle) * radius;
  const y = -Math.cos(angle) * radius;

  const animatedStyle = useAnimatedStyle(() => {
    let dist = Math.abs(progress.value - index);
    if (dist > count / 2) dist = count - dist;

    const scale = interpolate(dist, [0, 2, 4], [1.6, 1.0, 0.8], Extrapolation.CLAMP);
    const opacity = interpolate(dist, [0, 2, 5], [1.0, 0.6, 0.3], Extrapolation.CLAMP);

    return {
      opacity,
      transform: [
        { translateX: x },
        { translateY: y },
        { rotate: `${angle}rad` },
        { scaleY: scale },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.tick,
        {
          backgroundColor: baseColor,
          width: size * 0.08,
          height: size * 0.2,
          position: 'absolute',
          borderRadius: 4,
        },
        animatedStyle,
      ]}
    />
  );
};

const styles = StyleSheet.create({
  tick: {},
});
