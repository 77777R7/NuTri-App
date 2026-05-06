import ProgressScreen from '@/components/screens/ProgressScreen';
import ProfileScreen from '@/components/screens/ProfileScreen';
import { MySupplementView } from '@/components/screens/MySupplement';
import { ContentFrame } from '@/components/common/ContentFrame';
import { useDailyCheckIns } from '@/contexts/DailyCheckInContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useSavedSupplements } from '@/contexts/SavedSupplementsContext';
import { useScanHistory } from '@/contexts/ScanHistoryContext';
import { useFullBleed } from '@/hooks/useFullBleed';
import { useScreenTokens } from '@/hooks/useScreenTokens';
import { apiClient, type NutriTipsData } from '@/lib/api-client';
import { NUTRI_ACTIVATION_DEFINITION, trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { trackOnboardingReturnMilestones } from '@/lib/analytics/onboarding-return';
import {
  buildCheckInSeries,
  getCurrentPerfectStreakDays,
  getNextStreakMilestone,
} from '@/lib/check-in-adherence';
import { validateCheckInDateForItem } from '@/lib/check-in-eligibility';
import { buildCheckInKey, getLocalDateKey, isDateKeyAfter } from '@/lib/check-ins';
import { useTranslation } from '@/lib/i18n';
import { selectDailyTip, type NutriTipSelection } from '@/lib/nutri-tips';
import type { RoutinePreferences } from '@/types/saved-supplements';
import type { ScanHistoryItem } from '@/types/scan-history';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  Activity,
  AudioWaveform,
  BarChart2,
  Bed,
  Bone,
  Brain,
  Bookmark,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  CircleFadingPlus,
  Eye,
  Flame,
  Home,
  HeartPulse,
  MoreHorizontal,
  Pill,
  Plus,
  ScanBarcode,
  ShieldPlus,
  User,
  Waves,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import MaskedView from '@react-native-masked-view/masked-view';

// --- 核心动画库引入 ---
import { AnimatePresence, MotiView } from 'moti';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { SharedValue } from 'react-native-reanimated';
import Animated, {
  Easing,
  FadeInRight,
  FadeInUp,
  interpolateColor,
  runOnJS,
  runOnUI,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useAnimatedProps,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withSequence,
  withTiming,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';

// 创建支持动画的 Pressable
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedText = Animated.createAnimatedComponent(Text);
const AnimatedView = Animated.createAnimatedComponent(View);
const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SCREEN_BG = '#F2F3F7';
const SECTION_GAP = 20;
const STACK_GAP = 16;
const TREND_BAR_HEIGHT = 128;
const TREND_BAR_MIN_HEIGHT = 8;

type Density = 'compact' | 'regular';

const getTwoUpDensity = (contentWidth: number, gap: number): Density => {
  const cardWidth = (contentWidth - gap) / 2;
  return cardWidth < 175 ? 'compact' : 'regular';
};

const BOTTOM_INSET_TRIM = 0;
const BOTTOM_FADE_EXTRA = 120;
const TOP_FADE_EXTRA = 4;
const NAV_HEIGHT = 64;
const PLUS_BUTTON_SIZE = 64;
const NAV_PILL_GAP = 16;
const NAV_PILL_TARGET_WIDTH = 300;

// 类型定义
type SupplementItem = {
  name: string;
  dose: string;
  color: string;
  iconColor: string;
  iconBg: string;
};

type CategoryIconConfig = {
  icon: LucideIcon;
  rotate?: string;
};

type TrendSeriesEntry = {
  k: string;
  v: number | null;
  completed: number;
  total: number;
  dateKey: string;
};

type TrendData = {
  title: string;
  series: TrendSeriesEntry[];
  summaryA: string;
  summaryB: string;
};

// 颜色转换辅助函数
const getIconColorHex = (className: string) => {
  const map: Record<string, string> = {
    'text-blue-700': '#1d4ed8',
    'text-yellow-700': '#a16207',
    'text-purple-700': '#6d28d9',
    'text-emerald-700': '#047857',
    'text-rose-700': '#be123c',
  };
  return map[className] || '#0f172a';
};

const normalizeCategoryKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const calcPercent = (taken: number, total: number) => {
  if (total <= 0) return 0;
  return Math.round((taken / total) * 100);
};

const CATEGORY_ICON_CONFIGS = {
  immune: { icon: ShieldPlus },
  sleep: { icon: Bed },
  energy: { icon: Zap },
  gut: { icon: AudioWaveform, rotate: '-90deg' },
  heart: { icon: HeartPulse },
  brain: { icon: Brain },
  bone: { icon: Bone },
  skin: { icon: CircleFadingPlus },
  vision: { icon: Eye },
  stress: { icon: Waves },
  other: { icon: Pill },
} satisfies Record<string, CategoryIconConfig>;

const CATEGORY_ALIASES: Record<string, keyof typeof CATEGORY_ICON_CONFIGS> = {
  immunity: 'immune',
  immune: 'immune',
  immunesupport: 'immune',
  immunitysupport: 'immune',
  immuneboost: 'immune',
  vitamins: 'immune',
  sleep: 'sleep',
  sleepsupport: 'sleep',
  bettersleep: 'sleep',
  energy: 'energy',
  metabolism: 'energy',
  energymetabolism: 'energy',
  energyboost: 'energy',
  aminoacids: 'energy',
  digestion: 'gut',
  digestive: 'gut',
  digestivehealth: 'gut',
  gut: 'gut',
  guthealth: 'gut',
  digestiongut: 'gut',
  probiotic: 'gut',
  probiotics: 'gut',
  heart: 'heart',
  cardio: 'heart',
  cardiovascular: 'heart',
  hearthealth: 'heart',
  cardiovascularhealth: 'heart',
  omega3: 'heart',
  brain: 'brain',
  focus: 'brain',
  brainfocus: 'brain',
  brainhealth: 'brain',
  focussupport: 'brain',
  joints: 'bone',
  bones: 'bone',
  jointsbones: 'bone',
  bone: 'bone',
  jointhealth: 'bone',
  jointsupport: 'bone',
  bonehealth: 'bone',
  skin: 'skin',
  hair: 'skin',
  nails: 'skin',
  skinhairnails: 'skin',
  skinhairnail: 'skin',
  vision: 'vision',
  eye: 'vision',
  eyehealth: 'vision',
  stress: 'stress',
  mood: 'stress',
  stressmood: 'stress',
  stressrelief: 'stress',
  moodsupport: 'stress',
  minerals: 'energy',
  herbs: 'stress',
  other: 'other',
};

const getCategoryIconConfig = (category: string | null | undefined, productName: string): CategoryIconConfig => {
  const normalizedCategory = normalizeCategoryKey(category ?? '');
  const alias = CATEGORY_ALIASES[normalizedCategory];
  if (alias) return CATEGORY_ICON_CONFIGS[alias];

  const normalizedName = normalizeCategoryKey(productName);
  if (normalizedName.includes('probiotic') || normalizedName.includes('gut') || normalizedName.includes('digest')) {
    return CATEGORY_ICON_CONFIGS.gut;
  }
  if (normalizedName.includes('omega') || normalizedName.includes('fishoil') || normalizedName.includes('epa') || normalizedName.includes('dha')) {
    return CATEGORY_ICON_CONFIGS.heart;
  }
  if (normalizedName.includes('sleep') || normalizedName.includes('melatonin')) {
    return CATEGORY_ICON_CONFIGS.sleep;
  }
  if (normalizedName.includes('immune')) {
    return CATEGORY_ICON_CONFIGS.immune;
  }
  if (normalizedName.includes('brain') || normalizedName.includes('focus') || normalizedName.includes('memory')) {
    return CATEGORY_ICON_CONFIGS.brain;
  }
  if (normalizedName.includes('joint') || normalizedName.includes('bone')) {
    return CATEGORY_ICON_CONFIGS.bone;
  }
  if (normalizedName.includes('skin') || normalizedName.includes('hair') || normalizedName.includes('nail') || normalizedName.includes('collagen')) {
    return CATEGORY_ICON_CONFIGS.skin;
  }
  if (normalizedName.includes('vision') || normalizedName.includes('eye') || normalizedName.includes('lutein')) {
    return CATEGORY_ICON_CONFIGS.vision;
  }
  if (normalizedName.includes('stress') || normalizedName.includes('mood') || normalizedName.includes('calm') || normalizedName.includes('relax')) {
    return CATEGORY_ICON_CONFIGS.stress;
  }
  if (normalizedName.includes('energy') || normalizedName.includes('metabolism') || normalizedName.includes('b12')) {
    return CATEGORY_ICON_CONFIGS.energy;
  }

  return CATEGORY_ICON_CONFIGS.other;
};

// -----------------------------------------------------
// 1. Optimized Card Component
// -----------------------------------------------------

const SupplementCheckInCard = ({
  item,
  isChecked,
  onCheckIn,
  disabled = false,
}: {
  item: SupplementItem;
  isChecked: boolean;
  onCheckIn?: () => void;
  disabled?: boolean;
}) => {
  const progress = useSharedValue(isChecked ? 1 : 0);
  const scale = useSharedValue(1);

  useEffect(() => {
    progress.value = withSpring(isChecked ? 1 : 0, {
      mass: 1,
      damping: 15,
      stiffness: 120,
    });
  }, [isChecked, progress]);

  const handlePressIn = () => {
    scale.value = withSpring(0.96);
  };
  const handlePressOut = () => {
    scale.value = withSpring(1);
  };

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const buttonAnimatedStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(
      progress.value,
      [0, 1],
      ['rgba(255, 255, 255, 0.5)', '#10b981'],
    );
    const scaleVal = 1 + progress.value * 0.1;
    return {
      backgroundColor,
      transform: [{ scale: scaleVal }],
      borderColor: isChecked ? 'transparent' : 'rgba(255,255,255,0.4)',
    };
  });

  const titleTextStyle = useAnimatedStyle(() => {
    const color = interpolateColor(progress.value, [0, 1], ['#0f172a', '#047857']);
    return { color };
  });

  const subtitleTextStyle = useAnimatedStyle(() => {
    const color = interpolateColor(progress.value, [0, 1], ['#475569', '#059669']);
    return { color };
  });

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const actionIconColor = disabled && !isChecked ? '#ef4444' : getIconColorHex(item.iconColor);

  return (
    <AnimatedPressable
      disabled={disabled}
      onPress={disabled ? undefined : onCheckIn}
      onPressIn={disabled ? undefined : handlePressIn}
      onPressOut={disabled ? undefined : handlePressOut}
      style={[styles.cardContainer, containerStyle]}
      className={`${item.color} relative overflow-hidden`}
    >
      <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFill} />
      <View style={styles.borderLayer} />
      <Animated.View style={[styles.successOverlay, overlayStyle]} />

      <View style={styles.contentContainer}>
        <View style={styles.checkInCardHeaderRow}>
          <View
            className={`w-9 h-9 rounded-full items-center justify-center ${item.iconBg} ${item.iconColor}`}
            style={{ borderCurve: 'continuous' }}
          >
            <Pill size={16} strokeWidth={2.5} />
          </View>

          <Animated.View style={[styles.checkboxButton, buttonAnimatedStyle]}>
            {isChecked ? (
              <Animated.View entering={ZoomIn.duration(300)} exiting={ZoomOut.duration(200)}>
                <Check size={18} color="white" strokeWidth={3.5} />
              </Animated.View>
            ) : disabled ? (
              <Animated.View entering={ZoomIn.duration(220)} exiting={ZoomOut.duration(180)}>
                <X size={18} color={actionIconColor} strokeWidth={3} />
              </Animated.View>
            ) : (
              <Animated.View entering={ZoomIn.rotate('90deg')} exiting={ZoomOut.rotate('90deg')}>
                <Plus size={18} color={actionIconColor} strokeWidth={3} />
              </Animated.View>
            )}
          </Animated.View>
        </View>

        <View style={styles.textRow}>
          <Animated.Text style={[styles.titleText, titleTextStyle]} numberOfLines={1}>
            {item.name}
          </Animated.Text>
          <Animated.Text style={[styles.subtitleText, subtitleTextStyle]}>
            {isChecked ? 'Completed' : item.dose}
          </Animated.Text>
        </View>
      </View>
    </AnimatedPressable>
  );
};

