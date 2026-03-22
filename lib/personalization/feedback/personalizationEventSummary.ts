import type {
  PersonalizationEventName,
  PersonalizationEventRecord,
  PersonalizationEventSummary,
  SupportState,
} from '@/types/personalization';

export type PersonalizationEventSummaryRow = {
  event_name: string;
  surface: string | null;
  created_at: string;
  snapshot_id: string | null;
  rules_version: string | null;
  support_state: string | null;
};

export type PersonalizationEventLike = {
  eventName: PersonalizationEventName;
  surface?: string | null;
  snapshotId?: string | null;
  rulesVersion?: string | null;
  supportState?: SupportState | null;
};

export const createEmptyPersonalizationEventSummary = (): PersonalizationEventSummary => ({
  totalCount: 0,
  lastEventAt: null,
  countsByEventName: {},
  countsBySurface: {},
  recentEvents: [],
});

export const toPersonalizationEventRecord = (
  event: PersonalizationEventLike,
  createdAt: string,
): PersonalizationEventRecord => ({
  eventName: event.eventName,
  surface: event.surface?.trim() || 'unknown',
  createdAt,
  snapshotId: event.snapshotId ?? null,
  rulesVersion: event.rulesVersion ?? null,
  supportState: event.supportState ?? null,
});

export const summarizePersonalizationEvents = (
  rows: PersonalizationEventSummaryRow[],
  exactTotalCount?: number | null,
): PersonalizationEventSummary => {
  if (rows.length === 0 && !exactTotalCount) {
    return createEmptyPersonalizationEventSummary();
  }

  const countsByEventName: Partial<Record<PersonalizationEventName, number>> = {};
  const countsBySurface: Record<string, number> = {};
  const recentEvents: PersonalizationEventRecord[] = rows.map((row) => {
    const eventName = row.event_name as PersonalizationEventName;
    countsByEventName[eventName] = (countsByEventName[eventName] ?? 0) + 1;
    const surfaceKey = row.surface?.trim() || 'unknown';
    countsBySurface[surfaceKey] = (countsBySurface[surfaceKey] ?? 0) + 1;

    return {
      eventName,
      surface: surfaceKey,
      createdAt: row.created_at,
      snapshotId: row.snapshot_id,
      rulesVersion: row.rules_version,
      supportState: (row.support_state as SupportState | null | undefined) ?? null,
    };
  });

  return {
    totalCount: exactTotalCount ?? recentEvents.length,
    lastEventAt: recentEvents[0]?.createdAt ?? null,
    countsByEventName,
    countsBySurface,
    recentEvents,
  };
};

export const appendPersonalizationEventsToSummary = (
  summary: PersonalizationEventSummary,
  events: PersonalizationEventLike[],
  createdAt = new Date().toISOString(),
): PersonalizationEventSummary => {
  if (events.length === 0) return summary;

  const appendedRecords = events.map((event, index) =>
    toPersonalizationEventRecord(
      event,
      index === 0 ? createdAt : new Date(Date.parse(createdAt) + index).toISOString(),
    ),
  );
  const countsByEventName = { ...summary.countsByEventName };
  const countsBySurface = { ...summary.countsBySurface };

  for (const event of appendedRecords) {
    countsByEventName[event.eventName] = (countsByEventName[event.eventName] ?? 0) + 1;
    countsBySurface[event.surface] = (countsBySurface[event.surface] ?? 0) + 1;
  }

  return {
    totalCount: summary.totalCount + appendedRecords.length,
    lastEventAt: appendedRecords[0]?.createdAt ?? summary.lastEventAt,
    countsByEventName,
    countsBySurface,
    recentEvents: [...appendedRecords, ...summary.recentEvents].slice(0, 20),
  };
};
