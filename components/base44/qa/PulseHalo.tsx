import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

type PulseHaloProps = {
  size?: number;
  color?: string;
  label?: string;
};

const DEFAULT_COLOR = '#10B981';

export const PulseHalo = ({ size = 96, color = DEFAULT_COLOR, label = 'Nu' }: PulseHaloProps) => {
  const radius = size / 2;

  const [reduceMotion, setReduceMotion] = useState(false);

  const scale1 = useSharedValue(1);
  const scale2 = useSharedValue(1);
  const scale3 = useSharedValue(1);
  const opacity1 = useSharedValue(0.18);
  const opacity2 = useSharedValue(0.18);
  const opacity3 = useSharedValue(0.18);

  useEffect(() => {
    let mounted = true;
    const read = async () => {
      try {
        const value = await AccessibilityInfo.isReduceMotionEnabled?.();
        if (mounted && typeof value === 'boolean') {
          setReduceMotion(value);
        }
      } catch {
        // noop
      }
    };

    read();

    const subscription =
      AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value: boolean) => {
        if (mounted) {
          setReduceMotion(value);
        }
      }) ?? null;

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      [scale1, scale2, scale3].forEach((scale, index) => {
        cancelAnimation(scale);
        scale.value = 1 + index * 0.035;
      });
      [opacity1, opacity2, opacity3].forEach((opacity) => {
        cancelAnimation(opacity);
        opacity.value = 0.14;
      });

      return () => {
        [scale1, scale2, scale3].forEach((scale) => cancelAnimation(scale));
        [opacity1, opacity2, opacity3].forEach((opacity) => cancelAnimation(opacity));
      };
    }

    const delays = [0, 280, 560];

    [scale1, scale2, scale3].forEach((scale, index) => {
      cancelAnimation(scale);
      scale.value = withRepeat(
        withSequence(
          withDelay(delays[index], withTiming(1, { duration: 0 })),
          withTiming(1.18, { duration: 900, easing: Easing.out(Easing.cubic) }),
          withTiming(1, { duration: 900, easing: Easing.in(Easing.cubic) }),
        ),
        -1,
        false,
      );
    });

    [opacity1, opacity2, opacity3].forEach((opacity, index) => {
      cancelAnimation(opacity);
      opacity.value = withRepeat(
        withSequence(
          withDelay(delays[index], withTiming(0.22, { duration: 0 })),
          withTiming(0.08, { duration: 900, easing: Easing.out(Easing.cubic) }),
          withTiming(0.22, { duration: 900, easing: Easing.in(Easing.cubic) }),
        ),
        -1,
        false,
      );
    });

    return () => {
      [scale1, scale2, scale3].forEach((scale) => cancelAnimation(scale));
      [opacity1, opacity2, opacity3].forEach((opacity) => cancelAnimation(opacity));
    };
  }, [opacity1, opacity2, opacity3, reduceMotion, scale1, scale2, scale3]);

  const ringStyles = [
    useAnimatedStyle(() => ({
      transform: [{ scale: scale1.value }],
      opacity: opacity1.value,
    })),
    useAnimatedStyle(() => ({
      transform: [{ scale: scale2.value }],
      opacity: opacity2.value,
    })),
    useAnimatedStyle(() => ({
      transform: [{ scale: scale3.value }],
      opacity: opacity3.value,
    })),
  ];

  return (
    <View
      style={{
        width: size * 2.2,
        height: size * 2.2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {ringStyles.map((style, index) => (
        <Animated.View
          key={`halo-${index}`}
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: size,
              height: size,
              borderRadius: radius,
              backgroundColor: color,
            },
            style,
          ]}
        />
      ))}

      <View
        pointerEvents="none"
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: color,
          shadowOpacity: Platform.OS === 'ios' ? 0.35 : 0.25,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 16 },
          elevation: 12,
        }}
      >
        <Text
          style={{
            color: '#FFFFFF',
            fontSize: Math.round(size * 0.38),
            fontWeight: '900',
            letterSpacing: 0.5,
          }}
        >
          {label}
        </Text>
      </View>
    </View>
  );
};

export default PulseHalo;
