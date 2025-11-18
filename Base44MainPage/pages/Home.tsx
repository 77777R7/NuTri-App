import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Flame } from 'lucide-react-native';

import { BottomActionBar } from '@/Base44MainPage/components/home/BottomActionBar';
import { StatsCards } from '@/Base44MainPage/components/home/StatsCards';
import { RecentSupplements } from '@/Base44MainPage/components/home/RecentSupplements';
import type { SupplementCard } from '@/Base44MainPage/entities/Supplement';
import type { FloatingAction, HomeTabKey } from '@/Base44MainPage/entities/navigation';

const EMOJI_HEADER = '🥗';

type HomePageProps = {
  streak: number;
  week: Date[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  favourites: SupplementCard[];
  onPressFavourite: (id: string) => void;
  recent: SupplementCard[];
  onPressRecent: (id: string) => void;
  onActionPress: (action: FloatingAction) => void;
  activeTab: HomeTabKey;
  onTabPress: (tab: HomeTabKey) => void;
  onProfileLoginPress: () => void;
};

export function HomePage({
  streak,
  week,
  selectedDate,
  onSelectDate,
  favourites,
  onPressFavourite,
  recent,
  onPressRecent,
  onActionPress,
  activeTab,
  onTabPress,
  onProfileLoginPress,
}: HomePageProps) {
  const isToday = (date: Date) => date.toDateString() === new Date().toDateString();
  const isSelected = (date: Date) => date.toDateString() === selectedDate.toDateString();

  const renderHomeContent = () => (
    <>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <LinearGradient colors={['#34d399', '#10b981']} start={[0, 0]} end={[1, 1]} style={styles.logoBadge}>
            <Text style={styles.logoEmoji}>{EMOJI_HEADER}</Text>
          </LinearGradient>
          <View>
            <Text style={styles.brand}>Nutri</Text>
            <Text style={styles.subtle}>Welcome back</Text>
          </View>
        </View>

        <View style={styles.streakChip}>
          <Flame size={16} color="#ff7a18" />
          <Text style={styles.streakText}>{String(streak)}</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.weekRow}
        style={styles.weekScroll}
      >
        {week.map((date, idx) => {
          const selected = isSelected(date);
          const today = isToday(date);
          return (
            <TouchableOpacity
              key={idx}
              onPress={() => onSelectDate(date)}
              style={[styles.dayPill, selected ? styles.dayPillActive : today ? styles.dayPillToday : styles.dayPillIdle]}
              activeOpacity={0.9}
            >
              <Text style={[styles.dayName, selected ? styles.dayNameActive : today ? styles.dayNameToday : styles.dayNameIdle]}>
                {date.toLocaleDateString(undefined, { weekday: 'short' })}
              </Text>
              <Text style={[styles.dayNum, selected ? styles.dayNumActive : styles.dayNumIdle]}>{date.getDate()}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={[styles.sectionHeader, styles.sectionHeaderPrimary, styles.sectionSpacingTop]}>
        <Text style={styles.sectionTitle}>Favourite Supplements</Text>
      </View>
      <StatsCards supplements={favourites} onPressCard={onPressFavourite} />

      <View style={{ marginTop: 18, marginBottom: 34 }}>
        <View style={[styles.sectionHeader, styles.sectionHeaderSecondary]}>
          <Text style={styles.sectionTitle}>Recently scanned</Text>
        </View>
        <RecentSupplements supplements={recent} onPressItem={onPressRecent} />
      </View>
    </>
  );

  const renderPlaceholder = (args: {
    emoji: string;
    title: string;
    subtitle: string;
    buttonLabel?: string;
    onPressButton?: () => void;
  }) => (
    <View style={styles.placeholderContainer}>
      <View style={styles.placeholderCard}>
        <Text style={styles.placeholderEmoji}>{args.emoji}</Text>
        <Text style={styles.placeholderTitle}>{args.title}</Text>
        <Text style={styles.placeholderSubtitle}>{args.subtitle}</Text>
        {args.buttonLabel ? (
          <TouchableOpacity activeOpacity={0.9} onPress={args.onPressButton} style={styles.placeholderButton}>
            <Text style={styles.placeholderButtonText}>{args.buttonLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  const renderProgressContent = () =>
    renderPlaceholder({
      emoji: '📊',
      title: 'Coming Soon',
      subtitle: 'Track your supplement effectiveness and health progress over time',
    });

  const renderFavouriteContent = () =>
    renderPlaceholder({
      emoji: '🤍',
      title: 'No favourites yet',
      subtitle: 'Start scanning supplements to add them to your favourites',
      buttonLabel: 'Scan Your First',
      onPressButton: () => onActionPress('scan'),
    });

  const renderProfileContent = () => (
    <>
      <TouchableOpacity
        style={styles.profileBackRow}
        activeOpacity={0.7}
        onPress={onProfileLoginPress}
      >
        <ArrowLeft size={18} color="#4B5563" />
        <Text style={styles.profileBackText}>Back to welcome</Text>
      </TouchableOpacity>
      <View style={styles.profileContainer}>
        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderEmoji}>👤</Text>
          <Text style={styles.placeholderTitle}>Your profile</Text>
          <Text style={styles.placeholderSubtitle}>
            Set up your preferences and goals to personalise recommendations
          </Text>
        </View>
      </View>
    </>
  );

  const content = (() => {
    switch (activeTab) {
      case 'progress':
        return renderProgressContent();
      case 'favourite':
        return renderFavouriteContent();
      case 'profile':
        return renderProfileContent();
      case 'home':
      default:
        return renderHomeContent();
    }
  })();

  const isHomeTab = activeTab === 'home';

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        style={styles.mainScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={isHomeTab ? undefined : styles.placeholderScroll}
      >
        {content}
      </ScrollView>

      <BottomActionBar activeTab={activeTab} onTabPress={onTabPress} onActionSelect={onActionPress} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  mainScroll: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  logoBadge: {
    width: 40,
    height: 40,
    borderRadius: 14,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10b981',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
  },
  logoEmoji: { fontSize: 22 },
  brand: { fontSize: 28, fontWeight: '700', color: '#111827', lineHeight: 30 },
  subtle: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  streakChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  streakText: { marginLeft: 6, fontWeight: '700', color: '#111827' },
  weekRow: { paddingHorizontal: 16 },
  weekScroll: {
    marginBottom: 16,
    backgroundColor: 'transparent',
  },
  dayPill: {
    width: 52,
    height: 66,
    borderRadius: 14,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPillActive: {
    backgroundColor: '#111827',
    transform: [{ scale: 1.02 }],
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  dayPillToday: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  dayPillIdle: { backgroundColor: '#f3f4f6' },
  dayName: { fontSize: 12, fontWeight: '600' },
  dayNameActive: { color: '#fff' },
  dayNameToday: { color: '#111827' },
  dayNameIdle: { color: '#6b7280' },
  dayNum: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  dayNumActive: { color: '#fff' },
  dayNumIdle: { color: '#111827' },
  sectionHeader: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionSpacingTop: {
    marginTop: 12,
  },
  sectionHeaderPrimary: {
    marginBottom: 12,
  },
  sectionHeaderSecondary: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  placeholderScroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 120,
  },
  placeholderContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  placeholderCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 36,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  placeholderEmoji: {
    fontSize: 44,
    marginBottom: 20,
  },
  placeholderTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  placeholderSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  placeholderButton: {
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: '#111827',
  },
  placeholderButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  profileContainer: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingTop: 32,
  },
  profileBackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
  },
  profileBackText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4B5563',
  },
});

export default HomePage;
