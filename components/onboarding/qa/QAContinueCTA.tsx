import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
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
    opacity: interpolate(enabledProgress.value, [0, 1], [0.46, 1]),
  }));

  const buttonStateStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(enabledProgress.value, [0, 1], [0.03, 0.12]),
    shadowRadius: interpolate(enabledProgress.value, [0, 1], [6, 14]),
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
              <View style={styles.disabledFill} />
            </Animated.View>

            <Animated.View pointerEvents="none" style={[styles.fill, enabledLayerStyle]}>
              <View style={styles.enabledFill} />
            </Animated.View>

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
    shadowColor: '#0D0D0D',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
    elevation: 10,
  },
  clipShell: {
    flex: 1,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0D0D0D',
  },
  pressed: {
    transform: [{ scale: 0.986 }],
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
  },
  disabledFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    backgroundColor: '#0D0D0D',
  },
  enabledFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    backgroundColor: '#0D0D0D',
  },
  text: {
    fontWeight: '600',
    letterSpacing: -0.45,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