// -----------------------------------------------------
// Weekday Selector
// -----------------------------------------------------

type DayStatus = 'complete' | 'partial' | 'missed' | 'no_schedule' | 'future';

type WeekdayItem = {
  id: string;
  date: Date;
  dayLabel: string;
  dayNumber: number;
  status: DayStatus;
  isFutureDate: boolean;
};

type WeekdaySelectorProps = {
  items: WeekdayItem[];
  selectedDayId: string;
  todayId: string;
  onSelectDay: (dateKey: string) => void;
  frameWidth: number;
  pageX: number;
};

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const CALENDAR_RANGE_WEEKS = 4;
const DAY_ITEM_WIDTH = 48;
const DAY_ITEM_HEIGHT = 80;
const DAY_ITEM_MIN_WIDTH = 36;
const DAY_ITEM_MIN_GAP = 6;
const DAY_ITEM_ROW_INSET = 4;

const STATUS_DOT_COLORS: Record<DayStatus, string> = {
  complete: '#22c55e',
  partial: '#f59e0b',
  missed: '#ef4444',
  no_schedule: 'transparent',
  future: '#ffffff',
};

const buildCalendarDays = (
  baseDate: Date,
  statusForDate: (date: Date, dateKey: string) => DayStatus,
): WeekdayItem[] => {
  const today = new Date(baseDate);
  today.setHours(0, 0, 0, 0);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const start = new Date(baseDate);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  start.setDate(start.getDate() - CALENDAR_RANGE_WEEKS * 7);
  const totalDays = (CALENDAR_RANGE_WEEKS * 2 + 1) * 7;

  return Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const dateKey = getLocalDateKey(date);
    return {
      id: dateKey,
      date,
      dayLabel: WEEKDAY_LABELS[date.getDay()],
      dayNumber: date.getDate(),
      status: statusForDate(date, dateKey),
      isFutureDate: date.getTime() > today.getTime(),
    };
  });
};

const countCompletedForDate = (expectedKeySet: Set<string>, dateKeys: string[] | undefined) => {
  if (!dateKeys?.length) return 0;
  const completedSet = new Set(dateKeys);
  let completedCount = 0;
  expectedKeySet.forEach(key => {
    if (completedSet.has(key)) completedCount += 1;
  });
  return completedCount;
};

const summarizeTrendSeries = (series: TrendSeriesEntry[]) => {
  const valid = series.filter(entry => entry.v !== null);
  if (!valid.length) {
    return { average: null, best: null, lowest: null };
  }
  const average = Math.round(
    valid.reduce((total, entry) => total + (entry.v ?? 0), 0) / valid.length,
  );
  const best = valid.reduce((prev, current) => ((current.v ?? 0) > (prev.v ?? 0) ? current : prev), valid[0]);
  const lowest = valid.reduce((prev, current) => ((current.v ?? 0) < (prev.v ?? 0) ? current : prev), valid[0]);
  return { average, best, lowest };
};

const getWeekStartMonday = (baseDate: Date) => {
  const start = new Date(baseDate);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const offset = (day + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start;
};

const buildDailyTrendSeries = ({
  baseDate,
  checkInsByDate,
  resolveExpectedForDate,
}: {
  baseDate: Date;
  checkInsByDate: Record<string, string[]>;
  resolveExpectedForDate: (dateKey: string) => { expectedCount: number; expectedKeySet: Set<string> };
}) => {
  const startDate = getWeekStartMonday(baseDate);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    const dateKey = getLocalDateKey(date);
    const { expectedCount, expectedKeySet } = resolveExpectedForDate(dateKey);
    const completed = countCompletedForDate(expectedKeySet, checkInsByDate[dateKey]);
    const total = expectedCount;
    const value = total > 0 ? calcPercent(completed, total) : null;
    return {
      k: WEEKDAY_LABELS[date.getDay()],
      v: value,
      completed,
      total,
      dateKey,
    };
  });
};

type DayItemProps = {
  item: WeekdayItem;
  isSelected: boolean;
  isToday: boolean;
  onPress: () => void;
  itemWidth: number;
};

const DayItemComponent = ({ item, isSelected, isToday, onPress, itemWidth }: DayItemProps) => {
  const isFutureDate = item.isFutureDate;
  const isActive = isSelected && !isFutureDate;
  const progress = useSharedValue(isActive ? 1 : 0);
  const statusColor = STATUS_DOT_COLORS[item.status];
  const showStatusDot = isActive && item.status !== 'future' && item.status !== 'no_schedule';
  const statusBorderColor = item.status === 'future' || item.status === 'no_schedule' ? 'transparent' : 'rgba(255,255,255,0.35)';
  const activeBgColor = isToday ? '#1e40af' : '#0f172a';
  const dayLabelColor = isFutureDate ? '#cbd5e1' : '#94a3b8';
  const dateBaseColor = isFutureDate ? '#cbd5e1' : '#0f172a';
  const dateActiveColor = isFutureDate ? '#cbd5e1' : '#ffffff';
  const itemRadius = Math.round(itemWidth / 2);

  useEffect(() => {
    progress.value = withSpring(isActive ? 1 : 0, {
      mass: 1,
      damping: 15,
      stiffness: 120,
      overshootClamping: false,
    });
  }, [isActive, progress]);

  const bgStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: progress.value }],
  }));

  const dayTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [dayLabelColor, dayLabelColor]),
  }));

  const dateTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [dateBaseColor, dateActiveColor]),
  }));

  const dotStyle = useAnimatedStyle(() => ({
    opacity: showStatusDot ? 0.82 + progress.value * 0.18 : 0,
    transform: [{ scale: showStatusDot ? 0.92 + progress.value * 0.08 : 0.9 }],
  }));

  return (
    <AnimatedPressable
      disabled={isFutureDate}
      onPress={isFutureDate ? undefined : onPress}
      style={({ pressed }) => ({
        transform: [{ scale: pressed && !isFutureDate ? 0.95 : 1 }],
        opacity: isFutureDate ? 0.65 : 1,
      })}
    >
      <View
        style={[
          styles.dayItemBase,
          { width: itemWidth, height: DAY_ITEM_HEIGHT, borderRadius: itemRadius },
          !isActive && styles.dayItemInactive,
          isFutureDate && styles.dayItemFuture,
        ]}
      >
        <Animated.View style={[styles.dayItemActiveBg, bgStyle, { backgroundColor: activeBgColor, borderRadius: itemRadius }]} />
        <AnimatedText style={[styles.dayLabel, dayTextStyle]}>{item.dayLabel}</AnimatedText>

        <View style={styles.dayDateWrap}>
          <AnimatedText style={[styles.dayDate, dateTextStyle]}>{item.dayNumber}</AnimatedText>
          {showStatusDot ? (
            <Animated.View
              style={[
                styles.dayDot,
                dotStyle,
                { backgroundColor: statusColor, borderColor: statusBorderColor },
              ]}
            />
          ) : null}
        </View>
      </View>
    </AnimatedPressable>
  );
};

const DayItem = React.memo(DayItemComponent, (prevProps, nextProps) => {
  return (
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isToday === nextProps.isToday &&
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.status === nextProps.item.status &&
    prevProps.item.isFutureDate === nextProps.item.isFutureDate &&
    prevProps.itemWidth === nextProps.itemWidth
  );
});
DayItem.displayName = 'DayItem';

