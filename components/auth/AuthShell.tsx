import React, { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthLogoPill } from "@/components/auth/AuthLogoPill";
import { AUTH_FALLBACK_PATH } from "@/lib/auth-mode";
import { colors } from "@/lib/theme";
import { safeBack } from "@/lib/navigation/safeBack";
import type { Href } from "expo-router";

type AuthShellProps = {
  title?: string;
  subtitle?: string;
  hero?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  showBack?: boolean;
  onBack?: () => void;
  contentOffsetTop?: number;
  topBarOffset?: number;
  fallbackHref?: Href;
};

const SERIF_FONT = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "serif",
});

const AUTH_BACKGROUND = require("@/assets/images/auth-sky-background-portrait.png");

/**
 * Shared container for auth screens: applies the onboarding visual language,
 * consistent card sizing, and bottom padding that respects home indicator space.
 */
export function AuthShell({
  title,
  subtitle,
  hero,
  children,
  footer,
  showBack = true,
  onBack,
  contentOffsetTop = 16,
  topBarOffset = 0,
  fallbackHref,
}: AuthShellProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<ReactNavigation.RootParamList>>();

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }

    safeBack(navigation, { fallback: fallbackHref ?? AUTH_FALLBACK_PATH });
  };

  return (
    <View style={styles.shell}>
      <Image
        source={AUTH_BACKGROUND}
        contentFit="cover"
        transition={180}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.backgroundWash} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.root}>
          <View
            style={[
              styles.topBar,
              {
                height: (insets.top || 12) + topBarOffset + 48,
                paddingTop: (insets.top || 12) + topBarOffset,
              },
            ]}
          >
            {showBack ? (
              <TouchableOpacity
                onPress={handleBack}
                style={styles.backButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </TouchableOpacity>
            ) : (
              <View style={styles.backPlaceholder} />
            )}
            <View style={styles.logoSlot} pointerEvents="none">
              <AuthLogoPill />
            </View>
          </View>

          <ScrollView
            style={styles.scrollView}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.content,
              {
                paddingTop: contentOffsetTop,
                paddingBottom: Math.max(16, insets.bottom + 8),
              },
            ]}
          >
            {hero ? <View style={styles.hero}>{hero}</View> : null}

            {title ? <Text style={styles.title}>{title}</Text> : null}
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

            <View style={styles.card}>
              <View style={styles.cardContent}>{children}</View>
            </View>

            {footer ? (
              <View
                style={[
                  styles.footer,
                  { marginBottom: Math.max(16, insets.bottom + 8) },
                ]}
              >
                {footer}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: "#F7FAFF",
  },
  backgroundWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.24)",
  },
  flex: {
    flex: 1,
  },
  root: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  topBar: {
    justifyContent: "center",
    paddingHorizontal: 20,
    zIndex: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.42)",
  },
  backPlaceholder: {
    width: 44,
    height: 44,
  },
  logoSlot: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  hero: {
    alignItems: "center",
    marginTop: 8,
    marginBottom: 20,
  },
  title: {
    width: "100%",
    maxWidth: 392,
    fontFamily: SERIF_FONT,
    fontSize: 37,
    lineHeight: 44,
    fontWeight: "500",
    color: "#0B1020",
    letterSpacing: -0.7,
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    width: "100%",
    maxWidth: 340,
    fontSize: 15,
    lineHeight: 21,
    color: "#667085",
    marginBottom: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  card: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 392,
  },
  cardContent: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 8,
  },
  footer: {
    alignItems: "center",
    marginTop: 18,
    paddingHorizontal: 8,
  },
});
