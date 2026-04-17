import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  QA_CTA_DISABLED_SCALE,
  QA_CTA_ENABLED_LIFT_Y,
  QA_CTA_STATE_DURATION_MS,
} from '@/components/onboarding/flow/onboardingMotion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { QA_ACTIVE_BLUE } from './qaTokens';
import { useOnboardingLayoutTokens } from '@/hooks/useOnboardingLayoutTokens';

type QAContinueCTAProps = {
  title: string;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  showLabel?: boolean;
  children?: ReactNode;
};

export function QAContinueCTA({
  title,
  onPress,
  disabled = false,
  showLabel = true,
  children,
}: QAContinueCTAProps) {
  const layoutTokens = useOnboardingLayoutTokens();
  const reduceMotion = useReducedMotion();
  const enabledProgress = useSharedValue(disabled ? 0 : 1);

  useEffect(() => {
    if (reduceMotion) {
      enabledProgress.value = disabled ? 0 : 1;
      return;
    }

    enabledProgress.value = withTiming(disabled ? 0 : 1, {
      duration: QA_CTA_STATE_DURATION_MS,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [disabled, enabledProgress, reduceMotion]);

  const outerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(enabledProgress.value, [0, 1], [0.9, 1]),
  }));

  const buttonStateStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(enabledProgress.value, [0, 1], [0.06, 0.18]),
    shadowRadius: interpolate(enabledProgress.value, [0, 1], [8, 13]),
    shadowOffset: {
      width: 0,
      height: interpolate(enabledProgress.value, [0, 1], [4, 7]),
    },
    elevation: interpolate(enabledProgress.value, [0, 1], [8, 13]),
    transform: [
      {
        translateY: interpolate(
          enabledProgress.value,
          [0, 1],
          [0, QA_CTA_ENABLED_LIFT_Y],
        ),
      },
      {
        scale: interpolate(
          enabledProgress.value,
          [0, 1],
          [QA_CTA_DISABLED_SCALE, 1],
        ),
      },
    ],
  }));

  const enabledLayerStyle = useAnimatedStyle(() => ({
    opacity: enabledProgress.value,
  }));

  const disabledLayerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(enabledProgress.value, [0, 1], [1, 0]),
  }));

  return (
    <Animated.View style={[styles.outer, outerStyle]}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={title}
        style={({ pressed }) => [styles.pressable, pressed && !disabled && styles.pressed]}
      >
        <Animated.View
          style={[
            styles.buttonFrame,
            { height: layoutTokens.qaCtaHeight },
            buttonStateStyle,
          ]}
        >
          <View style={styles.clipShell}>
            <Animated.View pointerEvents="none" style={[styles.fill, disabledLayerStyle]}>
              <LinearGradient
                colors={['#B7C7EF', '#AEC0EA', '#A6B8E5']}
                locations={[0, 0.52, 1]}
                start={{ x: 0.14, y: 0.06 }}
                end={{ x: 0.92, y: 0.96 }}
                style={styles.fill}
              />
            </Animated.View>

            <Animated.View pointerEvents="none" style={[styles.fill, enabledLayerStyle]}>
              <LinearGradient
                colors={['#6F98F8', '#638CEE', '#5782E8']}
                locations={[0, 0.52, 1]}
                start={{ x: 0.14, y: 0.06 }}
                end={{ x: 0.92, y: 0.96 }}
                style={styles.fill}
              />
            </Animated.View>

            <Animated.View pointerEvents="none" style={[styles.topCap, disabledLayerStyle]}>
              <LinearGradient
                colors={[
                  'rgba(255,255,255,0.12)',
                  'rgba(255,255,255,0.04)',
                  'rgba(255,255,255,0)',
                ]}
                locations={[0, 0.56, 1]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
            </Animated.View>
            <Animated.View pointerEvents="none" style={[styles.topCap, enabledLayerStyle]}>
              <LinearGradient
                colors={[
                  'rgba(255,255,255,0.22)',
                  'rgba(255,255,255,0.08)',
                  'rgba(255,255,255,0)',
                ]}
                locations={[0, 0.56, 1]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
            </Animated.View>
            <View style={styles.outerStroke} pointerEvents="none" />

            {children ? children : null}
            {showLabel ? (
              <Text
                allowFontScaling={false}
                style={[
                  styles.text,
                  {
                    fontSize: layoutTokens.qaCtaLabelSize,
                    lineHeight: layoutTokens.qaCtaLabelLineHeight,
                  },
                ]}
              >
                {title}
              </Text>
            ) : null}
          </View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: '100%',
    maxWidth: 392,
    alignSelf: 'center',
  },
  pressable: {
    width: '100%',
  },
  buttonFrame: {
    borderRadius: 999,
    backgroundColor: 'transparent',
    shadowColor: QA_ACTIVE_BLUE,
    shadowOpacity: 0.15,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  clipShell: {
    flex: 1,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: QA_ACTIVE_BLUE,
  },
  pressed: {
    transform: [{ scale: 0.986 }],
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
  },
  topCap: {
    position: 'absolute',
    left: 26,
    right: 26,
    top: 5,
    height: 12,
    borderRadius: 999,
  },
  outerStroke: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  text: {
    fontWeight: '600',
    letterSpacing: -0.45,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
