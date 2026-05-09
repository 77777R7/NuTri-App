import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";

const BLUR_PROPS =
  Platform.OS === "android"
    ? ({ experimentalBlurMethod: "dimezisBlurView" } as const)
    : ({} as const);

export function AuthLogoPill() {
  return (
    <View style={styles.logoPill}>
      <BlurView
        intensity={42}
        tint="light"
        style={[StyleSheet.absoluteFillObject, styles.logoBlur]}
        {...BLUR_PROPS}
      />
      <LinearGradient
        colors={["rgba(255,255,255,0.46)", "rgba(255,255,255,0.18)", "rgba(255,255,255,0.08)"]}
        locations={[0, 0.58, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[StyleSheet.absoluteFillObject, styles.logoTint]}
      />
      <LinearGradient
        colors={["rgba(255,255,255,0.82)", "rgba(255,255,255,0.18)", "rgba(255,255,255,0)"]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.9 }}
        style={styles.logoGlint}
      />
      <View style={styles.logoTopHighlight} pointerEvents="none" />
      <View style={styles.logoBottomShade} pointerEvents="none" />
      <View style={styles.logoPillBorder} pointerEvents="none" />
      <Text allowFontScaling={false} style={styles.logoText}>
        NuTri
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  logoPill: {
    minWidth: 96,
    height: 44,
    paddingHorizontal: 24,
    borderRadius: 999,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#73BDEB",
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    backgroundColor: "rgba(255,255,255,0.10)",
    elevation: 5,
    borderCurve: "continuous",
  },
  logoBlur: {
    borderRadius: 999,
  },
  logoTint: {
    borderRadius: 999,
  },
  logoGlint: {
    position: "absolute",
    top: 3,
    left: 7,
    right: 12,
    height: 18,
    borderRadius: 999,
    opacity: 0.78,
  },
  logoTopHighlight: {
    position: "absolute",
    top: 1,
    left: 8,
    right: 8,
    height: 1,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  logoBottomShade: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 1,
    height: 1,
    borderRadius: 999,
    backgroundColor: "rgba(15,23,42,0.05)",
  },
  logoPillBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.66)",
  },
  logoText: {
    fontSize: 17,
    lineHeight: 19,
    fontWeight: "800",
    letterSpacing: -0.34,
    color: "#0B1020",
    textShadowColor: "rgba(255,255,255,0.38)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
});

export default AuthLogoPill;
