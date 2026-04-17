import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import Toast from "react-native-toast-message";
import * as AppleAuthentication from "expo-apple-authentication";

import { AuthShell } from "@/components/auth/AuthShell";
import { SocialAuthPills } from "@/components/auth/SocialAuthPills";
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from "@/components/ui/nativewind-primitives";
import { getPostAuthDestination, useAuth } from "@/contexts/AuthContext";
import { AUTH_FALLBACK_PATH } from "@/lib/auth-mode";
import { getAuthErrorMessage } from "@/lib/errors";
import { colors } from "@/lib/theme";

export const unstable_settings = { headerShown: false };

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Please enter your email address.")
    .email("Please enter a valid email address."),
  password: z.string().min(1, "Please enter your password."),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ redirect?: string }>();

  const {
    session,
    loading,
    postAuthRedirect,
    signInWithPassword,
    signInWithGoogle,
    signInWithApple,
    authenticateWithBiometrics,
    isBiometricEnabled,
    clearError,
    setPostAuthRedirect,
  } = useAuth();

  const [submitting, setSubmitting] = useState(false);
  const [socialLoading, setSocialLoading] = useState<"google" | "apple" | null>(
    null,
  );
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
    setError,
    clearErrors,
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const redirectTarget = useMemo(() => {
    const encodedRedirect = typeof params.redirect === "string" ? params.redirect : null;
    const candidate = encodedRedirect ?? postAuthRedirect;

    if (!candidate) {
      return null;
    }

    try {
      return decodeURIComponent(candidate);
    } catch {
      return candidate;
    }
  }, [params.redirect, postAuthRedirect]);

  const finishLogin = useCallback(() => {
    const destination = redirectTarget ? getPostAuthDestination(redirectTarget) : "/";
    setPostAuthRedirect(null);
    router.replace(destination);
  }, [redirectTarget, router, setPostAuthRedirect]);

  useEffect(() => {
    if (!loading && session) {
      finishLogin();
    }
  }, [finishLogin, loading, session]);

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

  const showErrorToast = (title: string, message: string) => {
    Toast.show({
      type: "error",
      text1: title,
      text2: message,
    });
  };

  const onEmailPassword = handleSubmit(async ({ email, password }: LoginForm) => {
    setSubmitting(true);
    clearError();
    clearErrors();
    setFeedback(null);

    try {
      await signInWithPassword(email.trim(), password);
    } catch (err) {
      const message = getAuthErrorMessage(err);
      const normalizedMessage = message.toLowerCase();

      setFeedback(message);
      if (normalizedMessage.includes("email")) {
        setError("email", { message });
      } else if (
        normalizedMessage.includes("password")
        || normalizedMessage.includes("credential")
        || normalizedMessage.includes("sign in")
      ) {
        setError("password", { message });
      }

      showErrorToast("Sign in failed", message);
    } finally {
      setSubmitting(false);
    }
  });

  const onGoogle = async () => {
    if (isBusy) {
      return;
    }
    setSocialLoading("google");
    clearError();
    setFeedback(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      const message = getAuthErrorMessage(err);
      setFeedback(message);
      showErrorToast("Google sign-in failed", message);
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
    setFeedback(null);
    try {
      await signInWithApple();
    } catch (err) {
      const message = getAuthErrorMessage(err);
      setFeedback(message);
      showErrorToast("Apple sign-in failed", message);
    } finally {
      setSocialLoading(null);
    }
  };

  const onBiometric = async () => {
    try {
      const success = await authenticateWithBiometrics();
      if (success) {
        finishLogin();
      }
    } catch (err) {
      const message = getAuthErrorMessage(err);
      setFeedback(message);
      showErrorToast("Biometric sign-in failed", message);
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

      {feedback ? (
        <View style={styles.feedback}>
          <Text style={styles.feedbackText}>{feedback}</Text>
        </View>
      ) : null}

      <Controller<LoginForm>
        control={control}
        name="email"
        render={({ field }: { field: { onBlur: () => void; onChange: (value: string) => void; value: string } }) => (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <View style={[styles.inputRow, errors.email ? styles.inputError : undefined]}>
              <Ionicons name="mail-outline" size={20} color="#9CA3AF" />
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                onBlur={field.onBlur}
                onChangeText={(nextValue: string) => {
                  clearError();
                  clearErrors("email");
                  setFeedback(null);
                  field.onChange(nextValue);
                }}
                placeholder="you@example.com"
                placeholderTextColor="#9CA3AF"
                returnKeyType="next"
                style={styles.input}
                textContentType="emailAddress"
                value={field.value}
              />
            </View>
            {errors.email?.message ? (
              <Text style={styles.errorText}>{errors.email.message}</Text>
            ) : null}
          </View>
        )}
      />

      <Controller<LoginForm>
        control={control}
        name="password"
        render={({ field }: { field: { onBlur: () => void; onChange: (value: string) => void; value: string } }) => (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={[styles.inputRow, errors.password ? styles.inputError : undefined]}>
              <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" />
              <TextInput
                autoCapitalize="none"
                autoComplete="password"
                autoCorrect={false}
                onBlur={field.onBlur}
                onChangeText={(nextValue: string) => {
                  clearError();
                  clearErrors("password");
                  setFeedback(null);
                  field.onChange(nextValue);
                }}
                onSubmitEditing={() => {
                  void onEmailPassword();
                }}
                placeholder="Enter your password"
                placeholderTextColor="#9CA3AF"
                returnKeyType="done"
                secureTextEntry={!passwordVisible}
                style={styles.input}
                textContentType="password"
                value={field.value}
              />
              <TouchableOpacity
                accessibilityLabel={passwordVisible ? "Hide password" : "Show password"}
                accessibilityRole="button"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => setPasswordVisible((current) => !current)}
              >
                <Ionicons
                  name={passwordVisible ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color="#9CA3AF"
                />
              </TouchableOpacity>
            </View>
            {errors.password?.message ? (
              <Text style={styles.errorText}>{errors.password.message}</Text>
            ) : null}
          </View>
        )}
      />

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
  feedback: {
    borderRadius: 14,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FECACA",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  feedbackText: {
    color: "#991B1B",
    fontSize: 14,
    lineHeight: 20,
  },
  inputGroup: {
    marginBottom: 12,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
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
  inputError: {
    borderColor: "#F87171",
  },
  input: {
    flex: 1,
    height: "100%",
    marginLeft: 10,
    fontSize: 16,
    color: colors.text,
  },
  errorText: {
    color: "#B91C1C",
    fontSize: 13,
    marginTop: 6,
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
