import type { OverrideEvent, PersonalizationEventName } from '@/types/personalization';

export type PersonalizationEventDraft = {
  eventName: PersonalizationEventName;
  surface: string;
  payload?: Record<string, unknown>;
};

export const derivePersonalizationEventsFromOverrideEvents = (
  events: OverrideEvent[],
): PersonalizationEventDraft[] => {
  const drafts: PersonalizationEventDraft[] = [];

  const controlEvents = events.filter((event) => event.surface === 'personalization_controls');
  for (const event of controlEvents) {
    drafts.push({
      eventName: 'control_selected',
      surface: event.surface,
      payload: {
        field: event.field,
        action: event.action,
        value: event.value ?? null,
      },
    });

    if (
      event.field === 'notificationTolerance' &&
      event.action === 'set' &&
      event.value === 'low'
    ) {
      drafts.push({
        eventName: 'reminder_disabled',
        surface: event.surface,
        payload: {
          source: 'control_bar',
          field: event.field,
        },
      });
    }
  }

  const scheduleEvents = events.filter((event) => event.surface === 'schedule_defaults');
  if (scheduleEvents.length > 0) {
    drafts.push({
      eventName: 'schedule_edited',
      surface: 'schedule_defaults',
      payload: {
        fieldCount: scheduleEvents.length,
        fields: scheduleEvents.map((event) => event.field),
        actions: scheduleEvents.map((event) => event.action),
      },
    });
  }

  return drafts;
};
