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
import { encodeAuthRedirectParam, normalizeAuthRedirectParam } from "@/lib/auth-session";
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
    return normalizeAuthRedirectParam(candidate);
  }, [params.redirect, postAuthRedirect]);
  const isGuestClaimRedirect = redirectTarget?.includes("/guest-scan/claim") === true;

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
      title="Welcome back"
      subtitle="Sign in to continue."
      contentOffsetTop={44}
      topBarOffset={0}
      footer={
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            New to NuTri?{" "}
            <Text
              onPress={() => {
                if (redirectTarget) {
                  router.push({
                    pathname: "/auth/signup",
                    params: { redirect: encodeAuthRedirectParam(redirectTarget) },
                  });
                  return;
                }
                router.push("/auth/signup");
              }}
              style={styles.footerLink}
            >
              Create account
            </Text>
          </Text>
        </View>
      }
    >
      {isGuestClaimRedirect ? (
        <View style={styles.feedbackInfo}>
          <Text style={styles.feedbackTextInfo}>
            Sign in to save this scan and keep its personalized insights with your account.
          </Text>
        </View>
      ) : null}

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
            <View style={[styles.inputRow, errors.email ? styles.inputError : undefined]}>
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
                placeholder="Email Address"
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
            <View style={[styles.inputRow, errors.password ? styles.inputError : undefined]}>
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
                placeholder="Password"
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
          <Text style={styles.primaryLabel}>SIGN IN</Text>
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
        topGap={22}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  feedback: {
    borderRadius: 14,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FECACA",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  feedbackInfo: {
    borderRadius: 14,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  feedbackText: {
    color: "#991B1B",
    fontSize: 14,
    lineHeight: 20,
  },
  feedbackTextInfo: {
    color: "#1E3A8A",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#E7E7E7",
    paddingHorizontal: 22,
    height: 58,
  },
  inputError: {
    borderColor: "#F87171",
  },
  input: {
    flex: 1,
    height: "100%",
    fontSize: 18,
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
    marginTop: -2,
    marginBottom: 20,
  },
  linkPrimary: {
    color: "#0B1020",
    fontWeight: "700",
  },
  linkSecondary: {
    color: "#1E40AF",
    fontWeight: "800",
  },
  faded: {
    opacity: 0.5,
  },
  primaryButton: {
    height: 58,
    borderRadius: 999,
    backgroundColor: "#050505",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  primaryLabel: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.6,
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
    backgroundColor: "rgba(15,23,42,0.10)",
  },
  dividerText: {
    fontSize: 13,
    color: "rgba(11,16,32,0.56)",
    fontWeight: "600",
  },
  footer: {
    alignItems: "center",
    gap: 8,
  },
  footerText: {
    color: "rgba(11,16,32,0.58)",
    fontSize: 14,
    textAlign: "center",
  },
  footerLink: {
    color: "#050505",
    fontWeight: "800",
  },
});
