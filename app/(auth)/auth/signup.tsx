import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { useRouter } from "expo-router";
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
import { useAuth } from "@/contexts/AuthContext";
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
  const {
    signUpWithPassword,
    signInWithGoogle,
    signInWithApple,
    error,
    clearError,
    loading,
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
      title="Join NuTri today"
      subtitle="Create your account to personalise your supplement routine."
      contentOffsetTop={48}
      topBarOffset={12}
      footer={
        <Text style={styles.footerText}>
          Already have an account?{" "}
          <Text
            onPress={() => router.replace("/auth/login")}
            style={styles.footerLink}
          >
            Sign in
          </Text>
        </Text>
      }
    >
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
              <Text style={styles.label}>Email</Text>
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
                  placeholder="you@example.com"
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
              <Text style={styles.label}>Password</Text>
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
                  placeholder="Choose a strong password"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry
                  style={styles.input}
                  value={field.value}
                />
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
              <Text style={styles.label}>Confirm password</Text>
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
                  placeholder="Re-enter your password"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry
                  style={styles.input}
                  value={field.value}
                />
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
          <Text style={styles.primaryLabel}>Create account</Text>
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
      />

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => router.replace('/main')}
        style={styles.testButton}
        accessibilityLabel="Skip to main app (testing only)"
      >
        <Text style={styles.testButtonText}>Next (testing)</Text>
      </TouchableOpacity>
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
    backgroundColor: "#D1FAE5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  feedbackError: {
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  feedbackText: {
    fontSize: 14,
    fontWeight: "600",
  },
  feedbackTextSuccess: {
    color: "#047857",
  },
  feedbackTextError: {
    color: "#B91C1C",
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    height: 52,
  },
  inputError: {
    borderColor: "#F87171",
  },
  input: {
    flex: 1,
    height: "100%",
    fontSize: 16,
    color: colors.text,
  },
  errorText: {
    marginTop: 6,
    fontSize: 12,
    color: "#B91C1C",
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
  testButton: {
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: "#F0FDF4",
    alignItems: "center",
    justifyContent: "center",
  },
  testButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.brand,
    textTransform: "uppercase",
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
});
