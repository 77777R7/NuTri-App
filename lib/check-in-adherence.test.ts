import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCheckInSeries,
  buildStreakAchievementBadges,
  getCurrentPerfectStreakDays,
  getNextStreakMilestone,
  summarizeCheckInDay,
} from './check-in-adherence';
import type { DailyCheckInsByDate } from './storage/daily-check-ins';
import type { SavedSupplement } from '@/types/saved-supplements';

const magnesium: SavedSupplement = {
  id: 'local_mag',
  supplementId: 'supp_mag',
  productName: 'Magnesium',
  brandName: 'Brand A',
  dosageText: '200 mg',
  createdAt: '2026-03-10T09:00:00-07:00',
  updatedAt: '2026-03-10T09:00:00-07:00',
  syncedToCheckIn: true,
  routine: {
    startDate: '2026-03-10',
    daysOfWeek: [1, 3, 5],
  },
};

const vitaminC: SavedSupplement = {
  id: 'local_c',
  supplementId: 'supp_c',
  productName: 'Vitamin C',
  brandName: 'Brand B',
  dosageText: '500 mg',
  createdAt: '2026-03-10T09:00:00-07:00',
  updatedAt: '2026-03-10T09:00:00-07:00',
  syncedToCheckIn: true,
  routine: {
    startDate: '2026-03-10',
  },
};

const checkInsByDate: DailyCheckInsByDate = {
  '2026-03-11': ['supplement:supp_c'],
  '2026-03-12': ['supplement:supp_c'],
  '2026-03-13': ['supplement:supp_mag', 'supplement:supp_c'],
  '2026-03-14': ['supplement:supp_c'],
  '2026-03-15': ['supplement:supp_c'],
  '2026-03-16': ['supplement:supp_mag', 'supplement:supp_c'],
  '2026-03-17': ['supplement:supp_c'],
};

test('summarizeCheckInDay respects startDate and daysOfWeek scheduling', () => {
  assert.deepEqual(
    summarizeCheckInDay([magnesium, vitaminC], checkInsByDate, '2026-03-12', '2026-03-17'),
    {
      dateKey: '2026-03-12',
      expectedCount: 1,
      completedCount: 1,
      isScheduledDay: true,
      isPerfectDay: true,
    },
  );
});

test('getCurrentPerfectStreakDays skips unscheduled days and counts perfect scheduled days', () => {
  assert.equal(
    getCurrentPerfectStreakDays([magnesium, vitaminC], checkInsByDate, '2026-03-17'),
    6,
  );
});

test('buildCheckInSeries emits completion windows for recent days', () => {
  const series = buildCheckInSeries([magnesium, vitaminC], checkInsByDate, '2026-03-17', 3);
  assert.deepEqual(
    series.map(entry => ({
      dateKey: entry.dateKey,
      expectedCount: entry.expectedCount,
      completedCount: entry.completedCount,
    })),
    [
      { dateKey: '2026-03-15', expectedCount: 1, completedCount: 1 },
      { dateKey: '2026-03-16', expectedCount: 2, completedCount: 2 },
      { dateKey: '2026-03-17', expectedCount: 1, completedCount: 1 },
    ],
  );
});

test('streak achievements and next milestone derive from current streak', () => {
  const badges = buildStreakAchievementBadges(5, true);
  assert.deepEqual(
    badges.map(badge => [badge.label, badge.unlocked]),
    [
      ['FIRST', true],
      ['3 DAY', true],
      ['7 DAY', false],
      ['CHAMP', false],
    ],
  );

  assert.deepEqual(getNextStreakMilestone(5), {
    goalDays: 7,
    daysRemaining: 2,
  });
});
