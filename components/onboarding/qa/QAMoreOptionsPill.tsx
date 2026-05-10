import React, { useEffect } from 'react';
import {
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ChevronDown } from 'lucide-react-native';

const BLUR_PROPS =
  Platform.OS === 'android'
    ? ({ experimentalBlurMethod: 'dimezisBlurView' } as const)
    : ({} as const);

type QAMoreOptionsPillProps = {
  expanded: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

export function QAMoreOptionsPill({
  expanded,
  onPress,
  style,
}: QAMoreOptionsPillProps) {
  const progress = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, {
      duration: 600,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [expanded, progress]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [
      {
        rotate: `${interpolate(progress.value, [0, 1], [0, 180])}deg`,
      },
    ],
  }));

  return (
    <View style={[styles.frame, style]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Hide options' : 'More options'}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      >
        <View style={styles.clipShell}>
          <BlurView
            intensity={18}
            tint="light"
            style={[StyleSheet.absoluteFillObject, styles.blur]}
            {...BLUR_PROPS}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(240,245,255,0.96)', 'rgba(220,232,255,0.72)']}
            start={{ x: 0.18, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View pointerEvents="none" style={styles.stroke} />
          <View pointerEvents="none" style={styles.insetHighlight} />

          <Text allowFontScaling={false} style={styles.label}>
            {expanded ? 'Hide options' : 'More options'}
          </Text>

          <Animated.View style={chevronStyle}>
            <ChevronDown size={16} color="#2445B8" strokeWidth={2.25} />
          </Animated.View>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 153,
    height: 43,
    borderRadius: 999,
    shadowColor: '#000000',
    shadowOpacity: 0.03,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  pressable: {
    borderRadius: 999,
  },
  pressed: {
    transform: [{ scale: 0.985 }],
  },
  clipShell: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(220,232,255,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  blur: {
    borderRadius: 999,
  },
  stroke: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.26)',
  },
  insetHighlight: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    shadowColor: '#FFFFFF',
    shadowOpacity: 1,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 1 },
  },
  label: {
    fontSize: 14.5,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.48,
    color: '#2445B8',
    textAlign: 'center',
  },
});

export default QAMoreOptionsPill;
