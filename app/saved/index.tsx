import React, { useCallback, useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { Card } from '@/components/ui/card';
import { SupplementItem } from '@/components/ui/supplement-item';
import { apiClient, HomeDashboardResponse } from '@/lib/api-client';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { RefreshControl, ScrollView, Text, View } from '@/components/ui/nativewind-primitives';

type SavedSupplements = NonNullable<HomeDashboardResponse['data']>['savedSupplements'];

export default function SavedScreen() {
  const { t } = useTranslation();
  const { token, loading: authLoading } = useAuth();
  const [saved, setSaved] = useState<SavedSupplements>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) {
        setLoading(true);
      }
      try {
        const response = await apiClient.homeDashboard({ token });
        if (response.success && response.data) {
          setSaved(response.data.savedSupplements);
          setError(null);
        } else {
          setError(response.message ?? t.dashboardLoadError);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t.dashboardLoadError);
      } finally {
        setLoading(false);
      }
    },
    [token, t],
  );

  useEffect(() => {
    if (authLoading) return;
    load();
  }, [authLoading, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }, [load]);

  return (
    <>
      <Stack.Screen options={{ title: t.quickActionSaved }} />
      <ScrollView
        className="flex-1 bg-background px-5 pt-6"
        contentContainerStyle={{ paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2CC2B3" />}
      >
        <Card className="mb-5 gap-4">
          <Text className="text-lg font-semibold text-gray-900 dark:text-white">{t.savedVitaminsTitle}</Text>
          <Text className="text-sm text-muted">{t.savedPageDescription}</Text>
        </Card>

        {error ? (
          <Card className="mb-4 border border-red-200 bg-red-50 dark:bg-red-900/20">
            <Text className="text-sm font-medium text-red-700 dark:text-red-200">{error}</Text>
          </Card>
        ) : null}

        <Card className="gap-4">
          {loading ? (
            <View className="gap-3">
              {[0, 1, 2].map(index => (
                <View key={index} className="h-16 rounded-2xl bg-primary-100/60" />
              ))}
            </View>
          ) : saved.length === 0 ? (
            <Text className="text-sm text-muted">{t.emptySavedVitamins}</Text>
          ) : (
            saved.map(item => (
              <SupplementItem
                key={item.id}
                name={item.name}
                description={item.brand}
                dosage={item.category}
                thumbnail={item.imageUrl ?? undefined}
                onActionPress={() => router.push('/database')}
                actionLabel={t.viewDetails}
              />
            ))
          )}
        </Card>
      </ScrollView>
    </>
  );
}
