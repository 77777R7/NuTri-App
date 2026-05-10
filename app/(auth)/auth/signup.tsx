import React, { useEffect, useMemo, useState } from "react";
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
import {
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "@/components/ui/nativewind-primitives";
import { getPostAuthDestination, useAuth } from "@/contexts/AuthContext";
import { encodeAuthRedirectParam, normalizeAuthRedirectParam } from "@/lib/auth-session";
import { AUTH_FALLBACK_PATH } from "@/lib/auth-mode";
import { getAuthErrorMessage } from "@/lib/errors";
import { colors } from "@/lib/theme";

const signupSchema = z
  .object({
    email: z.string().email("Please enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(8, "Please confirm your password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

type SignupForm = z.infer<typeof signupSchema>;

export const unstable_settings = { headerShown: false };

export default function SignupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ redirect?: string }>();
  const {
    session,
    signUpWithPassword,
    signInWithGoogle,
    signInWithApple,
    error,
    clearError,
    loading,
    postAuthRedirect,
    setPostAuthRedirect,
  } = useAuth();

  const {
    control,
    handleSubmit,
    formState: { errors },
    setError,
    reset,
  } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const [submitting, setSubmitting] = useState(false);
  const [socialLoading, setSocialLoading] = useState<"google" | "apple" | null>(
    null,
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [emailConfirmationPending, setEmailConfirmationPending] =
    useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);

  const redirectTarget = useMemo(() => {
    const encodedRedirect = typeof params.redirect === "string" ? params.redirect : null;
    const candidate = encodedRedirect ?? postAuthRedirect;
    return normalizeAuthRedirectParam(candidate);
  }, [params.redirect, postAuthRedirect]);
  const isGuestClaimRedirect = redirectTarget?.includes("/guest-scan/claim") === true;

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

  useEffect(() => {
    if (error) {
      setFeedback(error);
    }
  }, [error]);

  useEffect(() => {
    if (!loading && session) {
      const destination = redirectTarget ? getPostAuthDestination(redirectTarget) : "/";
      setPostAuthRedirect(null);
      router.replace(destination);
    }
  }, [loading, redirectTarget, router, session, setPostAuthRedirect]);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    Toast.show({
      type: emailConfirmationPending ? "success" : "error",
      text1: emailConfirmationPending ? "Account created" : "Sign up failed",
      text2: feedback,
    });
  }, [feedback, emailConfirmationPending]);

  const onSubmit = handleSubmit(async ({ email, password }: SignupForm) => {
    setSubmitting(true);
    clearError();
    setFeedback(null);
    setEmailConfirmationPending(false);

    try {
      await signUpWithPassword(email.trim(), password);
      setFeedback("Welcome to NuTri! Please confirm your email to unlock every feature.");
      setEmailConfirmationPending(true);
      reset({
        email,
        password: "",
        confirmPassword: "",
      });
    } catch (err) {
      const message = getAuthErrorMessage(err);
      setFeedback(message);

      if (message.toLowerCase().includes("password")) {
        setError("password", { message });
      }
    } finally {
      setSubmitting(false);
    }
  });

  const handleGoogleSignUp = async () => {
    if (loading || submitting) {
      return;
    }
    clearError();
    setSocialLoading("google");
    setFeedback(null);
    try {
      await signInWithGoogle();
    } catch (googleError) {
      setFeedback(getAuthErrorMessage(googleError));
    } finally {
      setSocialLoading(null);
    }
  };

  const handleAppleSignUp = async () => {
    if (loading || submitting) {
      return;
    }
    clearError();
    setSocialLoading("apple");
    setFeedback(null);
    try {
      await signInWithApple();
    } catch (appleError) {
      setFeedback(getAuthErrorMessage(appleError));
    } finally {
      setSocialLoading(null);
    }
  };

  const isBusy = submitting || loading || socialLoading !== null;

  return (
    <AuthShell
      showBack
      fallbackHref={AUTH_FALLBACK_PATH}
      title="Create account"
      subtitle="Save scans. Personalize results."
      contentOffsetTop={44}
      topBarOffset={0}
      footer={
        <Text style={styles.footerText}>
          Have an account?{" "}
          <Text
            onPress={() => {
              if (redirectTarget) {
                router.replace({
                  pathname: "/auth/login",
                  params: { redirect: encodeAuthRedirectParam(redirectTarget) },
                });
                return;
              }
              router.replace("/auth/login");
            }}
            style={styles.footerLink}
          >
            Sign in
          </Text>
        </Text>
      }
    >
      {isGuestClaimRedirect ? (
        <View style={[styles.feedback, styles.feedbackInfo]}>
          <Text style={styles.feedbackTextInfo}>
            Create a free account to save this scan and personalize it with your goals and allergies.
          </Text>
        </View>
      ) : null}

      {feedback ? (
        <View
          style={[
            styles.feedback,
            emailConfirmationPending ? styles.feedbackSuccess : styles.feedbackError,
          ]}
        >
          <Text
            style={[
              styles.feedbackText,
              emailConfirmationPending ? styles.feedbackTextSuccess : styles.feedbackTextError,
            ]}
          >
            {feedback}
          </Text>
        </View>
      ) : null}

      <Controller<SignupForm>
        control={control}
        name="email"
        render={(fieldProps: any) => {
          const { field } = fieldProps;
          return (
            <View style={styles.inputGroup}>
              <View
                style={[
                  styles.inputRow,
                  errors.email ? styles.inputError : undefined,
                ]}
              >
                <TextInput
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  keyboardType="email-address"
                  onBlur={field.onBlur}
                  onChangeText={field.onChange}
                  placeholder="Email Address"
                  placeholderTextColor="#9CA3AF"
                  style={styles.input}
                  value={field.value}
                />
              </View>
              {errors.email?.message ? (
                <Text style={styles.errorText}>{errors.email.message}</Text>
              ) : null}
            </View>
          );
        }}
      />

      <Controller<SignupForm>
        control={control}
        name="password"
        render={(fieldProps: any) => {
          const { field } = fieldProps;
          return (
            <View style={styles.inputGroup}>
              <View
                style={[
                  styles.inputRow,
                  errors.password ? styles.inputError : undefined,
                ]}
              >
                <TextInput
                  autoCapitalize="none"
                  onBlur={field.onBlur}
                  onChangeText={field.onChange}
                  placeholder="Password"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry={!passwordVisible}
                  style={styles.input}
                  value={field.value}
                />
                <TouchableOpacity
                  accessibilityLabel={passwordVisible ? "Hide password" : "Show password"}
                  accessibilityRole="button"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => setPasswordVisible(value => !value)}
                >
                  <Ionicons
                    name={passwordVisible ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color="#B5B5B5"
                  />
                </TouchableOpacity>
              </View>
              {errors.password?.message ? (
                <Text style={styles.errorText}>{errors.password.message}</Text>
              ) : null}
            </View>
          );
        }}
      />

      <Controller<SignupForm>
        control={control}
        name="confirmPassword"
        render={(fieldProps: any) => {
          const { field } = fieldProps;
          return (
            <View style={styles.inputGroup}>
              <View
                style={[
                  styles.inputRow,
                  errors.confirmPassword ? styles.inputError : undefined,
                ]}
              >
                <TextInput
                  autoCapitalize="none"
                  onBlur={field.onBlur}
                  onChangeText={field.onChange}
                  placeholder="Confirm Password"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry={!confirmPasswordVisible}
                  style={styles.input}
                  value={field.value}
                />
                <TouchableOpacity
                  accessibilityLabel={confirmPasswordVisible ? "Hide password" : "Show password"}
                  accessibilityRole="button"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => setConfirmPasswordVisible(value => !value)}
                >
                  <Ionicons
                    name={confirmPasswordVisible ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color="#B5B5B5"
                  />
                </TouchableOpacity>
              </View>
              {errors.confirmPassword?.message ? (
                <Text style={styles.errorText}>
                  {errors.confirmPassword.message}
                </Text>
              ) : null}
            </View>
          );
        }}
      />

      <TouchableOpacity
        activeOpacity={0.9}
        disabled={isBusy}
        onPress={onSubmit}
        style={[styles.primaryButton, isBusy && styles.disabled]}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryLabel}>SIGN UP</Text>
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
        onApple={handleAppleSignUp}
        onGoogle={handleGoogleSignUp}
        topGap={22}
      />

    </AuthShell>
  );
}

const styles = StyleSheet.create({
  feedback: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  feedbackSuccess: {
    backgroundColor: "#EEF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  feedbackError: {
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  feedbackInfo: {
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  feedbackText: {
    fontSize: 14,
    fontWeight: "600",
  },
  feedbackTextSuccess: {
    color: "#1E40AF",
  },
  feedbackTextError: {
    color: "#B91C1C",
  },
  feedbackTextInfo: {
    color: "#1E3A8A",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
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
    marginTop: 6,
    fontSize: 12,
    color: "#B91C1C",
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
