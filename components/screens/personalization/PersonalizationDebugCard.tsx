import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { apiClient, type GoalNavigatorBundleDebugResponse } from '@/lib/api-client';
import type { PersonalizationEventSummary, SupportState } from '@/types/personalization';

type PersonalizationDebugCardProps = {
  supportState: SupportState;
  eventSummary: PersonalizationEventSummary;
};

const formatRelativeTimestamp = (value?: string | null) => {
  if (!value) return 'No recent events';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return 'Updated just now';
  if (diffMinutes < 60) return `Updated ${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `Updated ${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `Updated ${diffDays}d ago`;
};

const percentLabel = (value: number) => `${Math.round(value * 100)}%`;

const supportLabel = (value: SupportState) => value.charAt(0).toUpperCase() + value.slice(1);

export function PersonalizationDebugCard({
  supportState,
  eventSummary,
}: PersonalizationDebugCardProps) {
  const [snapshot, setSnapshot] = useState<GoalNavigatorBundleDebugResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await apiClient.fetchGoalNavigatorBundleDebug({ limit: 5 });
      setSnapshot(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load debug snapshot');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const decisionEventCount = useMemo(
    () =>
      (eventSummary.countsByEventName.goal_navigator_opened ?? 0) +
      (eventSummary.countsByEventName.goal_fit_detail_opened ?? 0) +
      (eventSummary.countsByEventName.compare_opened ?? 0),
    [eventSummary.countsByEventName],
  );
  const installEventCount = useMemo(
    () =>
      (eventSummary.countsByEventName.first_stack_accepted ?? 0) +
      (eventSummary.countsByEventName.schedule_edited ?? 0),
    [eventSummary.countsByEventName],
  );
  const topPriorities = snapshot?.summary.priorities.slice(0, 3) ?? [];

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>Internal Debug</Text>
          <Text style={styles.title}>Personalization runtime</Text>
          <Text style={styles.body}>
            State, recent event pressure, and Goal Navigator bundle health in one place.
          </Text>
        </View>
        <Pressable onPress={() => void loadSnapshot()} style={styles.refreshButton}>
          <Text style={styles.refreshButtonText}>{loading ? 'Refreshing…' : 'Refresh'}</Text>
        </Pressable>
      </View>

      <View style={styles.metricGrid}>
        <View style={styles.metricTile}>
          <Text style={styles.metricLabel}>Support</Text>
          <Text style={styles.metricValue}>{supportLabel(supportState)}</Text>
        </View>
        <View style={styles.metricTile}>
          <Text style={styles.metricLabel}>Events</Text>
          <Text style={styles.metricValue}>{eventSummary.totalCount}</Text>
        </View>
        <View style={styles.metricTile}>
          <Text style={styles.metricLabel}>Decision opens</Text>
          <Text style={styles.metricValue}>{decisionEventCount}</Text>
        </View>
        <View style={styles.metricTile}>
          <Text style={styles.metricLabel}>Install signals</Text>
          <Text style={styles.metricValue}>{installEventCount}</Text>
        </View>
      </View>

      <View style={styles.runtimeRow}>
        <View style={styles.runtimeTile}>
          <Text style={styles.runtimeLabel}>Last event</Text>
          <Text style={styles.runtimeValue}>{formatRelativeTimestamp(eventSummary.lastEventAt)}</Text>
        </View>
        <View style={styles.runtimeTile}>
          <Text style={styles.runtimeLabel}>Bundle source</Text>
          <Text style={styles.runtimeValue}>
            {snapshot?.runtime.currentBundle.source ?? 'Not loaded'}
          </Text>
        </View>
        <View style={styles.runtimeTile}>
          <Text style={styles.runtimeLabel}>Precomputed hit rate</Text>
          <Text style={styles.runtimeValue}>
            {snapshot ? percentLabel(snapshot.runtime.counters.precomputedHitRate) : '—'}
          </Text>
        </View>
        <View style={styles.runtimeTile}>
          <Text style={styles.runtimeLabel}>Fallback builds</Text>
          <Text style={styles.runtimeValue}>
            {snapshot?.runtime.counters.fallbackToLiveBuildCount ?? 0}
          </Text>
        </View>
      </View>

      {loading && !snapshot ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#2563eb" />
          <Text style={styles.loadingText}>Loading runtime bundle snapshot…</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {snapshot ? (
        <View style={styles.summaryBlock}>
          <Text style={styles.sectionTitle}>Active bundle</Text>
          <Text style={styles.summaryText}>
            {snapshot.run?.preparedCandidateCount ?? 0} prepared,{' '}
            {snapshot.run?.notEnoughStructuredDataCount ?? 0} held back,{' '}
            {snapshot.summary.totalGapRows} current gap rows.
          </Text>
          <Text style={styles.sectionTitle}>Top remediation priorities</Text>
          {topPriorities.length > 0 ? (
            topPriorities.map((priority) => (
              <View key={priority.key} style={styles.priorityRow}>
                <Text style={styles.priorityKey}>
                  {priority.key.replace(/_/g, ' ')} · {priority.affectedProducts}
                </Text>
                <Text style={styles.priorityBody}>{priority.recommendedAction}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.summaryText}>No open gap priorities right now.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.1)',
    backgroundColor: '#f8fbff',
    padding: 20,
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 6,
  },
  eyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: '#2563eb',
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    color: '#0f172a',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#475569',
  },
  refreshButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#e0edff',
  },
  refreshButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: '#1d4ed8',
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricTile: {
    minWidth: 120,
    flexGrow: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  metricLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#64748b',
  },
  metricValue: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  runtimeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  runtimeTile: {
    minWidth: 140,
    flexGrow: 1,
    paddingHorizontal: 2,
    gap: 4,
  },
  runtimeLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#64748b',
  },
  runtimeValue: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    color: '#0f172a',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#475569',
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#b91c1c',
  },
  summaryBlock: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#334155',
  },
  summaryText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#334155',
  },
  priorityRow: {
    gap: 4,
    paddingTop: 2,
  },
  priorityKey: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  priorityBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#475569',
  },
});
