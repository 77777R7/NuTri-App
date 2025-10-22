import React, { useState, useEffect, useMemo } from "react";
import { Alert, Platform, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import * as AppleAuthentication from "expo-apple-authentication";
import { useAuth, getPostAuthDestination } from "@/contexts/AuthContext";
import { getAuthErrorMessage } from "@/lib/errors";
import { colors } from "@/lib/theme";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "@/components/ui/nativewind-primitives";

export const unstable_settings = { headerShown: false };

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ redirect?: string }>();
  const redirectParam = useMemo(
    () => (typeof params.redirect === "string" ? decodeURIComponent(params.redirect) : null),
    [params.redirect]
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
  const [socialLoading, setSocialLoading] = useState<"google" | "apple" | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  /** handle redirect after successful session */
  useEffect(() => {
    if (!loading && session) {
      const destination = getPostAuthDestination(postAuthRedirect ?? redirectParam);
      setPostAuthRedirect(null);
      router.replace(destination);
    }
  }, [loading, session, redirectParam, router, postAuthRedirect, setPostAuthRedirect]);

  /** show error toast */
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

  /** Email + Password sign in */
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

  /** Google OAuth */
  const onGoogle = async () => {
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

  /** Apple OAuth */
  const onApple = async () => {
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

  /** Face ID / Biometrics */
  const onBiometric = async () => {
    try {
      const success = await authenticateWithBiometrics();
      if (success) {
        const destination = getPostAuthDestination(postAuthRedirect ?? redirectParam);
        setPostAuthRedirect(null);
        router.replace(destination);
      }
    } catch (err) {
      showInlineMessage(getAuthErrorMessage(err));
    }
  };

  const isBusy = submitting || socialLoading !== null || loading;

  return (
    <LinearGradient colors={["#E6F7F3", "#FFFFFF"]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <Image
          source={require("@/assets/images/icon.png")}
          style={{ width: 100, height: 100, marginBottom: 10 }}
          resizeMode="contain"
        />
        <Text style={{ fontSize: 30, fontWeight: "700", color: "#4CD1B1" }}>NuTri</Text>
        <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 24 }}>Welcome to NuTri 🌿</Text>

        {/* Card */}
        <View
          style={{
            width: "100%",
            maxWidth: 380,
            backgroundColor: "white",
            borderRadius: 20,
            padding: 24,
            shadowColor: "#000",
            shadowOpacity: 0.08,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 5,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "600", marginBottom: 16 }}>Member Access</Text>

          {/* Email */}
          <View style={{ marginBottom: 12 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "#F9FAFB",
                borderRadius: 10,
                paddingHorizontal: 12,
                borderWidth: 1,
                borderColor: "#E5E7EB",
              }}
            >
              <Ionicons name="mail-outline" size={20} color="#9CA3AF" />
              <TextInput
                placeholder="you@example.com"
                placeholderTextColor="#9CA3AF"
                style={{ flex: 1, height: 44, marginLeft: 8 }}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>
          </View>

          {/* Password */}
          <View style={{ marginBottom: 8 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "#F9FAFB",
                borderRadius: 10,
                paddingHorizontal: 12,
                borderWidth: 1,
                borderColor: "#E5E7EB",
              }}
            >
              <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" />
              <TextInput
                placeholder="Enter your password"
                placeholderTextColor="#9CA3AF"
                secureTextEntry
                style={{ flex: 1, height: 44, marginLeft: 8 }}
                value={password}
                onChangeText={setPassword}
              />
            </View>
          </View>

          {/* Forgot + Biometrics */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
            <TouchableOpacity onPress={() => router.push("/auth/forgot-password")}>
              <Text style={{ color: colors.brand, fontWeight: "500" }}>Forgot password?</Text>
            </TouchableOpacity>
            {isBiometricEnabled && (
              <TouchableOpacity onPress={onBiometric} disabled={isBusy}>
                <Text
                  style={{
                    color: colors.brandDark,
                    fontWeight: "500",
                    opacity: isBusy ? 0.5 : 1,
                  }}
                >
                  Use Face ID
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Sign In */}
          <TouchableOpacity
            onPress={onEmailPassword}
            disabled={isBusy}
            style={{
              backgroundColor: "#4CD1B1",
              paddingVertical: 14,
              borderRadius: 10,
              alignItems: "center",
              marginBottom: 16,
              opacity: isBusy ? 0.7 : 1,
            }}
          >
            {submitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: "white", fontWeight: "700", fontSize: 16 }}>Sign In</Text>
            )}
          </TouchableOpacity>

          {/* Divider */}
          <View className="my-6 flex flex-row items-center">
            <View className="h-px flex-1 bg-gray-200" />
            <Text className="mx-3 text-sm text-gray-400">Or continue with</Text>
            <View className="h-px flex-1 bg-gray-200" />
          </View>

          {/* Social Login */}
          <View className="w-full items-center space-y-3">
            <TouchableOpacity
              onPress={onGoogle}
              disabled={isBusy}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
              className={`w-full max-w-[360px] h-12 flex-row items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm ${
                isBusy ? "opacity-60" : ""
              }`}
            >
              {socialLoading === "google" ? (
                <ActivityIndicator color="#DB4437" />
              ) : (
                <>
                  <Ionicons name="logo-google" size={20} color="#DB4437" />
                  <Text className="ml-2 font-semibold text-gray-700">Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>

            {appleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={999}
                onPress={isBusy ? undefined : onApple}
                accessibilityLabel="Continue with Apple"
                style={styles.appleButton}
              />
            ) : (
              <TouchableOpacity
                onPress={onApple}
                disabled={isBusy || Platform.OS !== "ios"}
                accessibilityRole="button"
                accessibilityLabel="Continue with Apple"
                className={`w-full max-w-[360px] h-12 flex-row items-center justify-center rounded-full bg-black ${
                  Platform.OS !== "ios" ? "opacity-40" : ""
                } ${isBusy ? "opacity-60" : ""}`}
              >
                {socialLoading === "apple" ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="logo-apple" size={20} color="#FFFFFF" />
                    <Text className="ml-2 font-semibold text-white">Continue with Apple</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Footer */}
          <View style={{ alignItems: "center", marginTop: 16 }}>
            <Text style={{ color: "#6B7280", fontSize: 13, marginBottom: 6 }}>
              Don’t have an account?{" "}
              <Link href="/auth/signup" style={{ color: "#4CD1B1", fontWeight: "600" }}>
                Create one
              </Link>
            </Text>
            <Text style={{ color: "#6B7280", fontSize: 12, textAlign: "center" }}>
              By continuing you agree to NuTri’s{" "}
              <Text style={{ color: "#4CD1B1" }}>Terms of Service</Text> and{" "}
              <Text style={{ color: "#4CD1B1" }}>Privacy Policy</Text>.
            </Text>
          </View>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  appleButton: {
    width: "100%",
    maxWidth: 360,
    height: 48,
    borderRadius: 999,
  },
});
