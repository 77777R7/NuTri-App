import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

import { FOREGROUND } from './welcomeTokens';

const BLUR_PROPS =
  Platform.OS === 'android'
    ? ({ experimentalBlurMethod: 'dimezisBlurView' } as const)
    : ({} as const);

export function OnboardingLogoPill() {
  return (
    <View style={styles.logoPill}>
      <BlurView
        intensity={18}
        tint="light"
        style={[StyleSheet.absoluteFillObject, styles.logoBlur]}
        {...BLUR_PROPS}
      />
      <LinearGradient
        colors={['rgba(255,255,255,0.82)', 'rgba(255,255,255,0.62)']}
        start={{ x: 0.18, y: 0 }}
        end={{ x: 0.82, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.logoPillBorder} pointerEvents="none" />
      <Text allowFontScaling={false} style={styles.logoText}>
        NuTri
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  logoPill: {
    minWidth: 86,
    height: 40,
    paddingHorizontal: 22,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#CAD4E8',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  logoBlur: {
    borderRadius: 999,
  },
  logoPillBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(210,218,232,0.78)',
  },
  logoText: {
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: -0.34,
    color: FOREGROUND,
  },
});

export default OnboardingLogoPill;
