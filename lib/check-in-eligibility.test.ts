import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkInEligibilityInternals,
  type CheckInEligibleItem,
  getCheckInEffectiveStartDate,
  getCheckInEligibilityDateRange,
  getEligibleCheckInItems,
  isCheckInEligibleItem,
  isFutureCheckInDate,
  validateCheckInDateForItem,
} from './check-in-eligibility';

const syncedItem: CheckInEligibleItem = {
  createdAt: '2026-03-10T09:00:00-07:00',
  syncedToCheckIn: true,
};

const scheduledItem: CheckInEligibleItem = {
  createdAt: '2026-03-10T09:00:00-07:00',
  syncedToCheckIn: true,
  routine: {
    startDate: '2026-03-12',
    daysOfWeek: [1, 3, 5],
  },
};

const unsyncedItem: CheckInEligibleItem = {
  createdAt: '2026-03-10T09:00:00-07:00',
  syncedToCheckIn: false,
};

const now = new Date('2026-03-17T12:00:00-07:00');

test('getCheckInEffectiveStartDate uses createdAt only when syncedToCheckIn is enabled', () => {
  assert.equal(getCheckInEffectiveStartDate(syncedItem), '2026-03-10');
  assert.equal(getCheckInEffectiveStartDate(scheduledItem), '2026-03-12');
  assert.equal(getCheckInEffectiveStartDate(unsyncedItem), null);
});

test('isCheckInEligibleItem filters out unsynced or invalid items', () => {
  assert.equal(isCheckInEligibleItem(syncedItem), true);
  assert.equal(isCheckInEligibleItem(unsyncedItem), false);
  assert.equal(
    isCheckInEligibleItem({
      createdAt: 'not-a-date',
      syncedToCheckIn: true,
    }),
    false,
  );
});

test('getEligibleCheckInItems returns only synced items with a valid start date', () => {
  const items = [
    syncedItem,
    unsyncedItem,
    {
      createdAt: 'not-a-date',
      syncedToCheckIn: true,
    },
  ];

  assert.deepEqual(getEligibleCheckInItems(items), [syncedItem]);
});

test('validateCheckInDateForItem blocks future dates and dates before the effective start', () => {
  assert.deepEqual(
    validateCheckInDateForItem(syncedItem, '2026-03-18', now),
    {
      isValid: false,
      reason: 'future_date',
      effectiveStartDate: '2026-03-10',
      normalizedDate: '2026-03-18',
    },
  );

  assert.deepEqual(
    validateCheckInDateForItem(syncedItem, '2026-03-09', now),
    {
      isValid: false,
      reason: 'before_effective_start',
      effectiveStartDate: '2026-03-10',
      normalizedDate: '2026-03-09',
    },
  );

  assert.deepEqual(
    validateCheckInDateForItem(syncedItem, '2026-03-10', now),
    {
      isValid: true,
      effectiveStartDate: '2026-03-10',
      normalizedDate: '2026-03-10',
    },
  );
});

test('validateCheckInDateForItem rejects unsynced items and invalid dates', () => {
  assert.deepEqual(validateCheckInDateForItem(unsyncedItem, '2026-03-10', now), {
    isValid: false,
    reason: 'ineligible_item',
  });

  assert.deepEqual(validateCheckInDateForItem(syncedItem, 'bad-date', now), {
    isValid: false,
    reason: 'invalid_date',
    effectiveStartDate: '2026-03-10',
  });
});

test('validateCheckInDateForItem respects routine startDate and daysOfWeek schedule', () => {
  assert.deepEqual(validateCheckInDateForItem(scheduledItem, '2026-03-11', now), {
    isValid: false,
    reason: 'before_effective_start',
    effectiveStartDate: '2026-03-12',
    normalizedDate: '2026-03-11',
  });

  assert.deepEqual(validateCheckInDateForItem(scheduledItem, '2026-03-12', now), {
    isValid: false,
    reason: 'outside_schedule',
    effectiveStartDate: '2026-03-12',
    normalizedDate: '2026-03-12',
  });

  assert.deepEqual(validateCheckInDateForItem(scheduledItem, '2026-03-13', now), {
    isValid: true,
    effectiveStartDate: '2026-03-12',
    normalizedDate: '2026-03-13',
  });
});

test('isFutureCheckInDate respects calendar days rather than time-of-day', () => {
  assert.equal(isFutureCheckInDate('2026-03-18', now), true);
  assert.equal(isFutureCheckInDate('2026-03-17', now), false);
});

test('getCheckInEligibilityDateRange exposes the effective bounds for consumers', () => {
  assert.deepEqual(getCheckInEligibilityDateRange(syncedItem, now), {
    effectiveStartDate: '2026-03-10',
    latestAllowedDate: '2026-03-17',
  });
  assert.equal(getCheckInEligibilityDateRange(unsyncedItem, now), null);
});

test('internal calendar day helpers are stable for date-only inputs', () => {
  assert.equal(checkInEligibilityInternals.toLocalCalendarDay('2026-03-17'), '2026-03-17');
  assert.equal(checkInEligibilityInternals.toLocalCalendarDay(''), null);
});
