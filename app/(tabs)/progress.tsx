import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { SectionHeading } from '@/components/ui/section-heading';
import { RefreshControl, ScrollView, Text, View } from '@/components/ui/nativewind-primitives';
import { apiClient, HomeDashboardResponse } from '@/lib/api-client';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';

export default function ProgressScreen() {
  const { t } = useTranslation();
  const { token, loading: authLoading } = useAuth();
  const [metrics, setMetrics] = useState<NonNullable<HomeDashboardResponse['data']>['overviewMetrics']>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setLoading(true);
      try {
        const response = await apiClient.homeDashboard({ token });
        if (response.success && response.data) {
          setMetrics(response.data.overviewMetrics);
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

  const weeklyScans = useMemo(
    () => metrics.find(metric => metric.key === 'weekly_scans'),
    [metrics],
  );
  const savedCount = useMemo(
    () => metrics.find(metric => metric.key === 'saved'),
    [metrics],
  );
  const uploads = useMemo(
    () => metrics.find(metric => metric.key === 'recent_uploads'),
    [metrics],
  );

  const renderMetricCard = (metric?: typeof metrics[number], accent: 'mint' | 'amber' | 'sky' = 'mint') => {
    if (!metric) {
      return (
        <Card className="flex-1 gap-3">
          <View className="h-20 rounded-2xl bg-primary-100/60" />
        </Card>
      );
    }

    const accentBackground =
      accent === 'mint' ? 'bg-primary-50' : accent === 'amber' ? 'bg-amber-100' : 'bg-sky-100';
    const accentText = accent === 'mint' ? 'text-primary-600' : accent === 'amber' ? 'text-amber-600' : 'text-sky-600';

    return (
      <Card className="flex-1 gap-3 shadow-soft">
        <Text className="text-sm font-medium text-muted">{metric.label}</Text>
        <Text className="text-3xl font-semibold text-gray-900 dark:text-white">{metric.current}</Text>
        <View className="rounded-2xl bg-black/5 p-3">
          <View className="h-2 w-full rounded-full bg-white/60 dark:bg-white/10">
            <View
              className="h-2 rounded-full bg-primary-500"
              style={{ width: `${Math.min(100, Math.round(metric.progress * 100))}%` }}
            />
          </View>
          <Text className="mt-2 text-xs text-muted">{metric.summary}</Text>
        </View>
        <View className={`self-start rounded-full px-3 py-1 ${accentBackground}`}>
          <Text className={`text-xs font-medium ${accentText}`}>
            {t.progressTargetPrefix} {metric.target}
          </Text>
        </View>
      </Card>
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-background px-5 pt-6"
      contentContainerStyle={{ paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2CC2B3" />}
    >
      <SectionHeading title={t.progressTitle} subtitle={t.progressSubtitle} />

      {error ? (
        <Card className="mb-4 border border-red-200 bg-red-50 dark:bg-red-900/20">
          <Text className="text-sm font-medium text-red-700 dark:text-red-200">{error}</Text>
        </Card>
      ) : null}

      <View className="flex-row gap-4">
        {loading ? (
          <>
            <Card className="h-32 flex-1 bg-primary-100/60" />
            <Card className="h-32 flex-1 bg-primary-100/60" />
          </>
        ) : (
          <>
            {renderMetricCard(weeklyScans, 'mint')}
            {renderMetricCard(savedCount, 'sky')}
          </>
        )}
      </View>

      <SectionHeading title={t.progressUploadsTitle} className="mt-8" subtitle={t.progressUploadsSubtitle} />
      <Card className="gap-3">
        {loading ? (
          <View className="h-20 rounded-2xl bg-primary-100/60" />
        ) : uploads ? (
          <>
            <Text className="text-xl font-semibold text-gray-900 dark:text-white">{uploads.current}</Text>
            <Text className="text-sm text-muted">{uploads.summary}</Text>
            <View className="rounded-2xl bg-primary-50 px-4 py-3">
              <Text className="text-xs font-medium text-primary-600">{t.progressUploadsHint}</Text>
            </View>
          </>
        ) : (
          <Text className="text-sm text-muted">{t.progressUploadsEmpty}</Text>
        )}
      </Card>

      <SectionHeading title={t.progressRewardsTitle} className="mt-8" />
      <Card className="gap-4">
        <Text className="text-base font-semibold text-gray-900 dark:text-white">{t.progressRewardsSoon}</Text>
        <Text className="text-sm text-muted">{t.progressRewardsDescription}</Text>
        <View className="flex-row gap-3">
          <View className="flex-1 rounded-2xl bg-primary-50 p-4">
            <Text className="text-sm font-semibold text-primary-600">{t.progressBadgeTracker}</Text>
            <Text className="mt-1 text-xs text-muted">{t.progressBadgeTrackerHint}</Text>
          </View>
          <View className="flex-1 rounded-2xl bg-primary-50 p-4">
            <Text className="text-sm font-semibold text-primary-600">{t.progressHydrationBadge}</Text>
            <Text className="mt-1 text-xs text-muted">{t.progressHydrationHint}</Text>
          </View>
        </View>
      </Card>
    </ScrollView>
  );
}
