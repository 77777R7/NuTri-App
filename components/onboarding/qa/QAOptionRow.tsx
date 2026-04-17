import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import {
  QA_OPTION_REVEAL_BACK_DURATION_MS,
  QA_OPTION_REVEAL_BACK_STAGGER_MS,
  QA_OPTION_REVEAL_DURATION_MS,
  QA_OPTION_REVEAL_MAX_DELAY_MS,
  QA_OPTION_REVEAL_OFFSET_Y,
  QA_OPTION_REVEAL_SCALE,
  QA_OPTION_REVEAL_STAGGER_MS,
  QA_OPTION_SELECTION_DURATION_MS,
} from '@/components/onboarding/flow/onboardingMotion';
import type { OnboardingFlowDirection } from '@/components/onboarding/flow/OnboardingSceneViewport';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import {
  QA_ACTIVE_BLUE,
  QA_FOREGROUND,
  QA_GLASS_BORDER_SOFT,
  QA_GLASS_WHITE,
  QA_GLASS_WHITE_SOFT,
  QA_ROW_RADIUS,
} from './qaTokens';
import { useOnboardingLayoutTokens } from '@/hooks/useOnboardingLayoutTokens';

const BLUR_PROPS =
  Platform.OS === 'android'
    ? ({ experimentalBlurMethod: 'dimezisBlurView' } as const)
    : ({} as const);

type QAOptionRowProps = {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  selectionMode?: 'single' | 'multiple';
  revealActive?: boolean;
  revealDirection?: OnboardingFlowDirection;
  revealIndex?: number;
  revealKey?: string | number;
};

const AnimatedText = Animated.createAnimatedComponent(Text);

