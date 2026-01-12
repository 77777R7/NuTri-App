import React, { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import * as AppleAuthentication from "expo-apple-authentication";

import { AuthShell } from "@/components/auth/AuthShell";
import { SocialAuthPills } from "@/components/auth/SocialAuthPills";
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from "@/components/ui/nativewind-primitives";
import { useAuth } from "@/contexts/AuthContext";
import { AUTH_FALLBACK_PATH } from "@/lib/auth-mode";
import { getAuthErrorMessage } from "@/lib/errors";
import { colors } from "@/lib/theme";
import { testSupabase } from "@/lib/supabase";

export const unstable_settings = { headerShown: false };

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ redirect?: string }>();
  const redirectParam = useMemo(
    () =>
      typeof params.redirect === "string"
        ? decodeURIComponent(params.redirect)
        : null,
    [params.redirect],
  );

  const {
    session,
    loading,
    signInWithPassword,
    signInWithGoogle,
    signInWithApple,
    authenticateWithBiometrics,
    isBiometricEnabled,
    error,
    clearError,
    postAuthRedirect,
    setPostAuthRedirect,
  } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [socialLoading, setSocialLoading] = useState<"google" | "apple" | null>(
    null,
  );
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (!loading && session) {
      setPostAuthRedirect(null);
      router.replace('/main');
    }
  }, [loading, session, router, setPostAuthRedirect]);

  useEffect(() => {
    if (error) {
      Toast.show({
        type: "error",
        text1: "Sign in failed",
        text2: error,
      });
    }
  }, [error]);

  useEffect(() => {
    console.log(
      "Supabase URL:",
      process.env.EXPO_PUBLIC_SUPABASE_URL,
      "\nAnon Key:",
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    );
  }, []);

  useEffect(() => {
    testSupabase();
  }, []);

  useEffect(() => {
    let mounted = true;
    AppleAuthentication.isAvailableAsync()
      .then((available: boolean) => {
        if (mounted) {
          setAppleAvailable(available);
        }
      })
      .catch(() => {
        if (mounted) {
          setAppleAvailable(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const showInlineMessage = (message: string) => {
    Toast.show({
      type: "error",
      text1: "Action needed",
      text2: message,
    });
  };

  const onEmailPassword = async () => {
    if (!email || !password) {
      Alert.alert("Missing fields", "Please fill in both email and password.");
      return;
    }
    setSubmitting(true);
    clearError();
    try {
      await signInWithPassword(email.trim(), password);
    } catch (err) {
      const message = getAuthErrorMessage(err);
      showInlineMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogle = async () => {
    if (isBusy) {
      return;
    }
    setSocialLoading("google");
    clearError();
    try {
      await signInWithGoogle();
    } catch (err) {
      showInlineMessage(getAuthErrorMessage(err));
    } finally {
      setSocialLoading(null);
    }
  };

  const onApple = async () => {
    if (isBusy) {
      return;
    }
    setSocialLoading("apple");
    clearError();
    try {
      await signInWithApple();
    } catch (err) {
      showInlineMessage(getAuthErrorMessage(err));
    } finally {
      setSocialLoading(null);
    }
  };

  const onBiometric = async () => {
    try {
      const success = await authenticateWithBiometrics();
      if (success) {
        setPostAuthRedirect(null);
        router.replace('/main');
      }
    } catch (err) {
      showInlineMessage(getAuthErrorMessage(err));
    }
  };

  const isBusy = submitting || socialLoading !== null || loading;

  return (
    <AuthShell
      showBack
      fallbackHref={AUTH_FALLBACK_PATH}
      contentOffsetTop={72}
      topBarOffset={12}
      hero={
        <View style={styles.hero}>
          <Text style={styles.heroBrand}>NuTri</Text>
          <Text style={styles.heroHeadline}>Welcome back</Text>
        </View>
      }
      footer={
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Don’t have an account?{" "}
            <Text
              onPress={() => router.push("/auth/signup")}
              style={styles.footerLink}
            >
              Create one
            </Text>
          </Text>
          <Text style={styles.terms}>
            By continuing you agree to NuTri’s{" "}
            <Text style={styles.footerLink}>Terms of Service</Text> and{" "}
            <Text style={styles.footerLink}>Privacy Policy</Text>.
          </Text>
        </View>
      }
    >
      <Text style={styles.sectionTitle}>Member Access</Text>

      <View style={styles.inputGroup}>
        <View style={styles.inputRow}>
          <Ionicons name="mail-outline" size={20} color="#9CA3AF" />
          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#9CA3AF"
            style={styles.input}
            value={email}
          />
        </View>
      </View>

      <View style={styles.inputGroup}>
        <View style={styles.inputRow}>
          <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" />
          <TextInput
            autoCapitalize="none"
            onChangeText={setPassword}
            placeholder="Enter your password"
            placeholderTextColor="#9CA3AF"
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </View>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity onPress={() => router.push("/auth/forgot-password")}>
          <Text style={styles.linkPrimary}>Forgot password?</Text>
        </TouchableOpacity>
        {isBiometricEnabled ? (
          <TouchableOpacity
            disabled={isBusy}
            onPress={() => {
              void onBiometric();
            }}
          >
            <Text style={[styles.linkSecondary, isBusy && styles.faded]}>
              Use Face ID
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <TouchableOpacity
        activeOpacity={0.9}
        disabled={isBusy}
        onPress={() => {
          void onEmailPassword();
        }}
        style={[styles.primaryButton, isBusy && styles.disabled]}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryLabel}>Sign In</Text>
        )}
      </TouchableOpacity>

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>Or continue with</Text>
        <View style={styles.dividerLine} />
      </View>

      <SocialAuthPills
        appleAvailable={appleAvailable}
        disabled={isBusy}
        loading={socialLoading}
        onApple={onApple}
        onGoogle={onGoogle}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: "center",
  },
  heroBrand: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.brand,
    letterSpacing: 0.5,
  },
  heroHeadline: {
    marginTop: 6,
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 12,
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 52,
  },
  input: {
    flex: 1,
    height: "100%",
    marginLeft: 10,
    fontSize: 16,
    color: colors.text,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
    marginBottom: 16,
  },
  linkPrimary: {
    color: colors.brand,
    fontWeight: "600",
  },
  linkSecondary: {
    color: colors.brandDark,
    fontWeight: "600",
  },
  faded: {
    opacity: 0.5,
  },
  primaryButton: {
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  primaryLabel: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.7,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 0,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: "500",
  },
  footer: {
    alignItems: "center",
    gap: 8,
  },
  footerText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
  },
  footerLink: {
    color: colors.brand,
    fontWeight: "700",
  },
  terms: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: "center",
  },
});
