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
import { StatusBar } from "expo-status-bar";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AUTH_FALLBACK_PATH } from "@/lib/auth-mode";
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
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.root}>
          {showBack ? (
            <TouchableOpacity
              onPress={handleBack}
              style={[
                styles.floatingBackButton,
                { top: Math.max(86, (insets.top || 0) + 28) },
              ]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={25} color="#0B1020" />
            </TouchableOpacity>
          ) : null}

          <ScrollView
            style={styles.scrollView}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.content,
              {
                paddingTop: Math.max(10, (insets.top || 0) + topBarOffset),
                paddingBottom: Math.max(10, insets.bottom + 10),
              },
            ]}
          >
            <View style={styles.panel}>
              <View style={[styles.panelTop, { marginBottom: contentOffsetTop }]}>
                <View style={styles.backPlaceholder} />
              </View>

              {hero ? <View style={styles.hero}>{hero}</View> : null}

              {title ? <Text style={styles.title}>{title}</Text> : null}
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

              <View style={styles.card}>
                <View style={styles.cardContent}>{children}</View>
              </View>

              {footer ? <View style={styles.footer}>{footer}</View> : null}
            </View>
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
    backgroundColor: "rgba(255,255,255,0.20)",
  },
  flex: {
    flex: 1,
  },
  root: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    backgroundColor: "transparent",
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    width: "100%",
    maxWidth: 390,
    minHeight: 716,
    backgroundColor: "transparent",
    paddingHorizontal: 26,
    paddingTop: 30,
    paddingBottom: 24,
  },
  floatingBackButton: {
    position: "absolute",
    left: 26,
    zIndex: 20,
    alignItems: "center",
    justifyContent: "center",
    width: 42,
    height: 42,
  },
  backPlaceholder: {
    width: 42,
    height: 42,
  },
  hero: {
    alignItems: "center",
    marginTop: 8,
    marginBottom: 20,
  },
  panelTop: {
    width: "100%",
  },
  title: {
    width: "100%",
    fontFamily: SERIF_FONT,
    fontSize: 38,
    lineHeight: 46,
    fontWeight: "700",
    color: "#0B1020",
    letterSpacing: -0.6,
    marginBottom: 8,
    textAlign: "left",
  },
  subtitle: {
    width: "100%",
    fontSize: 22,
    lineHeight: 28,
    color: "#333333",
    marginBottom: 30,
    fontWeight: "400",
    textAlign: "left",
  },
  card: {
    alignSelf: "center",
    width: "100%",
  },
  cardContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  footer: {
    alignItems: "center",
    marginTop: "auto",
    paddingTop: 26,
    paddingHorizontal: 0,
  },
});