export function QAOptionRow({
  label,
  description,
  selected,
  onPress,
  selectionMode = 'single',
  revealActive = false,
  revealDirection = 'none',
  revealIndex = 0,
  revealKey,
}: QAOptionRowProps) {
  const selection = useSharedValue(selected ? 1 : 0);
  const reveal = useSharedValue(1);
  const reduceMotion = useReducedMotion();
  const layoutTokens = useOnboardingLayoutTokens();

  useEffect(() => {
    if (reduceMotion) {
      selection.value = selected ? 1 : 0;
      return;
    }

    selection.value = withTiming(selected ? 1 : 0, {
      duration: QA_OPTION_SELECTION_DURATION_MS,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [reduceMotion, selected, selection]);

  useEffect(() => {
    if (reduceMotion || !revealActive || revealDirection === 'none') {
      reveal.value = 1;
      return;
    }

    const isBack = revealDirection === 'back';
    const delay = Math.min(
      revealIndex * (isBack ? QA_OPTION_REVEAL_BACK_STAGGER_MS : QA_OPTION_REVEAL_STAGGER_MS),
      QA_OPTION_REVEAL_MAX_DELAY_MS,
    );

    reveal.value = 0;
    reveal.value = withDelay(
      delay,
      withTiming(1, {
        duration: isBack ? QA_OPTION_REVEAL_BACK_DURATION_MS : QA_OPTION_REVEAL_DURATION_MS,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      }),
    );
  }, [reduceMotion, reveal, revealActive, revealDirection, revealIndex, revealKey]);

  const revealStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [
      {
        translateY: interpolate(
          reveal.value,
          [0, 1],
          [QA_OPTION_REVEAL_OFFSET_Y, 0],
        ),
      },
      {
        scale: interpolate(
          reveal.value,
          [0, 1],
          [QA_OPTION_REVEAL_SCALE, 1],
        ),
      },
    ],
  }));

  const outerStyle = useAnimatedStyle(() => {
    const p = selection.value;
    return {
      backgroundColor: interpolateColor(p, [0, 1], [QA_GLASS_WHITE_SOFT, QA_GLASS_WHITE]),
      transform: [
        { translateY: interpolate(p, [0, 1], [0, -1]) },
        { scale: interpolate(p, [0, 1], [1, 1.01]) },
      ],
      shadowOpacity: interpolate(p, [0, 1], [0.08, 0.22]),
      shadowRadius: interpolate(p, [0, 1], [10, 18]),
      shadowOffset: { width: 0, height: interpolate(p, [0, 1], [5, 10]) },
      elevation: interpolate(p, [0, 1], [2, 8]),
    };
  });

  const selectedFillStyle = useAnimatedStyle(() => ({
    opacity: selection.value,
  }));

  const highlightStyle = useAnimatedStyle(() => ({
    opacity: interpolate(selection.value, [0, 1], [0.28, 0.62]),
  }));

  const strokeStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      selection.value,
      [0, 1],
      [QA_GLASS_BORDER_SOFT, 'rgba(77,110,255,0.22)'],
    ),
  }));

  const specularStyle = useAnimatedStyle(() => ({
    opacity: interpolate(selection.value, [0, 1], [0.55, 1]),
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(selection.value, [0, 1], ['rgba(12,21,49,0.76)', QA_FOREGROUND]),
  }));

  const descriptionStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      selection.value,
      [0, 1],
      ['rgba(10,21,51,0.54)', 'rgba(10,21,51,0.70)'],
    ),
  }));

  const radioShellStyle = useAnimatedStyle(() => {
    const p = selection.value;
    return {
      backgroundColor: interpolateColor(p, [0, 1], ['rgba(255,255,255,0.5)', QA_ACTIVE_BLUE]),
      borderColor: interpolateColor(p, [0, 1], ['rgba(12,21,49,0.12)', QA_ACTIVE_BLUE]),
      borderWidth: interpolate(p, [0, 1], [1.5, 0]),
      transform: [{ scale: interpolate(p, [0, 1], [1, 1.02]) }],
      shadowOpacity: interpolate(p, [0, 1], [0, 0.38]),
      shadowRadius: interpolate(p, [0, 1], [0, 10]),
      shadowOffset: { width: 0, height: interpolate(p, [0, 1], [0, 5]) },
      elevation: interpolate(p, [0, 1], [0, 4]),
    };
  });

  const radioDotStyle = useAnimatedStyle(() => ({
    opacity: selection.value,
    transform: [{ scale: interpolate(selection.value, [0, 1], [0.2, 1]) }],
  }));

  return (
    <Animated.View style={revealStyle}>
      <Pressable
        onPress={onPress}
        accessibilityRole={selectionMode === 'multiple' ? 'checkbox' : 'radio'}
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${label}${selected ? ' selected' : ''}`}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      >
        <Animated.View
          style={[
            styles.outer,
            description ? styles.outerWithDescription : null,
            {
              minHeight: description
                ? layoutTokens.optionRowWithDescriptionMinHeight
                : layoutTokens.optionRowMinHeight,
              paddingHorizontal: layoutTokens.optionRowPaddingX,
              paddingVertical: description
                ? layoutTokens.optionRowDescriptionPaddingY
                : layoutTokens.optionRowPaddingY,
            },
            outerStyle,
          ]}
        >
          <BlurView
            intensity={18}
            tint="light"
            style={[StyleSheet.absoluteFillObject, styles.blur]}
            {...BLUR_PROPS}
          />

          <LinearGradient
            pointerEvents="none"
            colors={[QA_GLASS_WHITE_SOFT, 'rgba(252,253,255,0.28)', 'rgba(246,248,252,0.18)']}
            start={{ x: 0.16, y: 0 }}
            end={{ x: 0.88, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />

          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, selectedFillStyle]}>
            <LinearGradient
              colors={[
                'rgba(255,255,255,0.95)',
                'rgba(252,253,255,0.90)',
                'rgba(245,248,255,0.84)',
              ]}
              start={{ x: 0.16, y: 0 }}
              end={{ x: 0.88, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          </Animated.View>

          <Animated.View pointerEvents="none" style={[styles.topHighlight, highlightStyle]} />
          <Animated.View pointerEvents="none" style={[styles.stroke, strokeStyle]} />
          <Animated.View pointerEvents="none" style={[styles.specular, specularStyle]}>
            <LinearGradient
              colors={[
                'rgba(255,255,255,0.12)',
                'rgba(255,255,255,0.26)',
                'rgba(255,255,255,0.12)',
              ]}
              locations={[0, 0.5, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFillObject}
            />
          </Animated.View>

          <Animated.View style={styles.textBlock}>
            <AnimatedText
              allowFontScaling={false}
              style={[
                styles.label,
                labelStyle,
                {
                  fontSize: layoutTokens.optionLabelSize,
                  lineHeight: layoutTokens.optionLabelLineHeight,
                },
              ]}
            >
              {label}
            </AnimatedText>
            {description ? (
              <AnimatedText
                allowFontScaling={false}
                style={[
                  styles.description,
                  descriptionStyle,
                  {
                    fontSize: layoutTokens.optionDescriptionSize,
                    lineHeight: layoutTokens.optionDescriptionLineHeight,
                  },
                ]}
              >
                {description}
              </AnimatedText>
            ) : null}
          </Animated.View>

          <Animated.View style={[styles.radioShell, radioShellStyle]}>
            <Animated.View style={[styles.radioDot, radioDotStyle]} />
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderRadius: QA_ROW_RADIUS,
  },
  pressed: {
    transform: [{ scale: 0.992 }],
  },
  outer: {
    borderRadius: QA_ROW_RADIUS,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: QA_GLASS_WHITE_SOFT,
    shadowColor: '#C6D0E6',
  },
  outerWithDescription: {
    alignItems: 'flex-start',
  },
  blur: {
    borderRadius: QA_ROW_RADIUS,
  },
  topHighlight: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  stroke: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: QA_ROW_RADIUS,
    borderWidth: 1,
    borderColor: QA_GLASS_BORDER_SOFT,
  },
  specular: {
    position: 'absolute',
    top: 2,
    left: 4,
    right: 4,
    height: 12,
    borderRadius: 999,
    overflow: 'hidden',
  },
  textBlock: {
    flex: 1,
    flexShrink: 1,
    paddingRight: 16,
  },
  label: {
    fontWeight: '600',
    letterSpacing: -0.34,
    color: QA_FOREGROUND,
  },
  description: {
    marginTop: 4,
    fontWeight: '500',
    letterSpacing: -0.38,
    color: 'rgba(10,21,51,0.7)',
  },
  radioShell: {
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
});
