import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const AnimatedPulse = () => {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [progress]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + progress.value * 0.4,
  }));

  return <Animated.View style={[styles.pulse, pulseStyle]} />;
};

const hasWorklets = typeof globalThis !== 'undefined' && typeof (globalThis as Record<string, unknown>).__reanimatedWorkletInit === 'function';

export const OnboardingSkeleton = () => {
  useEffect(() => {
    console.log('🦴 OnboardingSkeleton active');
  }, []);

  if (!hasWorklets) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AnimatedPulse />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#f8fafc',
  },
  pulse: {
    width: '100%',
    height: 180,
    borderRadius: 24,
    backgroundColor: '#e2e8f0',
  },
});

export default OnboardingSkeleton;
