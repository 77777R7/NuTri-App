import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

import { onboardingPalette, onboardingShadow } from './theme';

type GlassVariant = 'hero' | 'panel' | 'label' | 'row' | 'toggle' | 'soft';

type GlassSurfaceProps = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: GlassVariant;
  borderRadius?: number;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
};

const variantStyles: Record<GlassVariant, { backgroundColor: string; borderColor: string; blur: number; shadow?: ViewStyle }> = {
  hero: {
    backgroundColor: onboardingPalette.glass,
    borderColor: onboardingPalette.border,
    blur: 32,
    shadow: onboardingShadow.card,
  },
  panel: {
    backgroundColor: onboardingPalette.glass,
    borderColor: onboardingPalette.border,
    blur: 26,
    shadow: onboardingShadow.card,
  },
  label: {
    backgroundColor: onboardingPalette.glassLabel,
    borderColor: onboardingPalette.border,
    blur: 18,
  },
  row: {
    backgroundColor: onboardingPalette.glassSoft,
    borderColor: onboardingPalette.borderSoft,
    blur: 18,
  },
  toggle: {
    backgroundColor: 'rgba(220,232,255,0.58)',
    borderColor: onboardingPalette.border,
    blur: 18,
  },
  soft: {
    backgroundColor: onboardingPalette.glassSoft,
    borderColor: onboardingPalette.borderSoft,
    blur: 14,
  },
};

export const GlassSurface = ({
  children,
  style,
  variant = 'panel',
  borderRadius = 32,
  pointerEvents = 'auto',
}: GlassSurfaceProps) => {
  const config = variantStyles[variant];

  return (
    <View
      pointerEvents={pointerEvents}
      style={[
        styles.base,
        {
          borderRadius,
          backgroundColor: config.backgroundColor,
          borderColor: config.borderColor,
        },
        config.shadow,
        style,
      ]}
    >
      <BlurView
        intensity={Platform.OS === 'ios' ? config.blur : Math.max(config.blur - 6, 8)}
        tint="light"
        style={[StyleSheet.absoluteFillObject, { borderRadius }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0.74)', 'rgba(255,255,255,0.22)', 'rgba(255,255,255,0.10)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[StyleSheet.absoluteFillObject, { borderRadius, opacity: 0.82 }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0.72)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.32)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[styles.innerHighlight, { borderRadius }]}
      />
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    borderWidth: 1,
  },
  innerHighlight: {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.44)',
  },
});

export default GlassSurface;
