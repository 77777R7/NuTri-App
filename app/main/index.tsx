import React, { useCallback, useMemo, useState } from 'react';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';

import {
  HomePage,
  MOCK_SUPPLEMENTS,
  type FloatingAction,
  type HomeTabKey,
  type SupplementCard,
} from '@/Base44MainPage';

const ACTION_PATHS: Record<FloatingAction, Href> = {
  scan: '/scan',
  assistant: '/assistant',
  search: '/database',
} as const;

function useWeekDates() {
  return useMemo(() => {
    const today = new Date();
    const day = today.getDay(); // 0 (Sun) - 6 (Sat)
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((day + 6) % 7));

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return date;
    });
  }, []);
}

export default function MainPage() {
  const router = useRouter();

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [activeTab, setActiveTab] = useState<HomeTabKey>('home');

  const week = useWeekDates();
  const favourites = useMemo<SupplementCard[]>(() => MOCK_SUPPLEMENTS, []);
  const recent = favourites;
  const streak = 0;

  const handleActionPress = useCallback(
    (action: FloatingAction) => {
      const target = ACTION_PATHS[action];
      router.push(target);
    },
    [router],
  );

  const handleTabPress = useCallback((tab: HomeTabKey) => {
    setActiveTab(tab);
  }, []);

  const handlePressSupplement = useCallback((_id: string) => {
    // Placeholder: wired once detail route is ready
    return;
  }, []);

  return (
    <HomePage
      streak={streak}
      week={week}
      selectedDate={selectedDate}
      onSelectDate={setSelectedDate}
      favourites={favourites}
      onPressFavourite={handlePressSupplement}
      recent={recent}
      onPressRecent={handlePressSupplement}
      onActionPress={handleActionPress}
      activeTab={activeTab}
      onTabPress={handleTabPress}
      onProfileLoginPress={() => router.push('/(auth)/gate')}
    />
  );
}
