import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { SharedValue, interpolate, useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';

let Skia: null | {
  BlurMask: any;
  Canvas: any;
  Circle: any;
  Group: any;
  RadialGradient: any;
  vec: (...args: any[]) => any;
} = null;

try {
  Skia = require('@shopify/react-native-skia');
} catch {
  Skia = null;
}

type WelcomeHeroGlowProps = {
  cardWidth: number;
  cardHeight: number;
  pulse: SharedValue<number>;
  diffuse: SharedValue<number>;
};

export function WelcomeHeroGlow({
  cardWidth,
  cardHeight,
  pulse,
  diffuse,
}: WelcomeHeroGlowProps) {
  const canvasWidth = cardWidth + 132;
  const canvasHeight = cardHeight + 170;

  const cx = canvasWidth / 2;
  const ambientCy = cardHeight * 0.62;
  const orbCy = cardHeight * 0.74;

  const ambientRadius = useDerivedValue(() => cardWidth * 0.76 + diffuse.value * 10, [cardWidth]);
  const diffuseRadius = useDerivedValue(() => cardWidth * 0.44 + diffuse.value * 34, [cardWidth]);
  const bloomRadius = useDerivedValue(() => cardWidth * 0.38 + pulse.value * 16, [cardWidth]);
  const coreRadius = useDerivedValue(() => cardWidth * 0.26 + pulse.value * 10, [cardWidth]);

  const ambientOpacity = useDerivedValue(() => 0.5 + (1 - diffuse.value) * 0.06);
  const diffuseOpacity = useDerivedValue(() => 0.22 * (1 - diffuse.value));
  const bloomOpacity = useDerivedValue(() => 0.18 + pulse.value * 0.12);
  const coreOpacity = useDerivedValue(() => 0.26 + pulse.value * 0.14);

  const fallbackAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(diffuse.value, [0, 1], [0.22, 0.3]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [0.985, 1.03]) }],
  }));

  if (!Skia) {
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          styles.wrap,
          {
            width: canvasWidth,
            height: canvasHeight,
            left: -(canvasWidth - cardWidth) / 2,
            top: -30,
          },
          fallbackAnimatedStyle,
        ]}
      >
        <View
          style={[
            styles.fallbackAmbient,
            {
              width: cardWidth * 1.52,
              height: cardWidth * 1.52,
              left: (canvasWidth - cardWidth * 1.52) / 2,
              top: ambientCy - (cardWidth * 1.52) / 2,
            },
          ]}
        />
        <View
          style={[
            styles.fallbackDiffuse,
            {
              width: cardWidth * 0.9,
              height: cardWidth * 0.9,
              left: (canvasWidth - cardWidth * 0.9) / 2,
              top: orbCy - (cardWidth * 0.9) / 2,
            },
          ]}
        />
        <View
          style={[
            styles.fallbackCore,
            {
              width: cardWidth * 0.52,
              height: cardWidth * 0.52,
              left: (canvasWidth - cardWidth * 0.52) / 2,
              top: orbCy - (cardWidth * 0.52) / 2,
            },
          ]}
        />
      </Animated.View>
    );
  }

  const { BlurMask, Canvas, Circle, Group, RadialGradient, vec } = Skia;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          width: canvasWidth,
          height: canvasHeight,
          left: -(canvasWidth - cardWidth) / 2,
          top: -30,
        },
      ]}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Group opacity={ambientOpacity}>
          <Circle cx={cx} cy={ambientCy} r={ambientRadius}>
            <RadialGradient
              c={vec(cx, ambientCy)}
              r={ambientRadius}
              colors={[
                'rgba(230,236,248,0.94)',
                'rgba(237,242,252,0.52)',
                'rgba(243,245,251,0)',
              ]}
              positions={[0.06, 0.68, 1]}
            />
            <BlurMask blur={46} style="normal" />
          </Circle>
        </Group>

        <Group opacity={diffuseOpacity}>
          <Circle cx={cx} cy={orbCy} r={diffuseRadius}>
            <RadialGradient
              c={vec(cx, orbCy)}
              r={diffuseRadius}
              colors={[
                'rgba(82,134,255,0.54)',
                'rgba(70,121,255,0.18)',
                'rgba(70,121,255,0)',
              ]}
              positions={[0.0, 0.64, 1]}
            />
            <BlurMask blur={42} style="normal" />
          </Circle>
        </Group>

        <Group opacity={bloomOpacity}>
          <Circle cx={cx} cy={orbCy} r={bloomRadius}>
            <RadialGradient
              c={vec(cx, orbCy)}
              r={bloomRadius}
              colors={[
                'rgba(78,145,255,0.82)',
                'rgba(60,113,255,0.24)',
                'rgba(60,113,255,0)',
              ]}
              positions={[0.0, 0.62, 1]}
            />
            <BlurMask blur={30} style="normal" />
          </Circle>
        </Group>

        <Group opacity={coreOpacity}>
          <Circle cx={cx} cy={orbCy} r={coreRadius}>
            <RadialGradient
              c={vec(cx, orbCy)}
              r={coreRadius}
              colors={[
                'rgba(158,203,255,0.92)',
                'rgba(112,173,255,0.66)',
                'rgba(84,146,255,0.18)',
                'rgba(84,146,255,0)',
              ]}
              positions={[0.0, 0.38, 0.82, 1]}
            />
            <BlurMask blur={20} style="normal" />
          </Circle>
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    overflow: 'visible',
  },
  fallbackAmbient: {
    position: 'absolute',
    borderRadius: 9999,
    backgroundColor: 'rgba(231,237,248,0.78)',
  },
  fallbackDiffuse: {
    position: 'absolute',
    borderRadius: 9999,
    backgroundColor: 'rgba(91,139,255,0.16)',
  },
  fallbackCore: {
    position: 'absolute',
    borderRadius: 9999,
    backgroundColor: 'rgba(146,196,255,0.24)',
  },
});