const WeekdaySelector = ({ items, selectedDayId, todayId, onSelectDay, frameWidth, pageX }: WeekdaySelectorProps) => {
  const calendarOpacity = useSharedValue(1);
  const { width: windowWidth } = useWindowDimensions();
  const containerWidth = Math.max(0, windowWidth - pageX * 2);
  const pageWidth = Math.min(frameWidth, containerWidth);
  const rowWidth = Math.max(0, pageWidth - DAY_ITEM_ROW_INSET * 2);
  const targetDayWidth = (rowWidth - DAY_ITEM_MIN_GAP * 6) / 7;
  const dayWidth = Math.min(DAY_ITEM_WIDTH, Math.max(DAY_ITEM_MIN_WIDTH, Math.round(targetDayWidth)));
  const scrollRef = useRef<ScrollView>(null);
  const weeks = useMemo(() => {
    const grouped: WeekdayItem[][] = [];
    for (let i = 0; i < items.length; i += 7) {
      grouped.push(items.slice(i, i + 7));
    }
    return grouped;
  }, [items]);
  const todayIndex = useMemo(() => items.findIndex(item => item.id === todayId), [items, todayId]);
  const todayWeekIndex = useMemo(
    () => (todayIndex < 0 ? 0 : Math.floor(todayIndex / 7)),
    [todayIndex],
  );
  const initialOffset = useMemo(
    () => Math.max(0, todayWeekIndex * pageWidth),
    [pageWidth, todayWeekIndex],
  );

  useEffect(() => {
    if (todayIndex < 0) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: initialOffset, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialOffset, todayIndex]);

  const calendarStyle = useAnimatedStyle(() => ({
    opacity: calendarOpacity.value,
  }));

  return (
    <Animated.View entering={FadeInUp.duration(500)} style={styles.weekdayWrap}>
      <View style={styles.weekHeaderRow}>
        <Text style={styles.weekHeaderText}>Week Days</Text>
        <AnimatedPressable
          onPressIn={() => (calendarOpacity.value = withTiming(0.5))}
          onPressOut={() => (calendarOpacity.value = withTiming(1))}
          style={[styles.calendarBtn, calendarStyle]}
        >
          <CalendarIcon size={24} color="#0f172a" />
        </AnimatedPressable>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.weekPager}
      >
        {weeks.map((week, weekIndex) => (
          <View key={`${week[0]?.id ?? 'week'}-${weekIndex}`} style={[styles.weekPage, { width: pageWidth }]}>
            <View style={[styles.daysRow, { width: pageWidth, paddingHorizontal: DAY_ITEM_ROW_INSET }]}>
              {week.map(item => (
                <DayItem
                  key={item.id}
                  item={item}
                  isSelected={selectedDayId === item.id}
                  isToday={todayId === item.id}
                  itemWidth={dayWidth}
                  onPress={() => onSelectDay(item.id)}
                />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Animated.View>
  );
};

// -----------------------------------------------------
// Saved Supplements Container (Daily Check-in)
// -----------------------------------------------------

const CARD_WIDTH = 160;
const CARD_HEIGHT = 112;
const CARD_GAP = 16;
const INDICATOR_TRACK_WIDTH = 128;
const INDICATOR_WIDTH = INDICATOR_TRACK_WIDTH / 3;
const INDICATOR_MAX_LEFT = INDICATOR_TRACK_WIDTH - INDICATOR_WIDTH;

const CHECKIN_THEMES = [
  { color: 'bg-blue-100', iconColor: 'text-blue-700', iconBg: 'bg-blue-100/40' },
  { color: 'bg-yellow-100', iconColor: 'text-yellow-700', iconBg: 'bg-yellow-100/40' },
  { color: 'bg-purple-100', iconColor: 'text-purple-700', iconBg: 'bg-purple-100/40' },
  { color: 'bg-emerald-100', iconColor: 'text-emerald-700', iconBg: 'bg-emerald-100/40' },
  { color: 'bg-rose-100', iconColor: 'text-rose-700', iconBg: 'bg-rose-100/40' },
];

const SavedSupplements = ({
  selectedDateKey,
  todayDateKey,
  pageX,
}: {
  selectedDateKey: string;
  todayDateKey: string;
  pageX: number;
}) => {
  const { t } = useTranslation();
  const { savedSupplements } = useSavedSupplements();
  const { scans } = useScanHistory();
  const { checkInsByDate, toggleCheckIn } = useDailyCheckIns();
  const scrollProgress = useSharedValue(0);
  const { bleedStyle, contentStyle } = useFullBleed(pageX);
  const selectedDateIsFuture = isDateKeyAfter(selectedDateKey, todayDateKey);
  const selectedDateIsPast = selectedDateKey < todayDateKey;

  type CheckInSupplement = SupplementItem & {
    id: string;
    supplementId?: string;
    checkInKey: string;
    createdAt: string;
  };

  const supplements: CheckInSupplement[] = useMemo(() => {
    const checked = new Set(checkInsByDate[selectedDateKey] ?? []);
    const visible = savedSupplements
      .filter(item => validateCheckInDateForItem(item, selectedDateKey, todayDateKey).isValid)
      .filter(item => item.syncedToCheckIn)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return visible.map((item, index) => {
      const theme = CHECKIN_THEMES[index % CHECKIN_THEMES.length];
      return {
        id: item.id,
        supplementId: item.supplementId,
        checkInKey: buildCheckInKey({ supplementId: item.supplementId, localId: item.id }),
        createdAt: item.createdAt,
        name: item.productName,
        dose: checked.has(buildCheckInKey({ supplementId: item.supplementId, localId: item.id }))
          ? 'Completed'
          : 'Not checked in',
        ...theme,
      };
    });
  }, [checkInsByDate, savedSupplements, selectedDateKey, todayDateKey]);

  const checkedKeys = useMemo(
    () => (selectedDateIsFuture ? new Set<string>() : new Set(checkInsByDate[selectedDateKey] ?? [])),
    [checkInsByDate, selectedDateIsFuture, selectedDateKey],
  );
  const hasAnyCheckInSupplements = useMemo(
    () => savedSupplements.some(item => item.syncedToCheckIn),
    [savedSupplements],
  );
  const latestScanName = useMemo(() => {
    const rawName = scans[0]?.productName?.trim() ?? '';
    const fallback = 'your first scan';
    const name = rawName && rawName.toLowerCase() !== 'unknown supplement' ? rawName : fallback;
    return name.length > 44 ? `${name.slice(0, 41).trim()}...` : name;
  }, [scans]);
  const hasRecentScanWaitingToSave = scans.length > 0 && !hasAnyCheckInSupplements;

  const handleScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      const scrollableWidth = event.contentSize.width - event.layoutMeasurement.width;
      if (scrollableWidth <= 0) {
        scrollProgress.value = 0;
        return;
      }

      const progress = event.contentOffset.x / scrollableWidth;
      scrollProgress.value = Math.min(Math.max(progress, 0), 1);
    },
  });

  const indicatorStyle = useAnimatedStyle(() => ({
    width: INDICATOR_WIDTH,
    transform: [{ translateX: scrollProgress.value * INDICATOR_MAX_LEFT }],
  }));

  return (
    <Animated.View entering={FadeInUp.delay(200).duration(500)} style={styles.checkInWrap}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>Daily Check-in</Text>
        <Pressable>
          <Text style={styles.sectionLink}>View All</Text>
        </Pressable>
      </View>

      {supplements.length === 0 ? (
        <View style={styles.checkInEmpty}>
          <BlurView intensity={28} tint="light" style={StyleSheet.absoluteFill} />
          <View style={styles.checkInEmptyOverlay} />
          <View style={styles.checkInEmptyContent}>
            <Text style={styles.checkInEmptyTitle}>
              {selectedDateIsFuture
                ? 'Future dates are not available for check-in.'
                : hasAnyCheckInSupplements
                  ? 'No supplements were scheduled for this date.'
                  : hasRecentScanWaitingToSave
                    ? `Save ${latestScanName} to start tracking`
                    : t.checkInEmptyTitle}
            </Text>
            <Text style={styles.checkInEmptyDescription}>
              {selectedDateIsFuture
                ? 'Pick today or an earlier date to log supplements.'
                : hasAnyCheckInSupplements
                  ? 'Only supplements scheduled for this date appear here.'
                  : hasRecentScanWaitingToSave
                    ? 'Your scan is ready. Save it to your stack and it will appear here for Daily Check-in.'
                    : t.checkInEmptyDescription}
            </Text>
          </View>
        </View>
      ) : (
        <>
          <AnimatedScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            decelerationRate="fast"
            snapToInterval={CARD_WIDTH + CARD_GAP}
            snapToAlignment="center"
            style={[bleedStyle, { height: CARD_HEIGHT + 20 }]}
            contentContainerStyle={[
              contentStyle,
              {
                paddingBottom: 8,
                alignItems: 'center',
              },
            ]}
          >
            {supplements.map((item, index) => (
              <View
                key={item.id}
                style={{ marginRight: index === supplements.length - 1 ? 0 : CARD_GAP }}
              >
                <SupplementCheckInCard
                  item={item}
                  isChecked={checkedKeys.has(item.checkInKey)}
                  disabled={selectedDateIsPast}
                  onCheckIn={() => {
                    void toggleCheckIn(
                      selectedDateKey,
                      item.checkInKey,
                      item.supplementId ?? null,
                      {
                        createdAt: item.createdAt,
                        syncedToCheckIn: true,
                        routine: savedSupplements.find(saved => saved.id === item.id)?.routine ?? undefined,
                      },
                    );
                  }}
                />
              </View>
            ))}
          </AnimatedScrollView>

          <View style={styles.indicatorTrack}>
            <AnimatedView style={[styles.indicatorThumb, indicatorStyle]} />
          </View>
        </>
      )}
    </Animated.View>
  );
};

// -----------------------------------------------------
// Progress / Chat / Streak cards
// -----------------------------------------------------

const ProgressCard = () => {
  const { savedSupplements, loading: supplementsLoading } = useSavedSupplements();
  const { checkInsByDate, loading: checkInsLoading } = useDailyCheckIns();
  const todayKey = getLocalDateKey(new Date());
  const checkedKeys = useMemo(() => new Set(checkInsByDate[todayKey] ?? []), [checkInsByDate, todayKey]);
  const checkInTargets = useMemo(
    () => savedSupplements.filter(item => validateCheckInDateForItem(item, todayKey, todayKey).isValid),
    [savedSupplements, todayKey],
  );
  const totalCount = checkInTargets.length;
  const takenCount = useMemo(() => {
    return checkInTargets.reduce((count, item) => {
      const checkInKey = buildCheckInKey({ supplementId: item.supplementId, localId: item.id });
      return checkedKeys.has(checkInKey) ? count + 1 : count;
    }, 0);
  }, [checkInTargets, checkedKeys]);
  const remainingCount = Math.max(0, totalCount - takenCount);
  const percent = totalCount > 0 ? Math.round((takenCount / totalCount) * 100) : 0;
  const today = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const progress = totalCount > 0 ? takenCount / totalCount : 0;
  const progressValue = useSharedValue(progress);
  const pulse = useSharedValue(1);
  const percentValue = useSharedValue(percent);
  const displayPercentValue = useSharedValue(percent);
  const cardOpacity = useSharedValue(supplementsLoading || checkInsLoading ? 0 : 1);
  const cardTranslateY = useSharedValue(supplementsLoading || checkInsLoading ? 12 : 0);
  const animationReadyRef = useRef(false);
  const [displayPercent, setDisplayPercent] = useState(percent);

  useEffect(() => {
    if (supplementsLoading || checkInsLoading) return;

    if (!animationReadyRef.current) {
      progressValue.value = progress;
      percentValue.value = percent;
      displayPercentValue.value = percent;
      setDisplayPercent(percent);
      animationReadyRef.current = true;
      return;
    }

    progressValue.value = withTiming(progress, { duration: 480, easing: Easing.out(Easing.cubic) });
    percentValue.value = withTiming(percent, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [
    supplementsLoading,
    checkInsLoading,
    progress,
    percent,
    progressValue,
    percentValue,
    displayPercentValue,
    cardOpacity,
    cardTranslateY,
  ]);

  useEffect(() => {
    if (supplementsLoading || checkInsLoading) return;
    cardOpacity.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    cardTranslateY.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) });
  }, [supplementsLoading, checkInsLoading, cardOpacity, cardTranslateY]);

  useEffect(() => {
    if (!animationReadyRef.current) return;
    if (totalCount === 0) return;
    pulse.value = withSequence(
      withTiming(1.02, { duration: 140, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) }),
    );
  }, [pulse, takenCount, totalCount]);

  useDerivedValue(() => {
    const next = Math.round(percentValue.value);
    if (next !== displayPercentValue.value) {
      displayPercentValue.value = next;
      runOnJS(setDisplayPercent)(next);
    }
  });

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ translateY: cardTranslateY.value }, { scale: pulse.value }],
  }));

  const ringAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progressValue.value),
  }));

  return (
    <Animated.View
      className="w-full bg-[#1e40af] rounded-[2rem] p-6 text-white relative overflow-hidden h-64"
      style={[{ borderCurve: 'continuous' }, cardAnimatedStyle]}
    >
      <View className="flex-1 justify-between relative z-10">
        <View className="flex-row items-center gap-2">
          <View
            className="w-8 h-8 rounded-full border border-blue-400/30 items-center justify-center"
            style={{ borderCurve: 'continuous' }}
          >
            <Pill size={16} color="#bfdbfe" />
          </View>
          <Text style={styles.cardMeta}>Today’s Supplement Progress</Text>
        </View>

        <View className="mt-auto mb-1">
          <AnimatedText style={styles.progressBig}>
            {displayPercent}%
          </AnimatedText>

          <View style={{ marginTop: 8, gap: 6 }}>
            <View className="flex-row items-center gap-2">
              <CheckCircle2 size={16} color="#34d399" />
              <Text style={styles.progressTaken}>Taken: {takenCount} / {totalCount}</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <View className="w-4 h-4 items-center justify-center">
                <View className="w-1.5 h-1.5 rounded-full bg-blue-400/50" />
              </View>
              <Text style={styles.progressRemain}>Remaining: {remainingCount}</Text>
            </View>
          </View>

          <Text style={styles.progressDate}>{today}</Text>
        </View>
      </View>

      <View
        className="absolute right-6 bottom-6 bg-white text-slate-900 rounded-2xl p-4 w-32 shadow-xl shadow-blue-900/20"
        style={{ borderCurve: 'continuous' }}
      >
        <View className="flex-row items-center justify-between mb-2">
          <Text style={styles.goalLabel}>Goal</Text>
          <MoreHorizontal size={16} color="#cbd5f5" />
        </View>

        <View className="w-full aspect-square items-center justify-center">
          <Svg
            viewBox="0 0 100 100"
            style={{ transform: [{ rotate: '-90deg' }] }}
            height="100%"
            width="100%"
          >
            <Circle
              cx="50"
              cy="50"
              r={radius}
              stroke="#e2e8f0"
              strokeWidth={10}
              fill="transparent"
              strokeLinecap="round"
            />
            <AnimatedCircle
              cx="50"
              cy="50"
              r={radius}
              stroke="#3b82f6"
              strokeWidth={10}
              fill="transparent"
              strokeLinecap="round"
              strokeDasharray={circumference}
              animatedProps={ringAnimatedProps}
            />
          </Svg>

          <View className="absolute inset-0 items-center justify-center pt-1">
            <Text style={styles.goalValue}>{takenCount}</Text>
            <Text style={styles.goalSub}>of {totalCount}</Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

type NutriTipCardProps = {
  selection: NutriTipSelection | null;
  loading: boolean;
  error: string | null;
  density?: Density;
};

const DidYouKnowLogo = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="10.5" r="4.5" stroke="#0f172a" strokeWidth={2.3} />
    <Rect x="9" y="15" width="6" height="4" rx="1.2" stroke="#0f172a" strokeWidth={2.3} />
    <Line x1="12" y1="2.5" x2="12" y2="5" stroke="#0f172a" strokeWidth={2.3} strokeLinecap="round" />
    <Line x1="6.5" y1="5" x2="8.5" y2="6.5" stroke="#0f172a" strokeWidth={2.3} strokeLinecap="round" />
    <Line x1="17.5" y1="5" x2="15.5" y2="6.5" stroke="#0f172a" strokeWidth={2.3} strokeLinecap="round" />
    <Line x1="4.5" y1="10.5" x2="7" y2="10.5" stroke="#0f172a" strokeWidth={2.3} strokeLinecap="round" />
    <Line x1="19.5" y1="10.5" x2="17" y2="10.5" stroke="#0f172a" strokeWidth={2.3} strokeLinecap="round" />
  </Svg>
);

