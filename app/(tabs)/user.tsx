import React, { useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { ScrollView, Text, View } from '@/components/ui/nativewind-primitives';

export default function UserScreen() {
  const { t } = useTranslation();
  const {
    user,
    token,
    signOut,
    loading,
    isBiometricEnabled,
    enableBiometrics,
    disableBiometrics,
  } = useAuth();
  const loggedIn = Boolean(token);
  const [biometricLoading, setBiometricLoading] = useState(false);

  const handleToggleBiometrics = async () => {
    try {
      setBiometricLoading(true);
      if (isBiometricEnabled) {
        await disableBiometrics();
        Alert.alert('Biometrics disabled', 'You can re-enable Face ID or Fingerprint anytime.');
      } else {
        await enableBiometrics();
        Alert.alert('Biometrics enabled', 'Next time you open NuTri we will ask for Face ID or Fingerprint.');
      }
    } catch (error) {
      Alert.alert('Biometric error', error instanceof Error ? error.message : 'Unable to configure biometrics.');
    } finally {
      setBiometricLoading(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-background px-5 pt-6" contentContainerStyle={{ paddingBottom: 120 }}>
      <Card className="gap-4">
        <Text className="text-xl font-semibold text-gray-900 dark:text-white">{t.userTitle}</Text>
        <Text className="text-sm text-muted">{t.userSubtitle}</Text>
        {loggedIn ? (
          <View className="gap-2">
            <Text className="text-base text-gray-700 dark:text-gray-200">{user?.email ?? user?.id}</Text>
            <View className="rounded-2xl bg-primary-50 px-4 py-3">
              <Text className="text-sm font-semibold text-primary-600">
                {t.userPlanLabel}: {user?.user_metadata?.subscription ?? t.userPlanFree}
              </Text>
              <Text className="text-xs text-muted">{t.userPlanHint}</Text>
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1 rounded-2xl bg-surface px-4 py-3 shadow-soft">
                <Text className="text-xs font-semibold text-muted uppercase tracking-wide">{t.userRoleLabel}</Text>
                <Text className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
                  {user?.role ?? t.userRoleMember}
                </Text>
              </View>
              <View className="flex-1 rounded-2xl bg-surface px-4 py-3 shadow-soft">
                <Text className="text-xs font-semibold text-muted uppercase tracking-wide">{t.userAccountIdLabel}</Text>
                <Text className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
                  {user?.id.slice(0, 8)}...
                </Text>
              </View>
            </View>
            <Button
              label={isBiometricEnabled ? 'Disable Face ID / Fingerprint' : 'Enable Face ID / Fingerprint'}
              onPress={handleToggleBiometrics}
              variant={isBiometricEnabled ? 'secondary' : 'primary'}
              loading={biometricLoading}
            />
            <Button
              label={t.userSignOut}
              onPress={async () => {
                await signOut();
              }}
              loading={loading}
            />
          </View>
        ) : (
          <View className="gap-3">
            <Text className="text-sm text-muted">{t.userSignedOut}</Text>
            <Button
              label={t.userSignInCta}
              onPress={() => router.push('/(tabs)/home')}
              variant="secondary"
            />
          </View>
        )}
      </Card>

      <Card className="mt-6 gap-3">
        <Text className="text-lg font-semibold text-gray-900 dark:text-white">{t.userPreferencesTitle}</Text>
        <Text className="text-sm text-muted">{t.userPreferencesDescription}</Text>
        <View className="flex-row gap-3">
          <View className="flex-1 rounded-2xl bg-primary-50 p-4">
            <Text className="text-sm font-semibold text-primary-600">{t.userNotificationsTitle}</Text>
            <Text className="mt-1 text-xs text-muted">{t.userNotificationsHint}</Text>
          </View>
          <View className="flex-1 rounded-2xl bg-primary-50 p-4">
            <Text className="text-sm font-semibold text-primary-600">{t.userDataControlTitle}</Text>
            <Text className="mt-1 text-xs text-muted">{t.userDataControlHint}</Text>
          </View>
        </View>
      </Card>
    </ScrollView>
  );
}
