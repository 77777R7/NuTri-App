import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from '@/components/ui/nativewind-primitives';
import { cn } from '@/lib/utils';

type CalendarStripProps = {
  selectedDate: string; // ISO string yyyy-mm-dd
  onSelectDate: (isoDate: string) => void;
};

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toISODate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const CalendarStrip: React.FC<CalendarStripProps> = ({ selectedDate, onSelectDate }) => {
  const days = useMemo(() => {
    const selected = selectedDate ? new Date(selectedDate) : new Date();
    const start = new Date(selected);
    start.setDate(selected.getDate() - selected.getDay());

    return Array.from({ length: 7 }).map((_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [selectedDate]);

  const todayISO = toISODate(new Date());

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 12, gap: 10 }}
    >
      {days.map((date) => {
        const iso = toISODate(date);
        const isSelected = iso === selectedDate;
        const isToday = iso === todayISO;

        return (
          <Pressable
            key={iso}
            onPress={() => onSelectDate(iso)}
            className={cn(
              'w-16 items-center rounded-3xl border px-3 py-2',
              isSelected ? 'bg-primary text-white border-primary-200 shadow-soft' : 'bg-surface border-border',
            )}
          >
            <Text className={cn('text-[11px]', isSelected ? 'text-white/80' : 'text-muted')}>
              {dayLabels[date.getDay()]}
            </Text>
            <Text
              className={cn(
                'mt-1 text-lg font-semibold',
                isSelected ? 'text-white' : 'text-gray-900 dark:text-white',
              )}
            >
              {date.getDate()}
            </Text>
            {isToday && !isSelected ? <View className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
};