const NutriTipCard = ({ selection, loading, error, density = 'regular' }: NutriTipCardProps) => {
  const isCompact = density === 'compact';
  const cardPadding = isCompact ? 20 : 24;
  const bubblePadding = isCompact ? 12 : 18;
  const summaryMaxWidth = '100%';
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [isThoughtOpen, setIsThoughtOpen] = useState(false);
  const overlayBubbleWidth = Math.min(360, windowWidth - (isCompact ? 32 : 48));
  const overlayBubbleMaxHeight = Math.min(560, Math.max(280, windowHeight * 0.7));
  const overlayBodyMaxHeight = Math.max(160, overlayBubbleMaxHeight - 140);
  const tip = selection?.tip;
  const title = loading ? 'Loading daily tip...' : error ? 'Tip unavailable' : tip?.title ?? 'Daily tip';
  const promptTitle = 'Daily Tip';
  const supplementName = loading
    ? 'Loading...'
    : error
      ? 'Tip unavailable'
      : tip?.supplement ?? tip?.title ?? 'Daily tip';
  const detailText = loading
    ? "Hang tight while we fetch today's full tip."
    : error
      ? "We couldn't load the full tip right now."
      : tip?.detailMarkdown ?? tip?.coverText ?? 'New knowledge for your supplements.';
  const formattedDetail = useMemo(() => {
    return detailText
      .replace(/\r\n/g, '\n')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }, [detailText]);
  const showTitle = Boolean(!loading && !error && tip?.title && tip.title !== supplementName);

  const renderDetailContent = useCallback(() => {
    const lines = formattedDetail.split('\n');
    let section: 'sources' | 'disclaimer' | null = null;

    return (
      <Text style={styles.thoughtBubbleText}>
        {lines.map((line, index) => {
          const trimmed = line.trim();
          const lower = trimmed.toLowerCase();
          if (lower === 'sources') {
            section = 'sources';
          } else if (lower === 'disclaimer') {
            section = 'disclaimer';
          }

          if (!trimmed) {
            return <Text key={`detail-line-${index}`}>{'\n'}</Text>;
          }

          const isHeading = lower === 'sources' || lower === 'disclaimer';
          const isSourceBullet = section === 'sources' && /^[-–—]\s*/.test(trimmed);
          const isDisclaimerLine = section === 'disclaimer' && !isHeading;

          if (isSourceBullet) {
            const bulletMatch = trimmed.match(/^([-–—]\s*)(.*)$/);
            const bulletPrefix = bulletMatch?.[1] ?? '';
            const restText = bulletMatch?.[2] ?? trimmed;
            const urlMatch = restText.match(/https?:\/\/\S+/i);
            if (urlMatch && urlMatch.index !== undefined) {
              const start = urlMatch.index;
              const url = urlMatch[0];
              const before = restText.slice(0, start);
              const after = restText.slice(start + url.length);
              return (
                <Text key={`detail-line-${index}`}>
                  {bulletPrefix}
                  <Text style={styles.thoughtBubbleTextBold}>{before}</Text>
                  <Text>{url}</Text>
                  <Text style={styles.thoughtBubbleTextBold}>{after}</Text>
                  {index < lines.length - 1 ? '\n' : ''}
                </Text>
              );
            }

            return (
              <Text key={`detail-line-${index}`}>
                {bulletPrefix}
                <Text style={styles.thoughtBubbleTextBold}>{restText}</Text>
                {index < lines.length - 1 ? '\n' : ''}
              </Text>
            );
          }

          if (isDisclaimerLine) {
            return (
              <Text key={`detail-line-${index}`} style={styles.thoughtBubbleTextBold}>
                {line}
                {index < lines.length - 1 ? '\n' : ''}
              </Text>
            );
          }

          return (
            <Text key={`detail-line-${index}`}>
              {line}
              {index < lines.length - 1 ? '\n' : ''}
            </Text>
          );
        })}
      </Text>
    );
  }, [formattedDetail]);

  const handleOpenTip = () => {
    setIsThoughtOpen(true);
  };

  const handleCloseTip = () => {
    setIsThoughtOpen(false);
  };

  return (
    <>
      <Animated.View
        entering={FadeInUp.delay(300).duration(500).springify()}
        className="bg-[#EFE2C8] rounded-[2rem] flex-1 flex-col relative overflow-hidden"
        style={{ borderCurve: 'continuous', padding: cardPadding, minHeight: 192 }}
      >
        <View className="flex-row items-center justify-between z-10">
          <View className="flex-row items-center gap-2">
            <View style={styles.tipLogoBox}>
              <DidYouKnowLogo />
            </View>
            <Text style={styles.smallCardTitleDark} numberOfLines={1}>
              {promptTitle}
            </Text>
          </View>
        </View>

        <View style={styles.tipBody}>
          <Pressable
            onPress={handleOpenTip}
            style={[
              styles.tipSupplementCard,
              {
                borderCurve: 'continuous',
                padding: bubblePadding,
                maxWidth: summaryMaxWidth,
                minHeight: isCompact ? 48 : 64,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Open tip for ${supplementName}`}
          >
            <Text
              style={[styles.tipSupplementName, isCompact ? { fontSize: 12, lineHeight: 16 } : null]}
              numberOfLines={2}
            >
              {supplementName}
            </Text>
          </Pressable>
          <Text style={styles.tipHint}>Tap the supplement for the full tip.</Text>
        </View>
      </Animated.View>

      <Modal
        visible={isThoughtOpen}
        transparent
        animationType="fade"
        onRequestClose={handleCloseTip}
      >
        <View style={styles.tipModalOverlay}>
          <BlurView intensity={42} tint="light" style={StyleSheet.absoluteFill} />
          <View style={styles.tipModalDim} />
          <Pressable style={StyleSheet.absoluteFill} onPress={handleCloseTip} />
          <SafeAreaView style={styles.tipModalSafe} edges={['top', 'bottom']}>
            <MotiView
              from={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'timing', duration: 220 }}
              style={styles.thoughtBubbleShell}
            >
              <View
                style={[
                  styles.thoughtBubble,
                  { width: overlayBubbleWidth, maxHeight: overlayBubbleMaxHeight },
                ]}
              >
                <View style={styles.thoughtBubbleHeader}>
                  <Text style={styles.thoughtBubbleTitle}>{supplementName}</Text>
                  <Pressable
                    onPress={handleCloseTip}
                    style={styles.thoughtBubbleClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close tip"
                  >
                    <X size={16} color="#64748b" />
                  </Pressable>
                </View>
                {showTitle ? <Text style={styles.thoughtBubbleSubtitle}>{title}</Text> : null}
                <ScrollView
                  style={{ maxHeight: overlayBodyMaxHeight }}
                  contentContainerStyle={styles.thoughtBubbleScroll}
                  showsVerticalScrollIndicator
                >
                  {renderDetailContent()}
                </ScrollView>
              </View>
              <View style={styles.thoughtBubbleTailLarge} />
              <View style={styles.thoughtBubbleTailSmall} />
            </MotiView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
};

const StreakCard = ({ density = 'regular' }: { density?: Density }) => {
  const isCompact = density === 'compact';
  const cardPadding = isCompact ? 20 : 24;
  const { savedSupplements } = useSavedSupplements();
  const { checkInsByDate } = useDailyCheckIns();
  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);
  const trackedItems = useMemo(
    () => savedSupplements.filter(item => item.syncedToCheckIn),
    [savedSupplements],
  );
  const currentStreakDays = useMemo(
    () => getCurrentPerfectStreakDays(trackedItems, checkInsByDate, todayKey),
    [checkInsByDate, todayKey, trackedItems],
  );
  const nextMilestone = useMemo(
    () => getNextStreakMilestone(currentStreakDays),
    [currentStreakDays],
  );
  const barHeights = useMemo(() => {
    return buildCheckInSeries(trackedItems, checkInsByDate, todayKey, 7).map(day => {
      if (!day.expectedCount) return 0.2;
      return Math.max(0.2, day.completedCount / day.expectedCount);
    });
  }, [checkInsByDate, todayKey, trackedItems]);

  return (
    <Animated.View
      entering={FadeInUp.delay(300).duration(500).springify()}
      className="bg-[#FACC15] rounded-[2rem] flex-1 flex-col justify-between relative overflow-hidden"
      style={{ borderCurve: 'continuous', padding: cardPadding, minHeight: 192 }}
    >
      <View className="flex-row items-center justify-between z-10">
        <View className="flex-row items-center gap-2">
          <View
            className="w-8 h-8 rounded-full bg-orange-500/20 items-center justify-center"
            style={{ borderCurve: 'continuous' }}
          >
            <Flame size={16} color="#ea580c" />
          </View>
          <Text style={styles.smallCardTitleDark}>Streak</Text>
        </View>
      </View>

      <View className="z-10 mt-auto flex-row justify-between items-end">
        <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
          <View className="flex-row items-baseline gap-1">
            <Text style={styles.streakValue}>{currentStreakDays}</Text>
            <Text style={styles.streakUnit}>Days</Text>
          </View>
          <View className="mt-1 bg-slate-900/10 px-2 py-1 rounded-lg" style={{ borderCurve: 'continuous' }}>
            <Text style={styles.streakGoal} numberOfLines={1} ellipsizeMode="tail">
              {nextMilestone.daysRemaining === 0
                ? `${nextMilestone.goalDays}-day streak reached`
                : `Goal: ${nextMilestone.goalDays} Days`}
            </Text>
          </View>
        </View>

        <View style={{ flexShrink: 0 }} className="h-10 flex-row items-end gap-1">
          {barHeights.map((h, i) => (
            <Animated.View
              key={i}
              entering={FadeInUp.delay(600 + i * 100).springify()}
              style={{ height: `${h * 100}%` }}
              className={`w-1.5 rounded-t-sm ${i === 6 ? 'bg-slate-900' : 'bg-slate-900/30'}`}
            />
          ))}
        </View>
      </View>
    </Animated.View>
  );
};

const TrendCard = ({ trend }: { trend: TrendData }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const activeIndex = selectedIndex;
  const selectedEntry = selectedIndex !== null ? trend.series[selectedIndex] : null;
  const detailLine = selectedEntry
    ? selectedEntry.v === null
      ? `Selected: ${selectedEntry.k} --`
      : `Selected: ${selectedEntry.k} ${selectedEntry.v}% (${selectedEntry.completed}/${selectedEntry.total})`
    : trend.summaryB;

  useEffect(() => {
    setSelectedIndex(null);
  }, [trend.title, trend.series.length]);

  return (
    <Animated.View
      entering={FadeInUp.delay(420).duration(500)}
      style={[styles.trendCard, { borderCurve: 'continuous' }]}
    >
      <View style={styles.trendContent}>
        <View style={styles.trendHeaderRow}>
          <Text style={styles.trendTitle}>{trend.title}</Text>
          <View style={styles.trendIconButton}>
            <Activity size={20} color="#0f172a" />
          </View>
        </View>

        <View style={styles.trendBarsRow}>
          {trend.series.map((entry, idx) => {
            const isActive = activeIndex !== null && idx === activeIndex;
            return (
              <MotiView
                key={`${entry.k}-${idx}`}
                style={styles.trendBarColumn}
                animate={{
                  translateY: isActive ? -6 : 0,
                  scale: isActive ? 1.05 : 1,
                }}
                transition={{ type: 'timing', duration: 220 }}
              >
                <Pressable
                  onPress={() => setSelectedIndex(prev => (prev === idx ? null : idx))}
                  style={styles.trendBarPressable}
                  hitSlop={8}
                >
                  <View style={styles.trendBarTrack}>
                    <MotiView
                      from={{ height: 0 }}
                      animate={{
                        height:
                          entry.v === null
                            ? TREND_BAR_MIN_HEIGHT
                            : entry.v === 0
                              ? 0
                              : Math.max(TREND_BAR_MIN_HEIGHT, (entry.v / 100) * TREND_BAR_HEIGHT),
                      }}
                      transition={{ type: 'timing', duration: 520 }}
                      style={[
                        styles.trendBarFill,
                        isActive ? styles.trendBarFillActive : styles.trendBarFillInactive,
                        entry.v === null && styles.trendBarFillEmpty,
                        entry.v === 0 && styles.trendBarFillZero,
                      ]}
                    />
                  </View>
                  <Text style={[styles.trendBarLabel, isActive && styles.trendBarLabelActive]}>
                    {entry.k}
                  </Text>
                  <Text style={[styles.trendBarValue, isActive && styles.trendBarValueActive]}>
                    {entry.v === null ? '--' : `${entry.v}%`}
                  </Text>
                </Pressable>
              </MotiView>
            );
          })}
        </View>

        <View style={styles.trendSummary}>
          <Text style={styles.trendSummaryPrimary}>{trend.summaryA}</Text>
          <Text style={styles.trendSummarySecondary}>{detailLine}</Text>
        </View>
      </View>
    </Animated.View>
  );
};

// -----------------------------------------------------
// Recently Scanned
// -----------------------------------------------------

const RecentlyScanned = () => {
  const { addSupplement, savedSupplements } = useSavedSupplements();
  const { scans } = useScanHistory();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});

  const normalize = useCallback((value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '').trim(), []);
  const cleanProductName = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return value;
    let next = trimmed.replace(/\s*[-–—]+$/g, '');
    next = next.replace(
      /\s*\d+(?:\.\d+)?\s*(?:ct|count|servings?|caps(?:ules)?|tabs?|tablets?|softgels?|gummies?|drops?|liquid)\b.*$/i,
      '',
    );
    next = next.replace(/\s*[-–—]+$/g, '');
    return next.trim() || trimmed;
  }, []);
  const normalizeBrandNameForKey = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return 'Unknown brand';
    if (trimmed.toLowerCase() === 'unknown brand') return 'Unknown brand';
    return trimmed;
  }, []);
  const buildNameKey = useCallback(
    (productName: string, brandName: string) =>
      `name:${normalize(normalizeBrandNameForKey(brandName))}:${normalize(productName)}`,
    [normalize, normalizeBrandNameForKey],
  );
  const getSupplementKeys = useCallback(
    (item: { supplementId?: string | null; barcode?: string | null; productName: string; brandName: string }) => {
      const keys: string[] = [];
      if (item.supplementId) keys.push(`supplement:${item.supplementId}`);
      if (item.barcode) keys.push(`barcode:${item.barcode}`);
      keys.push(buildNameKey(item.productName, item.brandName));
      return keys;
    },
    [buildNameKey],
  );

  const savedKeys = useMemo(() => {
    const keys = new Set<string>();
    savedSupplements.forEach((item) => {
      getSupplementKeys(item).forEach((key) => keys.add(key));
    });
    return keys;
  }, [getSupplementKeys, savedSupplements]);
  const isItemSaved = useCallback(
    (item: { supplementId?: string | null; barcode?: string | null; productName: string; brandName: string }) =>
      getSupplementKeys(item).some((key) => savedKeys.has(key)),
    [getSupplementKeys, savedKeys],
  );

  const items = useMemo(() => scans.slice(0, 3), [scans]);
  const totalCount = scans.length;
  const historySheetMaxHeight = Math.min(Math.max(height * 0.72, 420), 640);

  const formatRelativeScanTime = useCallback((value: string) => {
    const scannedAt = new Date(value);
    if (Number.isNaN(scannedAt.getTime())) return null;

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const scanKey = getLocalDateKey(scannedAt);
    const todayKey = getLocalDateKey(today);
    const yesterdayKey = getLocalDateKey(yesterday);

    const timeLabel = scannedAt.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });

    if (scanKey === todayKey) return `Today · ${timeLabel}`;
    if (scanKey === yesterdayKey) return `Yesterday · ${timeLabel}`;

    const dateLabel = scannedAt.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
    return `${dateLabel} · ${timeLabel}`;
  }, []);

  const buildItemMeta = useCallback(
    (item: ScanHistoryItem) => {
      const parts = [item.brandName?.trim(), formatRelativeScanTime(item.scannedAt)].filter(Boolean);
      return parts.join(' · ');
    },
    [formatRelativeScanTime],
  );

  const handleSave = (item: ScanHistoryItem) => {
    if (savingIds[item.id]) return;
    if (isItemSaved(item)) return;

    setSavingIds(prev => ({ ...prev, [item.id]: true }));
    const added = addSupplement({
      supplementId: item.supplementId ?? undefined,
      barcode: item.barcode ?? null,
      productName: item.productName,
      brandName: item.brandName,
      dosageText: item.dosageText ?? '',
      imageUrl: item.imageUrl ?? null,
    });
    if (!added) {
      setSavingIds(prev => ({ ...prev, [item.id]: false }));
      return;
    }

    const activationPayload = {
      activationDefinition: NUTRI_ACTIVATION_DEFINITION.id,
      source: 'home_recent_scans',
      scanHistoryId: item.id,
      supplementId: item.supplementId ?? null,
      hasBarcode: Boolean(item.barcode),
    };
    trackOnboardingEvent('saved_to_stack', activationPayload);
    if (added.syncedToCheckIn !== false) {
      trackOnboardingEvent('check_in_started', activationPayload);
    }

    setTimeout(() => {
      setSavingIds(prev => ({ ...prev, [item.id]: false }));
    }, 240);
  };

  const renderRecentRow = (item: ScanHistoryItem, index: number, options?: { showMeta?: boolean; animated?: boolean }) => {
    const showMeta = options?.showMeta ?? false;
    const animated = options?.animated ?? false;
    const isSaved = isItemSaved(item);
    const isSaving = savingIds[item.id];
    const isActive = isSaved || isSaving;
    const iconConfig = getCategoryIconConfig(item.category, item.productName || '');
    const Icon = iconConfig.icon;
    const iconStyle = iconConfig.rotate ? { transform: [{ rotate: iconConfig.rotate }] } : undefined;
    const meta = showMeta ? buildItemMeta(item) : '';

    const row = (
      <View
        className="flex-row items-center justify-between p-3 rounded-2xl bg-white/20 border border-white/10"
        style={{ borderCurve: 'continuous' }}
      >
        <View style={[styles.recentIconOuter, { borderCurve: 'continuous' as const }]}>
          <View style={[styles.recentIconInner, { borderCurve: 'continuous' as const }]}>
            <View style={iconStyle}>
              <Icon size={20} color="#0f172a" strokeWidth={2.2} />
            </View>
          </View>
        </View>

        <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 12 }}>
          <Text style={styles.recentItemTitle} numberOfLines={showMeta ? 3 : 2} ellipsizeMode="tail">
            {cleanProductName(item.productName || 'Unknown supplement')}
          </Text>
          {meta ? (
            <Text style={styles.recentItemMeta} numberOfLines={1} ellipsizeMode="tail">
              {meta}
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={() => handleSave(item)}
          disabled={isActive}
          hitSlop={10}
          style={({ pressed }) => [
            styles.recentActionPressable,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <MotiView
            style={styles.recentActionBubble}
            animate={{
              backgroundColor: isActive ? 'rgba(16,185,129,0.85)' : 'rgba(255,255,255,0.40)',
              borderColor: isActive ? 'rgba(16,185,129,0.45)' : 'rgba(255,255,255,0.30)',
              scale: isActive ? 1.04 : 1,
            }}
            transition={{ type: 'spring', stiffness: 260, damping: 18, mass: 0.7 }}
          >
            <View pointerEvents="none" style={styles.recentActionIconWrap}>
              <MotiView
                style={styles.recentActionIcon}
                animate={{
                  opacity: isActive ? 0 : 1,
                  scale: isActive ? 0.6 : 1,
                  rotate: isActive ? '-90deg' : '0deg',
                }}
                transition={{ type: 'timing', duration: 160 }}
              >
                <Plus size={12} color="#0f172a" />
              </MotiView>
              <MotiView
                style={styles.recentActionIcon}
                animate={{
                  opacity: isActive ? 1 : 0,
                  scale: isActive ? 1 : 0.6,
                  rotate: isActive ? '0deg' : '20deg',
                }}
                transition={{ type: 'timing', duration: 160 }}
              >
                <Check size={12} color="#ffffff" />
              </MotiView>
            </View>
          </MotiView>
        </Pressable>
      </View>
    );

    if (!animated) {
      return <View key={item.id}>{row}</View>;
    }

    return (
      <Animated.View
        key={item.id}
        entering={FadeInRight.delay(700 + index * 100).springify()}
      >
        {row}
      </Animated.View>
    );
  };

  return (
    <>
      <Animated.View
        entering={FadeInUp.delay(600).duration(500)}
        className="bg-blue-300 rounded-[2rem] p-6"
        style={{ borderCurve: 'continuous' }}
      >
        <View className="flex-row justify-between items-start mb-4">
          <View>
            <Text style={styles.recentTitle}>Recently Scanned</Text>
            <Text style={styles.recentSubtitle}>Today</Text>
          </View>

          <Pressable
            onPress={() => setIsHistoryOpen(true)}
            style={({ pressed }) => [
              styles.recentViewAllPill,
              { opacity: pressed ? 0.82 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`View all ${totalCount} recent scans`}
          >
            <Text style={styles.recentViewAllText}>{`View All (${totalCount})`}</Text>
          </Pressable>
        </View>

        <View style={{ gap: 8 }}>
          {items.length === 0 ? (
            <View className="rounded-2xl bg-white/20 border border-white/10 p-4" style={{ borderCurve: 'continuous' }}>
              <Text style={styles.recentEmpty}>{t.emptyScans}</Text>
            </View>
          ) : (
            items.map((item, index) => renderRecentRow(item, index, { animated: true }))
          )}
        </View>
      </Animated.View>

      <Modal
        visible={isHistoryOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsHistoryOpen(false)}
      >
        <View style={styles.recentSheetOverlay}>
          <BlurView intensity={48} tint="light" style={StyleSheet.absoluteFill} />
          <View style={styles.recentSheetDim} />
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsHistoryOpen(false)} />

          <SafeAreaView style={styles.recentSheetSafe} edges={['bottom']}>
            <MotiView
              from={{ opacity: 0, translateY: 28 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 220 }}
              style={[
                styles.recentSheet,
                {
                  maxHeight: historySheetMaxHeight,
                  paddingBottom: Math.max(insets.bottom, 12),
                },
              ]}
            >
              <View style={styles.recentSheetHandle} />

              <View style={styles.recentSheetHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.recentSheetTitle}>Recently Scanned</Text>
                  <Text style={styles.recentSubtitle}>{`${totalCount} item${totalCount === 1 ? '' : 's'}`}</Text>
                </View>

                <Pressable
                  onPress={() => setIsHistoryOpen(false)}
                  style={styles.recentSheetClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close recent scans"
                >
                  <X size={18} color="#64748b" />
                </Pressable>
              </View>

              <ScrollView
                style={{ maxHeight: historySheetMaxHeight - 88 }}
                contentContainerStyle={styles.recentSheetContent}
                showsVerticalScrollIndicator={false}
              >
                {scans.length === 0 ? (
                  <View style={styles.recentSheetEmpty}>
                    <Text style={styles.recentEmpty}>{t.emptyScans}</Text>
                  </View>
                ) : (
                  scans.map((item, index) => renderRecentRow(item, index, { showMeta: true }))
                )}
              </ScrollView>
            </MotiView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
};

// -----------------------------------------------------
// Refined Bottom Nav + 1:1 Floating Menu (原样保留)
// -----------------------------------------------------

type TabId = 'home' | 'progress' | 'saved' | 'profile';
type TabType = 'text' | 'icon';

const normalizeRequestedTab = (value: string | string[] | undefined): TabId | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'home' || raw === 'progress' || raw === 'saved' || raw === 'profile') return raw;
  return null;
};

const TabItem = ({
  item,
  activeTabId,
  onPress,
}: {
  item: { id: TabId; label: string; icon: any; type: TabType; activeColor?: string };
  activeTabId: SharedValue<TabId>;
  onPress: () => void;
}) => {
  const isText = item.type === 'text';
  const activeColor = item.activeColor || '#0f172a';
  const isActive = useDerivedValue(() =>
    withTiming(activeTabId.value === item.id ? 1 : 0, { duration: 200 }),
  );

  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(isActive.value, [0, 1], ['#64748b', '#0f172a']),
  }));

  const inactiveIconStyle = useAnimatedStyle(() => ({
    opacity: 1 - isActive.value,
  }));
  const activeIconStyle = useAnimatedStyle(() => ({
    opacity: isActive.value,
    transform: [{ scale: 0.8 + 0.2 * isActive.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.tabItem,
        isText ? styles.tabItemText : styles.tabItemIcon,
        { zIndex: 10 },
      ]}
    >
      <View style={styles.contentLayer}>
        {isText ? (
          <AnimatedText style={[styles.label, textStyle]}>{item.label}</AnimatedText>
        ) : (
          <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
            <AnimatedView style={[StyleSheet.absoluteFill, inactiveIconStyle]}>
              <item.icon size={22} strokeWidth={2} color="#94a3b8" />
            </AnimatedView>
            <AnimatedView style={[StyleSheet.absoluteFill, activeIconStyle]}>
              <item.icon size={22} strokeWidth={2.5} color={activeColor} />
            </AnimatedView>
          </View>
        )}
      </View>
    </Pressable>
  );
};

const BottomNav = ({
  currentTab,
  onTabChange,
  pageX,
}: {
  currentTab: TabId;
  onTabChange: (tab: TabId) => void;
  pageX: number;
}) => {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const bottomInset = Math.max(0, insets.bottom - BOTTOM_INSET_TRIM);
  const bottomFadeHeight = Math.max(160, bottomInset + BOTTOM_FADE_EXTRA);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const activeId = useSharedValue<TabId>(currentTab);
  const available = windowWidth - pageX * 2 - PLUS_BUTTON_SIZE - NAV_PILL_GAP;
  const navPillWidth = Math.max(0, Math.min(NAV_PILL_TARGET_WIDTH, available));

  type TabItemConfig = { id: TabId; label: string; icon: any; type: TabType; activeColor?: string };

  const tabs: TabItemConfig[] = useMemo(
    () => [
      { id: 'home', label: 'Home', icon: Home, type: 'text' },
      { id: 'progress', label: 'Progress', icon: BarChart2, type: 'icon', activeColor: '#6366f1' },
      { id: 'saved', label: 'Saved', icon: Bookmark, type: 'icon', activeColor: '#f97316' },
      { id: 'profile', label: 'Profile', icon: User, type: 'icon', activeColor: '#10b981' },
    ],
    [],
  );

  type TabLayout = { x: number; width: number; type: TabType; activeColor?: string };
  const layoutRef = useRef<Record<TabId, TabLayout>>({} as Record<TabId, TabLayout>);
  const tabMeta = useSharedValue<{ id: TabId; x: number; width: number; center: number; type: TabType; activeColor?: string }[]>([]);
  const pillX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const pillRadius = useSharedValue(24);
  const dragStartX = useSharedValue(0);
  const pillScale = useSharedValue(1);
  const navScaleX = useSharedValue(1);
  const navScaleY = useSharedValue(1);
  const navLift = useSharedValue(0);

  const initPillToActive = useCallback(() => {
    const meta = Object.values(layoutRef.current);
    if (meta.length !== tabs.length) return;
    const arranged = tabs
      .map(t => {
        const l = layoutRef.current[t.id];
        return l ? { ...l, id: t.id, center: l.x + l.width / 2 } : null;
      })
      .filter(Boolean) as { id: TabId; x: number; width: number; center: number; type: TabType; activeColor?: string }[];

    if (!arranged.length) return;
    tabMeta.value = arranged;
    activeId.value = currentTab;
    const activeLayout = arranged.find(m => m.id === currentTab);
    if (activeLayout) {
      pillX.value = activeLayout.x;
      pillWidth.value = activeLayout.width;
      pillRadius.value = activeLayout.type === 'text' ? 24 : activeLayout.width / 2;
    }
  }, [activeId, currentTab, pillRadius, pillWidth, pillX, tabMeta, tabs]);

  const onTabLayout = useCallback(
    (id: TabId, type: TabType, activeColor?: string) => (e: any) => {
      const { x, width } = e.nativeEvent.layout;
      layoutRef.current[id] = { x, width, type, activeColor };
      if (Object.keys(layoutRef.current).length === tabs.length) {
        initPillToActive();
      }
    },
    [initPillToActive, tabs.length],
  );

  const snapToTab = useCallback(
    (targetId: TabId) => {
      const worklet = (id: TabId) => {
        'worklet';
        const metaList = tabMeta.value;
        if (!metaList.length) return;
        const target = metaList.find(m => m.id === id);
        if (!target) return;

        activeId.value = id;

        const radius = target.type === 'text' ? 24 : target.width / 2;
        pillWidth.value = withSpring(target.width, { damping: 14, stiffness: 220, mass: 0.9 });
        pillRadius.value = withSpring(radius, { damping: 14, stiffness: 220, mass: 0.9 });
        pillX.value = withSpring(target.x, { damping: 14, stiffness: 220, mass: 0.9 });
      };
      runOnUI(worklet)(targetId);
    },
    [activeId, pillRadius, pillWidth, pillX, tabMeta],
  );

  const pillGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          dragStartX.value = pillX.value;
          navScaleX.value = withTiming(1.02, { duration: 180, easing: Easing.out(Easing.cubic) });
          navScaleY.value = withTiming(1.04, { duration: 180, easing: Easing.out(Easing.cubic) });
          navLift.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
          pillScale.value = withSpring(1.07, { damping: 14, stiffness: 260 });
          runOnJS(Haptics.selectionAsync)();
        })
        .onChange(event => {
          const metaList = tabMeta.value;
          if (!metaList.length) return;
          const first = metaList[0];
          const last = metaList[metaList.length - 1];
          const minX = first.x;
          const maxX = last.x + last.width - pillWidth.value;
          const nextX = Math.min(Math.max(dragStartX.value + event.translationX, minX), maxX);
          pillX.value = nextX;

          const center = nextX + pillWidth.value / 2;
          let closest = metaList[0];
          let minDist = Math.abs(center - closest.center);
          for (let i = 1; i < metaList.length; i += 1) {
            const candidate = metaList[i];
            const dist = Math.abs(center - candidate.center);
            if (dist < minDist) {
              closest = candidate;
              minDist = dist;
            }
          }

          if (activeId.value !== closest.id) {
            activeId.value = closest.id;
            runOnJS(Haptics.selectionAsync)();
          }
        })
        .onEnd(() => {
          const metaList = tabMeta.value;
          if (!metaList.length) return;
          navScaleX.value = withSpring(1, { damping: 14, stiffness: 180, mass: 0.9 });
          navScaleY.value = withSpring(1, { damping: 14, stiffness: 180, mass: 0.9 });
          navLift.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
          pillScale.value = withSpring(1, { damping: 14, stiffness: 260 });

          const currentActive = activeId.value;
          const target = metaList.find(m => m.id === currentActive) || metaList[0];
          const radius = target.type === 'text' ? 24 : target.width / 2;
          runOnJS(onTabChange)(target.id as TabId);
          pillWidth.value = withSpring(target.width, { damping: 14, stiffness: 220, mass: 0.9 });
          pillRadius.value = withSpring(radius, { damping: 14, stiffness: 220, mass: 0.9 });
          pillX.value = withSpring(target.x, { damping: 14, stiffness: 220, mass: 0.9 });
        }),
    [activeId, dragStartX, navLift, navScaleX, navScaleY, onTabChange, pillScale, pillWidth, pillX, pillRadius, tabMeta],
  );

  const navBarStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: navScaleX.value }, { scaleY: navScaleY.value }],
  }));

  const navHighlightStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(navLift.value, [0, 1], ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.18)']),
  }));

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }, { scale: pillScale.value }],
    width: pillWidth.value,
    borderRadius: pillRadius.value,
  }));

  return (
    <>
      <AnimatePresence>
        {isMenuOpen && (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'timing', duration: 200 }}
            style={[StyleSheet.absoluteFill, { zIndex: 40 }]}
          >
            <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFill} />
            <View className="absolute inset-0 bg-white/10" />
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsMenuOpen(false)} />
          </MotiView>
        )}
      </AnimatePresence>

      <View pointerEvents="box-none" style={[styles.bottomBarContainer, { paddingBottom: bottomInset, paddingHorizontal: pageX }]}>
        <View
          pointerEvents="none"
          style={[
            styles.bottomFade,
            {
              left: -pageX,
              right: -pageX,
              bottom: -bottomInset,
              height: bottomFadeHeight,
            },
          ]}
        >
          <MaskedView
            style={StyleSheet.absoluteFill}
            maskElement={
              <LinearGradient
                colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,1)']}
                locations={[0, 0.18, 0.62, 1]}
                style={StyleSheet.absoluteFill}
              />
            }
          >
            <BlurView intensity={52} tint="light" style={StyleSheet.absoluteFill} />
          </MaskedView>

          <LinearGradient
            colors={[
              'rgba(242,243,247,0.00)',
              'rgba(242,243,247,0.20)',
              'rgba(242,243,247,0.60)',
              'rgba(242,243,247,0.92)',
              '#F2F3F7',
            ]}
            locations={[0, 0.22, 0.58, 0.84, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        <View style={[styles.outerWrapper, { flex: 0, width: navPillWidth }]}>
          <Animated.View style={[styles.navShadowWrap, navBarStyle]}>
            <View style={styles.navPill}>
              <BlurView intensity={22} tint="light" style={StyleSheet.absoluteFill} />
              <View pointerEvents="none" style={styles.navPillGlassOverlay} />
              <Animated.View style={[styles.navPillHighlight, navHighlightStyle]} />

              <View style={styles.tabsRow}>
                <Animated.View style={[styles.pillContainer, pillStyle, { zIndex: 0 }]} pointerEvents="none">
                  <View style={styles.pillBase} />
                </Animated.View>

                {tabs.map(tab => (
                  <View
                    key={tab.id}
                    onLayout={onTabLayout(tab.id, tab.type, tab.activeColor)}
                    style={tab.id === 'progress' ? { marginLeft: 'auto' } : undefined}
                  >
                    <TabItem
                      item={tab}
                      activeTabId={activeId}
                      onPress={() => {
                        onTabChange(tab.id);
                        snapToTab(tab.id);
                      }}
                    />
                  </View>
                ))}

                <GestureDetector gesture={pillGesture}>
                  <Animated.View
                    style={[
                      styles.pillContainer,
                      pillStyle,
                      { zIndex: 100, opacity: 0, backgroundColor: 'red' },
                    ]}
                    pointerEvents="box-only"
                  />
                </GestureDetector>
              </View>
            </View>
          </Animated.View>
        </View>

        <View className="relative items-center justify-center">
          <AnimatePresence>
            {isMenuOpen && (
              <MotiView
                className="absolute bottom-20 right-0 flex-col gap-5 items-end min-w-[200px] z-40 mb-2"
                from={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <FloatingMenuItem
                  labelTop="Barcode"
                  labelBottom="Scan"
                  Icon={ScanBarcode}
                  delay={0}
                  onPress={() => router.replace('/scan/barcode')}
                />
              </MotiView>
            )}
          </AnimatePresence>

          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setIsMenuOpen(!isMenuOpen);
            }}
            style={[styles.plusWrap, isMenuOpen ? styles.plusWrapOpen : styles.plusWrapClosed]}
          >
            {!isMenuOpen && <BlurView intensity={22} tint="light" style={StyleSheet.absoluteFill} />}
            {!isMenuOpen && <View pointerEvents="none" style={styles.plusGlassOverlay} />}

            <MotiView
              animate={{ rotate: isMenuOpen ? '45deg' : '0deg' }}
              transition={{ type: 'timing', duration: 180 }}
              style={styles.plusButton}
            >
              <Plus size={32} strokeWidth={2.5} color={isMenuOpen ? 'white' : '#0f172a'} />
            </MotiView>
          </Pressable>
        </View>
      </View>
    </>
  );
};

// Menu Item
function FloatingMenuItem({ labelTop, labelBottom, Icon, delay, onPress }: any) {
  return (
    <MotiView
      from={{ opacity: 0, translateY: 12, scale: 0.95 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      exit={{ opacity: 0, translateY: 12, scale: 0.95 }}
      transition={{ type: 'timing', duration: 180, delay }}
      className="flex-row items-center gap-4 justify-end"
    >
      <Pressable onPress={onPress} className="flex-row items-center gap-4">
        <View
          className="bg-white px-6 py-3 rounded-[1.5rem] border border-white flex-col items-center"
          style={{
            borderCurve: 'continuous',
            shadowColor: '#cbd5e1',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.3,
            shadowRadius: 10,
            elevation: 5,
          }}
        >
          <Text style={styles.fabLabelTop}>{labelTop}</Text>
          <Text style={styles.fabLabelBottom}>{labelBottom}</Text>
        </View>

        <View
          className="w-16 h-16 rounded-[1.5rem] bg-white border border-white items-center justify-center"
          style={{
            borderCurve: 'continuous',
            shadowColor: '#cbd5e1',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.3,
            shadowRadius: 10,
            elevation: 5,
          }}
        >
          <Icon color="#334155" size={28} strokeWidth={2} />
        </View>
      </Pressable>
    </MotiView>
  );
}

// -----------------------------------------------------
// Home Tab (新布局骨架：对齐 MySupplement 风格 + 删除 bell)
// -----------------------------------------------------

const HomeTab = () => {
  const tokens = useScreenTokens(NAV_HEIGHT);
  const contentTopPadding = tokens.contentTopPadding;
  const contentBottomPadding = tokens.contentBottomPadding;
  const frameWidth = tokens.frameWidth ?? tokens.width;
  const contentWidth = Math.max(0, frameWidth - tokens.pageX * 2);
  const twoUpDensity = getTwoUpDensity(contentWidth, STACK_GAP);
  const { savedSupplements } = useSavedSupplements();
  const { checkInsByDate } = useDailyCheckIns();
  const { draft: onboardingDraft, onbCompleted } = useOnboarding();
  const [baseDate, setBaseDate] = useState(() => new Date());
  const [selectedDayId, setSelectedDayId] = useState(() => getLocalDateKey(new Date()));
  const [tipsPayload, setTipsPayload] = useState<NutriTipsData | null>(null);
  const [tipsError, setTipsError] = useState<string | null>(null);
  const [tipsLoading, setTipsLoading] = useState(true);
  const todayId = useMemo(() => getLocalDateKey(baseDate), [baseDate]);
  const todayIdRef = useRef(todayId);
  const hasActivationFollowUp = useMemo(
    () => savedSupplements.some(item => item.syncedToCheckIn),
    [savedSupplements],
  );

  const refreshToday = useCallback(() => {
    const now = new Date();
    const nextTodayId = getLocalDateKey(now);
    const prevTodayId = todayIdRef.current;
    if (nextTodayId === prevTodayId) return;
    todayIdRef.current = nextTodayId;
    setBaseDate(now);
    setSelectedDayId(prev => (prev === prevTodayId ? nextTodayId : prev));
  }, []);
  const trackReturnMilestones = useCallback(() => {
    if (!onbCompleted || !onboardingDraft?.onboardingCompletedAt || !hasActivationFollowUp) return;
    void trackOnboardingReturnMilestones({
      onboardingCompletedAt: onboardingDraft.onboardingCompletedAt,
      source: 'home_tab',
    });
  }, [hasActivationFollowUp, onbCompleted, onboardingDraft?.onboardingCompletedAt]);

  useEffect(() => {
    todayIdRef.current = todayId;
  }, [todayId]);

  useEffect(() => {
    trackReturnMilestones();
  }, [trackReturnMilestones]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refreshToday();
        trackReturnMilestones();
      }
    });
    return () => subscription.remove();
  }, [refreshToday, trackReturnMilestones]);

  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    const timeout = setTimeout(() => {
      refreshToday();
    }, nextMidnight.getTime() - now.getTime() + 500);
    return () => clearTimeout(timeout);
  }, [todayId, refreshToday]);

  useEffect(() => {
    let isMounted = true;

    const loadTips = async () => {
      try {
        setTipsLoading(true);
        const response = await apiClient.nutriTips();
        if (!isMounted) return;
        if (response.success) {
          setTipsPayload(response.data ?? null);
          setTipsError(null);
        } else {
          setTipsPayload(null);
          setTipsError(response.message ?? 'Failed to load NuTri tips.');
        }
      } catch (error) {
        if (!isMounted) return;
        setTipsPayload(null);
        setTipsError(error instanceof Error ? error.message : 'Failed to load NuTri tips.');
      } finally {
        if (isMounted) {
          setTipsLoading(false);
        }
      }
    };

    loadTips();

    return () => {
      isMounted = false;
    };
  }, []);

  const checkInTargets = useMemo(
    () => savedSupplements.filter(item => item.syncedToCheckIn),
    [savedSupplements],
  );

  const resolveExpectedForDate = useCallback(
    (dateKey: string) => {
      const eligibleItems = checkInTargets.filter(item => validateCheckInDateForItem(item, dateKey, todayId).isValid);
      const expectedKeys = eligibleItems.map(item =>
        buildCheckInKey({ supplementId: item.supplementId, localId: item.id }),
      );
      return {
        expectedCount: expectedKeys.length,
        expectedKeySet: new Set(expectedKeys),
      };
    },
    [checkInTargets, todayId],
  );

  const trend = useMemo<TrendData>(() => {
    const series = buildDailyTrendSeries({ baseDate, checkInsByDate, resolveExpectedForDate });
    const { average, best, lowest } = summarizeTrendSeries(series);
    return {
      title: '7-Day Trend',
      series,
      summaryA: average === null ? 'Average: --' : `Average: ${average}%`,
      summaryB: best && lowest
        ? `Lowest: ${lowest.k} ${lowest.v}% · Best: ${best.k} ${best.v}%`
        : 'No data yet',
    };
  }, [baseDate, checkInsByDate, resolveExpectedForDate]);

  const todayStart = useMemo(() => {
    const today = new Date(baseDate);
    today.setHours(0, 0, 0, 0);
    return today.getTime();
  }, [baseDate]);

  useEffect(() => {
    if (isDateKeyAfter(selectedDayId, todayId)) {
      setSelectedDayId(todayId);
    }
  }, [selectedDayId, todayId]);

  const statusForDate = useCallback(
    (date: Date, dateKey: string): DayStatus => {
      if (date.getTime() > todayStart) return 'future';
      const { expectedCount, expectedKeySet } = resolveExpectedForDate(dateKey);
      if (expectedCount === 0) return 'no_schedule';

      const completedSet = new Set(checkInsByDate[dateKey] ?? []);
      let completedCount = 0;
      expectedKeySet.forEach(key => {
        if (completedSet.has(key)) {
          completedCount += 1;
        }
      });

      if (completedCount === 0) return 'missed';
      if (completedCount >= expectedCount) return 'complete';
      return 'partial';
    },
    [checkInsByDate, resolveExpectedForDate, todayStart],
  );

  const weekDays = useMemo(() => buildCalendarDays(baseDate, statusForDate), [baseDate, statusForDate]);
  const tipSelection = useMemo(
    () => (tipsPayload ? selectDailyTip(tipsPayload, baseDate) : null),
    [tipsPayload, baseDate],
  );
  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: contentTopPadding, bottom: contentBottomPadding }}
        contentContainerStyle={[
          styles.homeContent,
          {
            paddingTop: contentTopPadding,
            paddingBottom: contentBottomPadding,
          },
        ]}
      >
        <ContentFrame navHeight={NAV_HEIGHT} style={styles.contentFrame}>
          <View style={styles.screenHeaderRow}>
            <Text style={[styles.h1, { fontSize: tokens.h1Size, lineHeight: tokens.h1Line }]} maxFontSizeMultiplier={1.2}>
              NuTri
            </Text>
          </View>

          <WeekdaySelector
            items={weekDays}
            selectedDayId={selectedDayId}
            todayId={todayId}
            onSelectDay={setSelectedDayId}
            frameWidth={tokens.frameWidth}
            pageX={tokens.pageX}
          />

          <View style={styles.sectionBlock}>
            <SavedSupplements selectedDateKey={selectedDayId} todayDateKey={todayId} pageX={tokens.pageX} />
          </View>

          <View style={styles.sectionBlock}>
            <View style={styles.stack16}>
              <ProgressCard />
              <View style={styles.row16}>
                <NutriTipCard selection={tipSelection} loading={tipsLoading} error={tipsError} density={twoUpDensity} />
                <StreakCard density={twoUpDensity} />
              </View>
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <TrendCard trend={trend} />
          </View>

          <View style={styles.sectionBlock}>
            <RecentlyScanned />
          </View>
        </ContentFrame>
      </ScrollView>
    </View>
  );
};

const ProfileTab = () => {
  return <ProfileScreen navHeight={NAV_HEIGHT} />;
};

// -----------------------------------------------------
// Main Screen
// -----------------------------------------------------

export default function MainScreen() {
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const requestedTab = normalizeRequestedTab(params.tab);
  const [currentTab, setCurrentTab] = useState<TabId>('home');
  const screenTab = useSharedValue<TabId>(currentTab);
  const { savedSupplements, removeSupplements, updateRoutine } = useSavedSupplements();
  const tokens = useScreenTokens(NAV_HEIGHT);
  const insets = useSafeAreaInsets();
  const topFadeHeight = Math.max(52, Math.max(0, insets.top) + TOP_FADE_EXTRA);
  const lastAppliedRouteTabRef = useRef<TabId | null>(null);

  useEffect(() => {
    screenTab.value = currentTab;
  }, [currentTab, screenTab]);

  useEffect(() => {
    if (!requestedTab) return;
    if (lastAppliedRouteTabRef.current === requestedTab) return;
    lastAppliedRouteTabRef.current = requestedTab;
    setCurrentTab(requestedTab);
  }, [requestedTab]);

  const handleDeleteSelected = useCallback(
    async (ids: string[]) => {
      await removeSupplements(ids);
    },
    [removeSupplements],
  );

  const handleSaveRoutine = useCallback(
    async (id: string, prefs: RoutinePreferences) => {
      await updateRoutine(id, prefs);
    },
    [updateRoutine],
  );

  const fadeConfig = { duration: 200, easing: Easing.inOut(Easing.cubic) };

  const homeFadeStyle = useAnimatedStyle(() => ({
    opacity: withTiming(screenTab.value === 'home' ? 1 : 0, fadeConfig),
  }));
  const savedFadeStyle = useAnimatedStyle(() => ({
    opacity: withTiming(screenTab.value === 'saved' ? 1 : 0, fadeConfig),
  }));
  const progressFadeStyle = useAnimatedStyle(() => ({
    opacity: withTiming(screenTab.value === 'progress' ? 1 : 0, fadeConfig),
  }));
  const profileFadeStyle = useAnimatedStyle(() => ({
    opacity: withTiming(screenTab.value === 'profile' ? 1 : 0, fadeConfig),
  }));

  return (
    <SafeAreaView
      edges={['left', 'right']} // ✅ 只处理左右，top 交给各 Tab 自己用 insets.top 统一
      style={{ flex: 1, backgroundColor: SCREEN_BG }}
    >
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
        <View
          pointerEvents="none"
          style={[
            styles.topFade,
            {
              left: -tokens.pageX,
              right: -tokens.pageX,
              height: topFadeHeight,
            },
          ]}
        >
          <MaskedView
            style={StyleSheet.absoluteFill}
            maskElement={
              <LinearGradient
                colors={[
                  'rgba(0,0,0,1)',
                  'rgba(0,0,0,0.7)',
                  'rgba(0,0,0,0.2)',
                  'rgba(0,0,0,0)',
                ]}
                locations={[0, 0.38, 0.72, 1]}
                style={StyleSheet.absoluteFill}
              />
            }
          >
            <BlurView intensity={32} tint="light" style={StyleSheet.absoluteFill} />
          </MaskedView>

          <LinearGradient
            colors={[
              '#F2F3F7',
              'rgba(242,243,247,0.92)',
              'rgba(242,243,247,0.60)',
              'rgba(242,243,247,0.20)',
              'rgba(242,243,247,0.00)',
            ]}
            locations={[0, 0.16, 0.42, 0.78, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        <View style={styles.tabContainer}>
          <Animated.View style={[styles.tabScreen, homeFadeStyle]} pointerEvents={currentTab === 'home' ? 'auto' : 'none'}>
            <HomeTab />
          </Animated.View>

          <Animated.View style={[styles.tabScreen, savedFadeStyle]} pointerEvents={currentTab === 'saved' ? 'auto' : 'none'}>
            <MySupplementView
              data={savedSupplements}
              onDeleteSelected={handleDeleteSelected}
              onSaveRoutine={handleSaveRoutine}
            />
          </Animated.View>

          <Animated.View style={[styles.tabScreen, progressFadeStyle]} pointerEvents={currentTab === 'progress' ? 'auto' : 'none'}>
            <ProgressScreen />
          </Animated.View>

          <Animated.View style={[styles.tabScreen, profileFadeStyle]} pointerEvents={currentTab === 'profile' ? 'auto' : 'none'}>
            <ProfileTab />
          </Animated.View>
        </View>

        <BottomNav currentTab={currentTab} onTabChange={setCurrentTab} pageX={tokens.pageX} />
      </View>
    </SafeAreaView>
  );
}

// -----------------------------------------------------
// Styles
// -----------------------------------------------------

const styles = StyleSheet.create({
  // ---- Screen skeleton ----
  screen: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  homeContent: {
    width: '100%',
  },
  contentFrame: {
    width: '100%',
    alignSelf: 'center',
  },
  screenHeaderRow: {
    marginBottom: 14,
  },
  h1: {
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.2,
    includeFontPadding: false,
  },
  sectionBlock: {
    marginTop: SECTION_GAP,
  },
  stack16: {
    gap: STACK_GAP,
  },
  row16: {
    flexDirection: 'row',
    gap: STACK_GAP,
  },

  // ---- Weekday selector ----
  weekdayWrap: {
    marginTop: 2,
    marginBottom: 2,
  },
  weekHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  weekHeaderText: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: '#64748b',
    includeFontPadding: false,
  },
  calendarBtn: {
    width: 32,
    height: 32,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  daysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 2,
    justifyContent: 'space-between',
    width: '100%',
  },
  weekPager: {
    alignItems: 'center',
  },
  weekPage: {
    justifyContent: 'center',
  },
  dayItemBase: {
    width: DAY_ITEM_WIDTH,
    height: DAY_ITEM_HEIGHT,
    borderRadius: 32,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    overflow: 'hidden',
    position: 'relative',
    flexShrink: 1,
    minWidth: 40,
  },
  dayItemInactive: {
    backgroundColor: 'rgba(255,255,255,0.50)',
    borderWidth: 1,
    borderColor: 'rgba(241,245,249,0.75)',
  },
  dayItemFuture: {
    backgroundColor: 'rgba(148,163,184,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
  },
  dayItemActiveBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0f172a',
    borderRadius: 32,
    borderCurve: 'continuous',
  },
  dayLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    includeFontPadding: false,
    zIndex: 10,
  },
  dayDateWrap: {
    alignItems: 'center',
    zIndex: 10,
  },
  dayDate: {
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '800',
    includeFontPadding: false,
  },
  dayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#60a5fa',
    marginTop: 8,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'transparent',
  },

  // ---- Daily check-in section ----
  checkInWrap: {
    gap: 14,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: '#475569',
    includeFontPadding: false,
  },
  sectionLink: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#94a3b8',
    includeFontPadding: false,
  },
  indicatorTrack: {
    height: 6,
    width: INDICATOR_TRACK_WIDTH,
    backgroundColor: 'rgba(226,232,240,0.80)',
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignSelf: 'center',
    position: 'relative',
    marginTop: 6,
  },
  indicatorThumb: {
    position: 'absolute',
    top: 0,
    height: '100%',
    backgroundColor: 'rgba(100,116,139,0.85)',
    borderRadius: 999,
    borderCurve: 'continuous',
  },

  // ---- Check-in card ----
  cardContainer: {
    width: 160,
    height: 112,
    borderRadius: 32,
    borderCurve: 'continuous',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  borderLayer: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    borderRadius: 32,
    borderCurve: 'continuous',
    zIndex: 1,
    pointerEvents: 'none',
  },
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
    zIndex: 0,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'space-between',
    zIndex: 10,
  },
  checkInCardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  checkboxButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  textRow: {
    marginTop: 'auto',
    gap: 2,
  },
  titleText: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    includeFontPadding: false,
  },
  subtitleText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    opacity: 0.9,
    includeFontPadding: false,
  },
  checkInEmpty: {
    overflow: 'hidden',
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderRadius: 24,
    borderCurve: 'continuous',
    backgroundColor: '#CFE5FF',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 3,
  },
  checkInEmptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  checkInEmptyContent: {
    position: 'relative',
    zIndex: 1,
  },
  checkInEmptyTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    color: '#0f172a',
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  checkInEmptyDescription: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: '#94a3b8',
    includeFontPadding: false,
  },

  // ---- Progress card text ----
  cardMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: 'rgba(239,246,255,0.96)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  progressBig: {
    fontSize: 60,
    lineHeight: 66,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -1.2,
    includeFontPadding: false,
  },
  progressTaken: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    color: 'rgba(219,234,254,0.95)',
    includeFontPadding: false,
  },
  progressRemain: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: 'rgba(147,197,253,0.9)',
    includeFontPadding: false,
  },
  progressDate: {
    marginTop: 10,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    color: 'rgba(191,219,254,0.40)',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    includeFontPadding: false,
  },
  goalLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    includeFontPadding: false,
  },
  goalValue: {
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
  },
  goalSub: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    includeFontPadding: false,
  },

  smallCardTitleDark: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: 0.8,
    includeFontPadding: false,
    textTransform: 'uppercase',
  },
  trendCard: {
    backgroundColor: '#A8C9FF',
    borderRadius: 32,
    borderCurve: 'continuous',
  },
  trendContent: {
    padding: 24,
  },
  trendHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  trendTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
  },
  trendIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  trendBarsRow: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  trendBarColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  trendBarPressable: {
    width: '100%',
    alignItems: 'center',
    gap: 8,
  },
  trendBarTrack: {
    width: 32,
    height: TREND_BAR_HEIGHT,
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.22)',
  },
  trendBarFill: {
    width: '100%',
    borderRadius: 999,
    borderCurve: 'continuous',
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    elevation: 2,
  },
  trendBarFillActive: {
    backgroundColor: '#1e293b',
  },
  trendBarFillInactive: {
    backgroundColor: 'rgba(15,23,42,0.55)',
  },
  trendBarFillEmpty: {
    backgroundColor: 'rgba(15,23,42,0.2)',
  },
  trendBarFillZero: {
    backgroundColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  trendBarLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    color: 'rgba(15,23,42,0.75)',
    includeFontPadding: false,
    textAlign: 'center',
    width: '100%',
  },
  trendBarLabelActive: {
    color: '#0f172a',
  },
  trendBarValue: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    color: 'rgba(71,85,105,0.9)',
    includeFontPadding: false,
    textAlign: 'center',
    width: '100%',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  trendBarValueActive: {
    color: '#0f172a',
  },
  trendSummary: {
    marginTop: 20,
    gap: 4,
  },
  trendSummaryPrimary: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
  },
  trendSummarySecondary: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: 'rgba(15,23,42,0.8)',
    includeFontPadding: false,
  },
  tipHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  tipHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    transform: [{ translateX: -6 }],
  },
  tipLogoBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#cdb6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipHeaderTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: 0.4,
    includeFontPadding: false,
  },
  tipBody: {
    flex: 1,
    justifyContent: 'flex-end',
    marginTop: 0,
    paddingBottom: 14,
    gap: 10,
  },
  tipSupplementCard: {
    alignSelf: 'stretch',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.8)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tipSupplementName: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
    textAlign: 'center',
  },
  tipHint: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#64748b',
    includeFontPadding: false,
  },
  tipModalOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipModalDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.12)',
  },
  tipModalSafe: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  thoughtBubbleShell: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  thoughtBubble: {
    backgroundColor: '#ffffff',
    borderRadius: 28,
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.7)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 6,
  },
  thoughtBubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  thoughtBubbleTitle: {
    flex: 1,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    color: '#0f172a',
    includeFontPadding: false,
  },
  thoughtBubbleSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 12,
    includeFontPadding: false,
  },
  thoughtBubbleText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: '#334155',
    includeFontPadding: false,
  },
  thoughtBubbleTextBold: {
    fontWeight: '800',
  },
  thoughtBubbleScroll: {
    paddingBottom: 4,
  },
  thoughtBubbleClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
  },
  thoughtBubbleTailLarge: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffffff',
    bottom: -18,
    left: 48,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.7)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  thoughtBubbleTailSmall: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    bottom: -32,
    left: 24,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.7)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  streakValue: {
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.8,
    includeFontPadding: false,
  },
  streakUnit: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    color: '#475569',
    includeFontPadding: false,
  },
  streakGoal: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: 'rgba(51,65,85,0.80)',
    includeFontPadding: false,
  },

  // ---- Recently scanned ----
  recentTitle: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
  },
  recentSubtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#475569',
    includeFontPadding: false,
  },
  recentViewAllPill: {
    minHeight: 34,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.40)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentViewAllText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: '#0f172a',
    includeFontPadding: false,
  },
  recentEmpty: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: '#0f172a',
    includeFontPadding: false,
  },
  recentIconOuter: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentIconInner: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.40)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentItemTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    color: '#0f172a',
    includeFontPadding: false,
  },
  recentItemMeta: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: '#475569',
    includeFontPadding: false,
  },
  recentActionPressable: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentActionBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderCurve: 'continuous',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  recentActionIconWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentActionIcon: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentSheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  recentSheetDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.14)',
  },
  recentSheetSafe: {
    width: '100%',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  recentSheet: {
    width: '100%',
    borderRadius: 32,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.82)',
    paddingHorizontal: 18,
    paddingTop: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 8,
  },
  recentSheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(148,163,184,0.45)',
    marginBottom: 12,
  },
  recentSheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  recentSheetTitle: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
  },
  recentSheetClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148,163,184,0.14)',
  },
  recentSheetContent: {
    gap: 8,
    paddingBottom: 6,
  },
  recentSheetEmpty: {
    borderRadius: 22,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(248,250,252,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.82)',
    paddingHorizontal: 16,
    paddingVertical: 18,
  },

  // ---- Tabs container ----
  tabContainer: {
    flex: 1,
    position: 'relative',
  },
  tabScreen: {
    ...StyleSheet.absoluteFillObject,
  },

  // ---- Bottom nav ----
  bottomBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  outerWrapper: {
    marginRight: NAV_PILL_GAP,
  },
  navPill: {
    height: 64,
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    justifyContent: 'center',
  },
  navShadowWrap: {
    borderRadius: 999,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.001)',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 18 },
    elevation: 10,
  },
  navPillGlassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  navPillHighlight: {
    ...StyleSheet.absoluteFillObject,
  },
  bottomFade: {
    position: 'absolute',
  },
  topFade: {
    position: 'absolute',
    top: 0,
    zIndex: 40,
  },
  plusWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusWrapOpen: {
    backgroundColor: '#0f172a',
  },
  plusWrapClosed: {
    backgroundColor: 'transparent',
  },
  plusGlassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(96,165,250,0.32)',
  },
  plusButton: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
    justifyContent: 'flex-start',
    position: 'relative',
  },
  tabItem: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    height: 44,
    zIndex: 2,
  },
  tabItemText: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 22,
    borderCurve: 'continuous',
  },
  tabItemIcon: {
    width: 44,
    borderRadius: 22,
    borderCurve: 'continuous',
  },
  contentLayer: {
    zIndex: 10,
    pointerEvents: 'none',
  },
  label: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
    includeFontPadding: false,
  },
  pillContainer: {
    position: 'absolute',
    top: 8,
    left: 0,
    height: 44,
    overflow: 'hidden',
    zIndex: 1,
    pointerEvents: 'box-only',
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  pillBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    pointerEvents: 'none',
  },

  // FAB label
  fabLabelTop: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.6,
    color: '#0f172a',
    includeFontPadding: false,
  },
  fabLabelBottom: {
    fontSize: 14,
    fontWeight: '800',
    color: '#475569',
    includeFontPadding: false,
  },
});
