import React, { useEffect, useMemo, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { Modal, Pressable, ScrollView, Text, View } from '@/components/ui/nativewind-primitives';
import { Card } from '@/components/ui/card';
import { CalendarStrip } from '@/components/ui/calendar-strip';
import { FloatingAddButton } from '@/components/ui/floating-add-button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { QuickAction, QuickActions } from '@/components/ui/quick-actions';
import { SectionHeading } from '@/components/ui/section-heading';
import { SupplementItem } from '@/components/ui/supplement-item';
import { apiClient, HomeDashboardResponse } from '@/lib/api-client';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';

const formatUploadTimestamp = (
  iso: string,
  locale: string,
  t: ReturnType<typeof useTranslation>['t'],
) => {
  const date = new Date(iso);
  const now = new Date();

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const timeFormatter = new Intl.DateTimeFormat(locale.startsWith('zh') ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (isSameDay(date, now)) {
    return `${t.todayLabel} · ${timeFormatter.format(date)}`;
  }

  if (isSameDay(date, yesterday)) {
    return `${t.yesterdayLabel} · ${timeFormatter.format(date)}`;
  }

  const dateFormatter = new Intl.DateTimeFormat(locale.startsWith('zh') ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  });

  return `${dateFormatter.format(date)} · ${timeFormatter.format(date)}`;
};

export default function HomeScreen() {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const { user, token, loading: authLoading } = useAuth();
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isActionSheetOpen, setActionSheetOpen] = useState(false);
  const [dashboard, setDashboard] = useState<HomeDashboardResponse['data'] | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  const displayName = user?.email?.split('@')[0] ?? 'NuTri Member';

  useEffect(() => {
    let isMounted = true;

    if (authLoading) {
      return () => {
        isMounted = false;
      };
    }

    const loadDashboard = async () => {
      try {
        setDashboardLoading(true);
        const response = await apiClient.homeDashboard({ token });

        if (!isMounted) return;

        if (response.success) {
          setDashboard(response.data ?? { savedSupplements: [], recentUploads: [], overviewMetrics: [] });
          setDashboardError(null);
        } else {
          setDashboard(null);
          setDashboardError(response.message ?? t.dashboardLoadError);
        }
      } catch (error) {
        if (!isMounted) return;
        setDashboardError(error instanceof Error ? error.message : t.dashboardLoadError);
      } finally {
        if (isMounted) {
          setDashboardLoading(false);
        }
      }
    };

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, [token, authLoading, t]);

  const quickActions = useMemo<QuickAction[]>(
    () => [
      {
        label: t.quickActionSaved,
        caption: t.quickActionSavedCaption,
        icon: 'bookmark.fill',
        accent: 'mint',
        onPress: () => router.push('/saved'),
      },
      {
        label: t.quickActionScan,
        caption: t.quickActionScanCaption,
        icon: 'camera.viewfinder',
        accent: 'sky',
        onPress: () => router.push('/(tabs)/scan'),
      },
      {
        label: t.quickActionDatabase,
        caption: t.quickActionDatabaseCaption,
        icon: 'tray.full.fill',
        accent: 'amber',
        onPress: () => router.push('/database'),
      },
      {
        label: t.quickActionAI,
        caption: t.quickActionAICaption,
        icon: 'sparkles',
        accent: 'rose',
        onPress: () => router.push('/assistant'),
      },
    ],
    [router, t],
  );

  const savedSupplements = dashboard?.savedSupplements ?? [];
  const recentUploads = dashboard?.recentUploads ?? [];
  const overviewMetrics = dashboard?.overviewMetrics ?? [];

  const handleOpenActionSheet = () => setActionSheetOpen(true);

  const handleActionPress = (action: QuickAction) => {
    setActionSheetOpen(false);
    requestAnimationFrame(() => action.onPress?.());
  };

  return (
    <View className="relative flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 140 }}>
        <View className="px-5 pt-10">
          <View className="mb-6 gap-1">
            <Text className="text-sm font-medium uppercase tracking-wide text-muted">{t.todaysOverview}</Text>
            <Text className="text-3xl font-semibold text-gray-900 dark:text-white">
              {t.greetingMorning}, {displayName}
            </Text>
            <Text className="text-base text-gray-500 dark:text-gray-400">{t.homeSubtitle}</Text>
          </View>

          {dashboardError ? (
            <Card className="mb-4 border border-red-200 bg-red-50 dark:bg-red-900/20">
              <Text className="text-sm font-medium text-red-700 dark:text-red-200">{dashboardError}</Text>
            </Card>
          ) : null}

          <Card className="mb-6 gap-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-semibold text-gray-900 dark:text-white">{t.calendarTitle}</Text>
              <View className="flex-row items-center gap-1 rounded-full bg-primary-50 px-3 py-1">
                <IconSymbol name="sparkles" size={16} color="#2CC2B3" />
                <Text className="text-xs font-medium text-primary-600">{t.balanceMode}</Text>
              </View>
            </View>
            <CalendarStrip selectedDate={selectedDate} onSelectDate={setSelectedDate} />
            <View className="mt-4 rounded-3xl bg-primary-50 px-4 py-3">
              <Text className="text-sm font-medium text-primary-600">{t.calendarEmptyState}</Text>
            </View>
          </Card>

          <Card className="mb-6">
            <SectionHeading title={t.quickActionsTitle} className="mb-4" />
            <QuickActions actions={quickActions} />
          </Card>

          <Card className="mb-6 gap-4">
            <SectionHeading title={t.supplementListTitle} subtitle={t.savedVitaminsTitle} />
            {dashboardLoading ? (
              <View className="gap-3">
                {[0, 1, 2].map(index => (
                  <View key={index} className="h-16 rounded-2xl bg-primary-100/60" />
                ))}
              </View>
            ) : savedSupplements.length === 0 ? (
              <Text className="text-sm text-muted">{t.emptySavedVitamins}</Text>
            ) : (
              savedSupplements.map(item => (
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

          <Card className="mb-6 gap-4">
            <SectionHeading title={t.recentlyUploadedTitle} />
            {dashboardLoading ? (
              <View className="gap-3">
                {[0, 1].map(index => (
                  <View key={index} className="h-20 rounded-2xl bg-primary-100/60" />
                ))}
              </View>
            ) : recentUploads.length === 0 ? (
              <Text className="text-sm text-muted">{t.emptyUploads}</Text>
            ) : (
              recentUploads.map(upload => (
                <View
                  key={upload.id}
                  className="flex-row items-center justify-between rounded-2xl bg-primary-50 px-4 py-3"
                >
                  <View className="max-w-[70%]">
                    <Text className="text-sm font-semibold text-gray-900 dark:text-white" numberOfLines={1}>
                      {upload.title}
                    </Text>
                    <Text className="text-xs text-muted">
                      {formatUploadTimestamp(upload.createdAt, locale, t)}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <View
                      className={`h-2 w-2 rounded-full ${
                        upload.status === 'ready' ? 'bg-primary-600' : 'bg-amber-400'
                      }`}
                    />
                    <Text className="text-xs font-medium text-primary-600">
                      {upload.status === 'ready' ? t.statusReady : t.statusProcessing}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </Card>

          <Card className="mb-6 gap-3">
            <SectionHeading title={t.todaysOverview} />
            {dashboardLoading ? (
              <View className="flex-row flex-wrap gap-3">
                {[0, 1, 2].map(index => (
                  <View key={index} className="h-32 flex-1 rounded-2xl bg-primary-100/60" />
                ))}
              </View>
            ) : overviewMetrics.length === 0 ? (
              <Text className="text-sm text-muted">{t.overviewEmpty}</Text>
            ) : (
              <View className="flex-row flex-wrap gap-3">
                {overviewMetrics.map(metric => (
                  <View key={metric.key} className="min-w-[45%] flex-1 rounded-2xl bg-primary-50 p-4">
                    <Text className="text-sm font-medium text-muted">{metric.label}</Text>
                    <Text className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
                      {Math.round(metric.progress * 100)}%
                    </Text>
                    <Text className="mt-1 text-xs text-muted">{metric.summary}</Text>
                  </View>
                ))}
              </View>
            )}
          </Card>
        </View>
      </ScrollView>

      <FloatingAddButton
        onPress={dashboardLoading ? undefined : handleOpenActionSheet}
        label={dashboardLoading ? t.loading : t.addButtonLabel}
        disabled={dashboardLoading}
      />

      <Modal visible={isActionSheetOpen} transparent animationType="fade">
        <Pressable
          className="flex-1 bg-black/40"
          onPress={() => setActionSheetOpen(false)}
        >
          <Pressable
            onPress={(event: GestureResponderEvent) => event.stopPropagation()}
            className="mt-auto rounded-t-3xl bg-surface px-6 pb-10 pt-6 shadow-card"
          >
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-lg font-semibold text-gray-900 dark:text-white">{t.addOptionsTitle}</Text>
              <Pressable
                onPress={() => setActionSheetOpen(false)}
                className="h-8 w-8 items-center justify-center rounded-full bg-primary-50"
              >
                <IconSymbol name="chevron.right" size={18} color="#2CC2B3" style={{ transform: [{ rotate: '90deg' }] }} />
              </Pressable>
            </View>
            {quickActions.map(action => (
              <Pressable
                key={action.label}
                onPress={(event: GestureResponderEvent) => {
                  event.stopPropagation();
                  handleActionPress(action);
                }}
                className="mb-3 flex-row items-center justify-between rounded-2xl border border-border px-4 py-3"
              >
                <View className="flex-row items-center gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-2xl bg-primary-50">
                    <IconSymbol name={action.icon} size={20} color="#2CC2B3" />
                  </View>
                  <View>
                    <Text className="text-sm font-semibold text-gray-900 dark:text-white">{action.label}</Text>
                    {action.caption ? <Text className="text-xs text-muted">{action.caption}</Text> : null}
                  </View>
                </View>
                <IconSymbol name="chevron.right" size={18} color="#A3B9B4" />
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
