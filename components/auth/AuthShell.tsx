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
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandGradient } from "@/components/BrandGradient";
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

/**
 * Shared container for auth screens: applies gradient background, top safe area,
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

    safeBack(navigation, { fallback: fallbackHref ?? "/(auth)/gate" });
  };

  return (
    <BrandGradient>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.root}>
          <View
            style={[
              styles.topBar,
              { paddingTop: (insets.top || 12) + topBarOffset },
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
          </View>

          <ScrollView
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

            <View style={styles.card}>{children}</View>

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
    </BrandGradient>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  root: {
    flex: 1,
  },
  topBar: {
    height: 44,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  backPlaceholder: {
    width: 44,
    height: 44,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  hero: {
    alignItems: "center",
    marginTop: 8,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: Platform.select({ ios: "800", android: "700" }) as any,
    color: colors.text,
    letterSpacing: 0.2,
    marginBottom: 8,
    textAlign: "left",
  },
  subtitle: {
    fontSize: 16,
    color: colors.textMuted,
    marginBottom: 20,
  },
  card: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.card,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  footer: {
    alignItems: "center",
    marginTop: 24,
    paddingHorizontal: 8,
  },
});
