import React from "react";
import { Platform, StyleSheet } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "@/lib/theme";
import {
  ActivityIndicator,
  Text,
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
  const fallbackDisabled = disabled || isAppleLoading || Platform.OS !== "ios";
  const fallbackOpacity = fallbackDisabled ? styles.disabled : undefined;

  return (
    <View style={[styles.stack, { marginTop: topGap }]}>
      <TouchableOpacity
        accessibilityLabel="Sign in with Google"
        accessibilityRole="button"
        activeOpacity={0.9}
        disabled={disabled || isGoogleLoading}
        onPress={handleGooglePress}
        style={[styles.googleButton, googleOpacity]}
      >
        {isGoogleLoading ? (
          <ActivityIndicator color="#DB4437" />
        ) : (
          <>
            <Ionicons name="logo-google" size={20} color="#DB4437" />
            <Text style={styles.googleText}>Sign in with Google</Text>
          </>
        )}
      </TouchableOpacity>

      {appleAvailable && Platform.OS === "ios" ? (
        <View style={[styles.appleWrapper, disabled ? styles.disabled : null]}>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={999}
            onPress={handleApplePress}
            accessibilityLabel="Sign in with Apple"
            style={styles.appleNative}
          />
          {isAppleLoading ? (
            <View pointerEvents="none" style={styles.loadingOverlay}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : null}
        </View>
      ) : (
        <TouchableOpacity
          accessibilityLabel="Sign in with Apple"
          accessibilityRole="button"
          activeOpacity={0.9}
          disabled={fallbackDisabled}
          onPress={handleApplePress}
          style={[styles.appleFallback, fallbackOpacity]}
        >
          {isAppleLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="logo-apple" size={20} color="#FFFFFF" />
              <Text style={styles.appleText}>Sign in with Apple</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  stack: {
    width: "100%",
    alignItems: "center",
    gap: 12,
  },
  googleButton: {
    width: "100%",
    maxWidth: 360,
    height: 52,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  googleText: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
  },
  appleWrapper: {
    width: "100%",
    maxWidth: 360,
    height: 52,
  },
  appleNative: {
    width: "100%",
    maxWidth: 360,
    height: 52,
  },
  appleFallback: {
    width: "100%",
    maxWidth: 360,
    height: 52,
    borderRadius: 999,
    backgroundColor: colors.text, // near-black
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  appleText: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  disabled: {
    opacity: 0.6,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
});
