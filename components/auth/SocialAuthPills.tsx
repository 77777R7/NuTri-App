import React from "react";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { GoogleGMark } from "@/components/auth/GoogleGMark";
import {
  ActivityIndicator,
  TouchableOpacity,
  View,
} from "@/components/ui/nativewind-primitives";

type SocialAuthPillsProps = {
  onGoogle: () => Promise<void> | void;
  onApple: () => Promise<void> | void;
  loading?: "google" | "apple" | null;
  disabled?: boolean;
  appleAvailable: boolean;
  topGap?: number;
};

export const SocialAuthPills: React.FC<SocialAuthPillsProps> = ({
  onGoogle,
  onApple,
  loading = null,
  disabled = false,
  appleAvailable,
  topGap = 20,
}) => {
  const isGoogleLoading = loading === "google";
  const isAppleLoading = loading === "apple";

  const handleGooglePress = () => {
    if (disabled || isGoogleLoading) {
      return;
    }
    onGoogle();
  };

  const handleApplePress = () => {
    if (disabled || isAppleLoading) {
      return;
    }
    onApple();
  };

  const googleOpacity = disabled || isGoogleLoading ? styles.disabled : undefined;
  const appleDisabled = disabled || isAppleLoading || !appleAvailable;
  const appleOpacity = appleDisabled ? styles.disabled : undefined;

  return (
    <View style={[styles.row, { marginTop: topGap }]}>
      <TouchableOpacity
        accessibilityLabel="Sign in with Google"
        accessibilityRole="button"
        activeOpacity={0.9}
        disabled={disabled || isGoogleLoading}
        onPress={handleGooglePress}
        style={[styles.iconButton, googleOpacity]}
      >
        {isGoogleLoading ? (
          <ActivityIndicator color="#DB4437" />
        ) : (
          <GoogleGMark size={30} />
        )}
      </TouchableOpacity>

      <TouchableOpacity
        accessibilityLabel="Sign in with Apple"
        accessibilityRole="button"
        activeOpacity={0.9}
        disabled={appleDisabled}
        onPress={handleApplePress}
        style={[styles.iconButton, appleOpacity]}
      >
        {isAppleLoading ? (
          <ActivityIndicator color="#111111" />
        ) : (
          <Ionicons name="logo-apple" size={32} color="#050505" />
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    width: "100%",
    alignItems: "center",
    flexDirection: "row",
    gap: 30,
    justifyContent: "center",
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  disabled: {
    opacity: 0.35,
  },
});
