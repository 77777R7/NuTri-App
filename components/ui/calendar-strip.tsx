import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { Pressable, ScrollView, Text, View } from '@/components/ui/nativewind-primitives';

type CalendarStripProps = {
  selectedDate: string; // ISO string yyyy-mm-dd
  visibleDate?: string;
  onSelectDate: (isoDate: string) => void;
};

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parseISODate = (value?: string) => {
  if (!value) return null;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

const toISODate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const CalendarStrip: React.FC<CalendarStripProps> = ({
  selectedDate,
  visibleDate,
  onSelectDate,
}) => {
  const days = useMemo(() => {
    const focusDate = parseISODate(visibleDate) ?? parseISODate(selectedDate) ?? new Date();
    const start = new Date(focusDate);
    start.setDate(focusDate.getDate() - start.getDay());

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [selectedDate, visibleDate]);

  const todayISO = toISODate(new Date());

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      style={styles.scroll}
    >
      {days.map((date, index) => {
        const iso = toISODate(date);
        const isSelected = iso === selectedDate;
        const isToday = iso === todayISO;

        return (
          <Pressable
            key={iso}
            onPress={() => onSelectDate(iso)}
            style={[styles.dayCard, isSelected && styles.dayCardSelected]}
          >
            <Text style={[styles.dayLabel, isSelected && styles.dayLabelSelected]}>
              {dayLabels[date.getDay()]}
            </Text>
            <Text style={[styles.dayNumber, isSelected && styles.dayNumberSelected]}>
              {date.getDate()}
            </Text>
            {isToday && !isSelected ? (
              <View style={styles.todayDot} />
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: {
    backgroundColor: 'transparent',
  },
  content: {
    paddingHorizontal: 4,
    gap: 10,
  },
  dayCard: {
    width: 72,
    minHeight: 96,
    borderRadius: 24,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.16)',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  dayCardSelected: {
    backgroundColor: '#2563eb',
    borderColor: 'rgba(37,99,235,0.24)',
    shadowColor: '#2563eb',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  dayLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: '#64748b',
    includeFontPadding: false,
  },
  dayLabelSelected: {
    color: 'rgba(255,255,255,0.82)',
  },
  dayNumber: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '800',
    color: '#0f172a',
    includeFontPadding: false,
  },
  dayNumberSelected: {
    color: '#ffffff',
  },
  todayDot: {
    marginTop: 2,
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#2563eb',
  },
});
