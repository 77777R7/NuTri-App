import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

let Skia: null | {
  BlurMask: any;
  Canvas: any;
  Circle: any;
  Group: any;
  RadialGradient: any;
  vec: (...args: any[]) => any;
} = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Skia = require('@shopify/react-native-skia');
} catch {
  Skia = null;
}

type PlanPreviewCornerGlowProps = {
  style?: StyleProp<ViewStyle>;
};

const CANVAS_SIZE = 304;
const ORB_CX = 252;
const ORB_CY = 74;
const AMBIENT_RADIUS = 178;
const DIFFUSE_RADIUS = 144;
const BLOOM_RADIUS = 108;
const CORE_RADIUS = 72;

export function PlanPreviewCornerGlow({ style }: PlanPreviewCornerGlowProps) {
  if (!Skia) {
    return (
      <View pointerEvents="none" style={[styles.wrap, style]}>
        <View style={styles.fallbackAmbient} />
        <View style={styles.fallbackDiffuse} />
        <View style={styles.fallbackBloom} />
        <View style={styles.fallbackCore} />
      </View>
    );
  }

  const { BlurMask, Canvas, Circle, Group, RadialGradient, vec } = Skia;

  return (
    <View pointerEvents="none" style={[styles.wrap, style]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Group opacity={0.52}>
          <Circle cx={ORB_CX} cy={ORB_CY} r={AMBIENT_RADIUS}>
            <RadialGradient
              c={vec(ORB_CX, ORB_CY)}
              r={AMBIENT_RADIUS}
              colors={[
                'rgba(239,243,255,0.90)',
                'rgba(231,238,255,0.50)',
                'rgba(231,238,255,0.08)',
                'rgba(228,236,255,0)',
              ]}
              positions={[0.03, 0.48, 0.82, 1]}
            />
            <BlurMask blur={82} style="normal" />
          </Circle>
        </Group>

        <Group opacity={0.28}>
          <Circle cx={ORB_CX} cy={ORB_CY} r={DIFFUSE_RADIUS}>
            <RadialGradient
              c={vec(ORB_CX, ORB_CY)}
              r={DIFFUSE_RADIUS}
              colors={[
                'rgba(128,173,255,0.30)',
                'rgba(102,147,255,0.18)',
                'rgba(84,129,255,0.06)',
                'rgba(78,124,255,0)',
              ]}
              positions={[0.02, 0.46, 0.8, 1]}
            />
            <BlurMask blur={62} style="normal" />
          </Circle>
        </Group>

        <Group opacity={0.34}>
          <Circle cx={ORB_CX} cy={ORB_CY} r={BLOOM_RADIUS}>
            <RadialGradient
              c={vec(ORB_CX, ORB_CY)}
              r={BLOOM_RADIUS}
              colors={[
                'rgba(96,142,255,0.74)',
                'rgba(84,129,255,0.34)',
                'rgba(70,115,247,0.09)',
                'rgba(66,111,247,0)',
              ]}
              positions={[0.02, 0.42, 0.76, 1]}
            />
            <BlurMask blur={40} style="normal" />
          </Circle>
        </Group>

        <Group opacity={0.46}>
          <Circle cx={ORB_CX} cy={ORB_CY} r={CORE_RADIUS}>
            <RadialGradient
              c={vec(ORB_CX, ORB_CY)}
              r={CORE_RADIUS}
              colors={[
                'rgba(188,220,255,0.96)',
                'rgba(136,188,255,0.82)',
                'rgba(92,142,255,0.44)',
                'rgba(67,113,247,0.15)',
                'rgba(59,106,247,0)',
              ]}
              positions={[0, 0.18, 0.46, 0.78, 1]}
            />
            <BlurMask blur={22} style="normal" />
          </Circle>
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    overflow: 'visible',
  },
  fallbackAmbient: {
    position: 'absolute',
    top: -4,
    right: 8,
    width: 258,
    height: 258,
    borderRadius: 999,
    backgroundColor: 'rgba(233,239,255,0.58)',
  },
  fallbackDiffuse: {
    position: 'absolute',
    top: 10,
    right: 18,
    width: 216,
    height: 216,
    borderRadius: 999,
    backgroundColor: 'rgba(116,156,255,0.16)',
  },
  fallbackBloom: {
    position: 'absolute',
    top: 18,
    right: 26,
    width: 172,
    height: 172,
    borderRadius: 999,
    backgroundColor: 'rgba(86,132,255,0.20)',
  },
  fallbackCore: {
    position: 'absolute',
    top: 26,
    right: 18,
    width: 116,
    height: 116,
    borderRadius: 999,
    backgroundColor: 'rgba(104,156,255,0.26)',
  },
});
