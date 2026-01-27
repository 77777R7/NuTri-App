import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { ContentFrame } from '@/components/common/ContentFrame';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { useDailyCheckIns } from '@/contexts/DailyCheckInContext';
import { useProgressRange, type ProgressRange } from '@/contexts/ProgressRangeContext';
import { useSavedSupplements } from '@/contexts/SavedSupplementsContext';
import { useScreenTokens } from '@/hooks/useScreenTokens';
import { buildCheckInKey } from '@/lib/check-ins';
import {
  Activity,
  CheckCircle2,
  Clock,
  Flame,
  Medal,
  TrendingUp,
  Trophy,
  X,
} from 'lucide-react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_MAX_HEIGHT = Math.round(SCREEN_HEIGHT * 0.85);

const SCREEN_BG = '#F2F3F7';
const PAGE_X = 24;
const NAV_HEIGHT = 64;
const MINI_METRIC_GAP = 16;
const MAIN_CARD_GAP = 20;
const TREND_BAR_HEIGHT = 128;
const TREND_BAR_MIN_HEIGHT = 8;
const TREND_DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const getWeekStartMonday = (baseDate: Date) => {
  const start = new Date(baseDate);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const offset = (day + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start;
};

type Density = 'compact' | 'regular';

const getTwoUpDensity = (contentWidth: number, gap: number): Density => {
  const cardWidth = (contentWidth - gap) / 2;
  return cardWidth < 175 ? 'compact' : 'regular';
};

type RangeKey = ProgressRange;
type SheetKey = 'today' | 'adherence' | 'reminders' | 'trend' | 'achievements' | null;

type TodayItem = {
  id: string;
  name: string;
  time: string;
  done: boolean;
  checkInKey: string;
  supplementId?: string | null;
};

type PlanItem = {
  id: string;
  name: string;
  timeLabel: string;
  timeRaw?: string | null;
  timeMinutes: number | null;
  done: boolean;
  withFood: boolean;
  checkInKey: string;
  supplementId?: string | null;
};

type TrendSeriesEntry = {
  k: string;
  v: number | null;
  completed: number;
  total: number;
  dateKey: string;
};

const calcPercent = (taken: number, total: number) => {
  if (total <= 0) return 0;
  return Math.round((taken / total) * 100);
};

const getLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseTimeMinutes = (time?: string | null) => {
  if (!time) return null;
  const [hoursStr, minutesStr] = time.split(':');
  const hours = Number.parseInt(hoursStr, 10);
  const minutes = Number.parseInt(minutesStr ?? '0', 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
};

const formatTimeFromMinutes = (minutes: number) => {
  const total = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours24 = Math.floor(total / 60);
  const mins = total % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  let hours12 = hours24 % 12;
  if (hours12 === 0) hours12 = 12;
  return `${hours12}:${mins.toString().padStart(2, '0')} ${period}`;
};

const formatTimeLabel = (time?: string | null) => {
  const minutes = parseTimeMinutes(time);
  if (minutes === null) return 'Anytime';
  return formatTimeFromMinutes(minutes);
};

const addMinutesToTimeLabel = (time?: string | null, offsetMinutes = 15) => {
  const minutes = parseTimeMinutes(time);
  if (minutes === null) return null;
  return formatTimeFromMinutes(minutes + offsetMinutes);
};

const formatPlanTitle = (name: string, timeLabel: string) => {
  const cleanName = name.replace(/[\s·•.]+$/g, '');
  return `${cleanName} · ${timeLabel}`;
};

const getTimeCategoryLabel = (time?: string | null) => {
  const minutes = parseTimeMinutes(time);
  if (minutes === null) return null;
  if (minutes >= 300 && minutes < 720) return 'Morning';
  if (minutes >= 720 && minutes < 1020) return 'Midday';
  if (minutes >= 1020 && minutes < 1260) return 'Evening';
  return 'Bedtime';
};

const getScheduleLabel = (time?: string | null) => getTimeCategoryLabel(time) ?? formatTimeLabel(time);

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

type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

const Card = ({ children, style }: CardProps) => {
  return (
    <View style={[styles.cardBase, style]}>
      <View pointerEvents="none" style={styles.cardInsetHighlight} />
      {children}
    </View>
  );
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type ScalePressableProps = {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  scaleTo?: number;
  accessibilityLabel?: string;
};

const ScalePressable = ({
  children,
  onPress,
  style,
  disabled,
  scaleTo = 0.95,
  accessibilityLabel,
}: ScalePressableProps) => {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (toValue: number) => {
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 30,
      bounciness: 0,
    }).start();
  };

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        if (!disabled) animateTo(scaleTo);
      }}
      onPressOut={() => {
        if (!disabled) animateTo(1);
      }}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
};

type IconButtonProps = {
  label: string;
  onPress?: () => void;
  icon: ReactNode;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
};

const IconButton = ({ label, onPress, icon, size = 'md', style }: IconButtonProps) => {
  const dimension = size === 'sm' ? 36 : 40;
  return (
    <ScalePressable
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.iconButtonBase,
        { width: dimension, height: dimension, borderRadius: dimension / 2 },
        style,
      ]}
      scaleTo={0.95}
    >
      {icon}
    </ScalePressable>
  );
};

type SegmentedControlProps = {
  value: RangeKey;
  onChange: (value: RangeKey) => void;
};

const SegmentedControl = ({ value, onChange }: SegmentedControlProps) => {
  const options: { key: RangeKey; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
  ];

  return (
    <View style={styles.segmentedContainer}>
      {options.map(option => {
        const active = option.key === value;
        return (
          <ScalePressable
            key={option.key}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.key)}
            style={[
              styles.segmentedOption,
              active ? styles.segmentedOptionActive : styles.segmentedOptionInactive,
            ]}
            scaleTo={0.97}
          >
            <Text style={[styles.segmentedText, active ? styles.segmentedTextActive : styles.segmentedTextInactive]}>
              {option.label}
            </Text>
          </ScalePressable>
        );
      })}
    </View>
  );
};

const AnimatedProgressBar = ({ value }: { value: number }) => {
  const pct = Math.max(0, Math.min(100, value));
  const widthAnim = useRef(new Animated.Value(0)).current;
  const trackWidthRef = useRef(0);

  const onTrackLayout = (e: any) => {
    trackWidthRef.current = e.nativeEvent.layout.width;
    widthAnim.setValue((pct / 100) * trackWidthRef.current);
  };

  useEffect(() => {
    const w = trackWidthRef.current;
    if (w <= 0) return;
    Animated.timing(widthAnim, {
      toValue: (pct / 100) * w,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [pct, widthAnim]);

  return (
    <View style={styles.progressTrack} onLayout={onTrackLayout}>
      <Animated.View style={[styles.progressFill, { width: widthAnim }]} />
    </View>
  );
};

type MiniMetricCardProps = {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  onPress?: () => void;
  density?: Density;
};

const MiniMetricCard = ({ icon, label, value, sub, onPress, density = 'regular' }: MiniMetricCardProps) => {
  const isCompact = density === 'compact';

  return (
    <Card style={[styles.miniMetricCard, isCompact ? styles.miniMetricCardCompact : styles.miniMetricCardSquare]}>
      <ScalePressable accessibilityLabel={label} onPress={onPress} style={styles.fill} scaleTo={0.95}>
        <View style={[styles.miniMetricPressable, isCompact && styles.miniMetricPressableCompact]}>
          <LinearGradient
            colors={['rgba(255,255,255,0.9)', 'rgba(255,255,255,0.55)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.miniMetricIcon, isCompact && styles.miniMetricIconCompact]}
          >
            {icon}
          </LinearGradient>

          <View style={styles.miniMetricTextWrap}>
            <Text
              style={[styles.miniMetricLabel, isCompact && styles.miniMetricLabelCompact]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {label}
            </Text>
            <Text style={[styles.miniMetricValue, isCompact && styles.miniMetricValueCompact]} numberOfLines={1}>
              {value}
            </Text>
            {sub ? (
              <Text
                style={[styles.miniMetricSub, isCompact && styles.miniMetricSubCompact]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {sub}
              </Text>
            ) : null}
          </View>
        </View>
      </ScalePressable>
    </Card>
  );
};

type SheetProps = {
  open: boolean;
  title: string | null;
  onClose: () => void;
  children?: ReactNode;
  pageX?: number;
};

const Sheet = ({ open, title, onClose, children, pageX = PAGE_X }: SheetProps) => {
  const [visible, setVisible] = useState(open);

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslate = useRef(new Animated.Value(48)).current;

  useEffect(() => {
    if (open) {
      setVisible(true);
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(sheetTranslate, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    if (!open && visible) {
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(sheetTranslate, {
          toValue: 48,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setVisible(false);
      });
    }
  }, [open, overlayOpacity, sheetTranslate, visible]);

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose}>
        <Animated.View style={[styles.sheetBackdrop, { opacity: overlayOpacity }]}>
          <BlurView intensity={18} tint="light" style={StyleSheet.absoluteFillObject} />
        </Animated.View>

        <Pressable onPress={event => event.stopPropagation()} style={styles.sheetHitbox}>
          <Animated.View style={[styles.sheetContainer, { transform: [{ translateY: sheetTranslate }] }]}>
            <View style={[styles.sheetHeader, { paddingHorizontal: pageX }]}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <ScalePressable accessibilityLabel="Close" onPress={onClose} style={styles.sheetCloseButton} scaleTo={0.95}>
                <X size={18} color="#0f172a" />
              </ScalePressable>
            </View>

            <ScrollView contentContainerStyle={[styles.sheetContent, { paddingHorizontal: pageX }]} showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

type PillProps = {
  left?: ReactNode;
  text: string;
  right?: ReactNode;
  onPress?: () => void;
  tone?: 'light' | 'dark';
  compact?: boolean;
  dense?: boolean;
};

const Pill = ({
  left,
  text,
  right,
  onPress,
  tone = 'light',
  compact = false,
  dense = false,
}: PillProps) => {
  const padStyle = dense ? styles.pillDense : compact ? styles.pillCompact : styles.pillDefault;
  const iconStyle = dense ? styles.pillIconDense : compact ? styles.pillIconCompact : styles.pillIconDefault;
  const textStyle = dense ? styles.pillTextDense : compact ? styles.pillTextCompact : styles.pillTextDefault;
  const isDark = tone === 'dark';

  return (
    <ScalePressable
      accessibilityLabel={text}
      onPress={onPress}
      style={[styles.pillBase, padStyle, isDark ? styles.pillDark : styles.pillLight]}
      scaleTo={0.95}
    >
      <View style={styles.pillRow}>
        {left ? <View style={[iconStyle, isDark ? styles.pillIconDark : styles.pillIconLight]}>{left}</View> : null}
        <View style={styles.pillTextWrap}>
          <Text style={[textStyle, isDark ? styles.pillTextDark : styles.pillTextLight]} numberOfLines={1}>
            {text}
          </Text>
        </View>
        {right ? <View style={styles.pillRight}>{right}</View> : null}
      </View>
    </ScalePressable>
  );
};

export default function ProgressScreen() {
  const tokens = useScreenTokens(NAV_HEIGHT);
  const contentTopPadding = tokens.contentTopPadding;
  const contentBottomPadding = tokens.contentBottomPadding;
  const frameWidth = tokens.frameWidth ?? tokens.width;
  const contentWidth = Math.max(0, frameWidth - tokens.pageX * 2);
  const twoUpDensity = getTwoUpDensity(contentWidth, MINI_METRIC_GAP);
  const planCardHeight = Math.max(180, Math.round((contentWidth - 16) / 2));

  const { range, setRange } = useProgressRange();
  const [sheet, setSheet] = useState<SheetKey>(null);
  const [backupReminders, setBackupReminders] = useState<string[]>([]);
  const [selectedTrendIndex, setSelectedTrendIndex] = useState<number | null>(null);

  const { savedSupplements } = useSavedSupplements();
  const { checkInsByDate, toggleCheckIn, addCheckIns } = useDailyCheckIns();
  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);

  const expectedKeys = useMemo(
    () =>
      savedSupplements
        .filter(item => item.syncedToCheckIn)
        .map(item => buildCheckInKey({ supplementId: item.supplementId, localId: item.id })),
    [savedSupplements],
  );
  const expectedKeySet = useMemo(() => new Set(expectedKeys), [expectedKeys]);
  const expectedCount = expectedKeys.length;

  const todayItems = useMemo(() => {
    const checked = new Set(checkInsByDate[todayKey] ?? []);
    return savedSupplements
      .filter(item => item.syncedToCheckIn)
      .sort((a, b) => {
        const timeA = parseTimeMinutes(a.routine?.time);
        const timeB = parseTimeMinutes(b.routine?.time);
        if (timeA !== null && timeB !== null && timeA !== timeB) {
          return timeA - timeB;
        }
        if (timeA !== null && timeB === null) return -1;
        if (timeA === null && timeB !== null) return 1;
        return b.createdAt.localeCompare(a.createdAt);
      })
      .map(item => {
        const checkInKey = buildCheckInKey({ supplementId: item.supplementId, localId: item.id });
        return {
          id: item.id,
          name: item.productName,
          time: getScheduleLabel(item.routine?.time),
          done: checked.has(checkInKey),
          checkInKey,
          supplementId: item.supplementId ?? null,
        };
      });
  }, [checkInsByDate, savedSupplements, todayKey]);

  const planItems = useMemo<PlanItem[]>(() => {
    const checked = new Set(checkInsByDate[todayKey] ?? []);
    return savedSupplements
      .filter(item => item.syncedToCheckIn)
      .sort((a, b) => {
        const timeA = parseTimeMinutes(a.routine?.time);
        const timeB = parseTimeMinutes(b.routine?.time);
        if (timeA !== null && timeB !== null && timeA !== timeB) {
          return timeA - timeB;
        }
        if (timeA !== null && timeB === null) return -1;
        if (timeA === null && timeB !== null) return 1;
        return b.createdAt.localeCompare(a.createdAt);
      })
      .map(item => {
        const checkInKey = buildCheckInKey({ supplementId: item.supplementId, localId: item.id });
        const timeRaw = item.routine?.time ?? null;
        const timeMinutes = parseTimeMinutes(timeRaw);
        return {
          id: item.id,
          name: item.productName,
          timeLabel: formatTimeLabel(timeRaw),
          timeRaw,
          timeMinutes,
          done: checked.has(checkInKey),
          withFood: Boolean(item.routine?.withFood),
          checkInKey,
          supplementId: item.supplementId ?? null,
        };
      });
  }, [checkInsByDate, savedSupplements, todayKey]);

  const planNextId = useMemo(() => planItems.find(item => !item.done)?.id ?? null, [planItems]);
  const planCardItems = useMemo(() => {
    if (planItems.length <= 2) return planItems;
    const nextItem = planNextId ? planItems.find(item => item.id === planNextId) : null;
    if (!nextItem) return planItems.slice(0, 2);
    const rest = planItems.filter(item => item.id !== nextItem.id);
    return [nextItem, ...rest].slice(0, 2);
  }, [planItems, planNextId]);

  const [backupCandidateId, setBackupCandidateId] = useState<string | null>(null);
  const backupCandidateItem = useMemo(
    () => (backupCandidateId ? planItems.find(item => item.id === backupCandidateId) : null),
    [backupCandidateId, planItems],
  );
  const backupReminderSet = useMemo(() => new Set(backupReminders), [backupReminders]);
  const backupCandidateActive = Boolean(backupCandidateId && backupReminderSet.has(backupCandidateId));

  useEffect(() => {
    if (!planItems.length) {
      setBackupCandidateId(null);
      return;
    }
    if (!backupCandidateId || !planItems.some(item => item.id === backupCandidateId)) {
      setBackupCandidateId(planNextId ?? planItems[0]?.id ?? null);
    }
  }, [backupCandidateId, planItems, planNextId]);

  useEffect(() => {
    if (!backupReminders.length) return;
    setBackupReminders(prev => {
      const filtered = prev.filter(id => planItems.some(item => item.id === id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [backupReminders.length, planItems]);

  const takenCount = todayItems.filter(item => item.done).length;
  const totalCount = todayItems.length;
  const percent = calcPercent(takenCount, totalCount);
  const remaining = todayItems.filter(item => !item.done);

  const countCompletedForDate = useCallback(
    (dateKey: string) => {
      if (expectedCount === 0) return 0;
      const completedSet = new Set(checkInsByDate[dateKey] ?? []);
      let completedCount = 0;
      expectedKeySet.forEach(key => {
        if (completedSet.has(key)) completedCount += 1;
      });
      return completedCount;
    },
    [checkInsByDate, expectedCount, expectedKeySet],
  );

  const toggleDone = useCallback(
    (item: TodayItem) => {
      void toggleCheckIn(todayKey, item.checkInKey, item.supplementId);
    },
    [todayKey, toggleCheckIn],
  );

  const markAllRemaining = useCallback(() => {
    if (!remaining.length) return;
    void addCheckIns(
      todayKey,
      remaining.map(item => ({ key: item.checkInKey, supplementId: item.supplementId })),
    );
  }, [addCheckIns, remaining, todayKey]);

  const badgeUnlocked = 2;
  const nextBadgeDaysLeft = 1;

  const adherence = useMemo(() => {
    if (range === 'today') {
      return {
        label: 'Streak',
        items: todayItems.slice(0, 2).map(item => ({
          name: item.name,
          val: item.done ? 100 : 0,
        })),
      };
    }
    if (range === '30d') {
      return {
        label: 'Streak',
        items: [
          { name: 'Vit D', val: 88 },
          { name: 'Mag', val: 54 },
        ],
      };
    }
    return {
      label: 'Streak',
      items: [
        { name: 'Vit D', val: 92 },
        { name: 'Mag', val: 61 },
      ],
    };
  }, [range, todayItems]);

  const trendSeries7d = useMemo<TrendSeriesEntry[]>(() => {
    const startDate = getWeekStartMonday(new Date());

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);
      const dateKey = getLocalDateKey(date);
      const completed = countCompletedForDate(dateKey);
      const total = expectedCount;
      const value = total > 0 ? calcPercent(completed, total) : null;
      return {
        k: TREND_DAY_LABELS[date.getDay()],
        v: value,
        completed,
        total,
        dateKey,
      };
    });
  }, [countCompletedForDate, expectedCount]);

  const trendSeries30d = useMemo<TrendSeriesEntry[]>(() => {
    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 28 }, (_, index) => {
      const date = new Date(endDate);
      date.setDate(endDate.getDate() - (27 - index));
      const dateKey = getLocalDateKey(date);
      const completed = countCompletedForDate(dateKey);
      const total = expectedCount;
      const value = total > 0 ? calcPercent(completed, total) : null;
      return { k: TREND_DAY_LABELS[date.getDay()], v: value, completed, total, dateKey };
    });

    return Array.from({ length: 4 }, (_, weekIndex) => {
      const slice = days.slice(weekIndex * 7, weekIndex * 7 + 7);
      const completed = slice.reduce((total, entry) => total + entry.completed, 0);
      const total = slice.reduce((sum, entry) => sum + entry.total, 0);
      const value = total > 0 ? calcPercent(completed, total) : null;
      return {
        k: `W${weekIndex + 1}`,
        v: value,
        completed,
        total,
        dateKey: slice[0]?.dateKey ?? `w${weekIndex + 1}`,
      };
    });
  }, [countCompletedForDate, expectedCount]);

  const trend = useMemo(() => {
    if (range === 'today') {
      const series = todayItems.slice(0, 4).map(item => ({
        k: item.time,
        v: item.done ? 100 : 0,
        completed: item.done ? 1 : 0,
        total: 1,
        dateKey: item.id,
      }));
      return {
        title: 'Today Timeline',
        series,
        summaryA: `Taken: ${takenCount}/${totalCount}`,
        summaryB: remaining.length ? `Remaining: ${remaining[0].name}` : 'All done today',
      };
    }

    if (range === '30d') {
      const { average, best, lowest } = summarizeTrendSeries(trendSeries30d);
      return {
        title: '30-Day Trend',
        series: trendSeries30d,
        summaryA: average === null ? 'Average: --' : `Average: ${average}%`,
        summaryB: best && lowest
          ? `Lowest: ${lowest.k} ${lowest.v}% · Best: ${best.k} ${best.v}%`
          : 'No data yet',
      };
    }

    const { average, best, lowest } = summarizeTrendSeries(trendSeries7d);
    return {
      title: '7-Day Trend',
      series: trendSeries7d,
      summaryA: average === null ? 'Average: --' : `Average: ${average}%`,
      summaryB: best && lowest
        ? `Lowest: ${lowest.k} ${lowest.v}% · Best: ${best.k} ${best.v}%`
        : 'No data yet',
    };
  }, [range, remaining, takenCount, todayItems, totalCount, trendSeries30d, trendSeries7d]);

  useEffect(() => {
    setSelectedTrendIndex(null);
  }, [range, trend.series.length]);

  const activeTrendIndex = selectedTrendIndex;
  const selectedTrendEntry = selectedTrendIndex !== null ? trend.series[selectedTrendIndex] : null;
  const trendDetailLine = selectedTrendEntry
    ? selectedTrendEntry.v === null
      ? `Selected: ${selectedTrendEntry.k} --`
      : `Selected: ${selectedTrendEntry.k} ${selectedTrendEntry.v}% (${selectedTrendEntry.completed}/${selectedTrendEntry.total})`
    : trend.summaryB;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: contentTopPadding, bottom: contentBottomPadding }}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: contentTopPadding,
            paddingBottom: contentBottomPadding,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ContentFrame navHeight={NAV_HEIGHT} style={styles.contentFrame}>
          {/* Header */}
          <View style={[styles.headerRow, { marginBottom: MAIN_CARD_GAP }]}>
            <Text style={[styles.headerTitle, { fontSize: tokens.h1Size, lineHeight: tokens.h1Line }]} maxFontSizeMultiplier={1.2}>
              Progress
            </Text>
          </View>

          {/* Top mini metrics */}
          <View style={styles.row}>
            <MiniMetricCard
              icon={<Medal size={22} color="#b45309" />}
              label="Badges unlocked"
              value={String(badgeUnlocked)}
              sub="Streak + Perfect Day"
              onPress={() => setSheet('achievements')}
              density={twoUpDensity}
            />
            <MiniMetricCard
              icon={<Trophy size={22} color="#334155" />}
              label="Next badge"
              value={`${nextBadgeDaysLeft} day`}
              sub="to 7-day streak"
              onPress={() => setSheet('achievements')}
              density={twoUpDensity}
            />
          </View>

          {/* Today card */}
          <View style={[styles.sectionSpacing, { marginTop: MAIN_CARD_GAP }]}>
            <Card style={styles.todayCard}>
              <View style={styles.todayContent}>
                <View style={styles.todayHeaderRow}>
                  <View>
                    <Text style={styles.todayTitle}>Today's Progress</Text>
                    <Text style={styles.todaySubtitle}>Current Status</Text>
                  </View>
                  <IconButton
                    label="Today details"
                    onPress={() => setSheet('today')}
                    icon={<TrendingUp size={18} color="#ffffff" />}
                    style={styles.todayIconButton}
                  />
                </View>

                <View style={styles.todayStatsRow}>
                  <Text style={styles.todayPercent}>{percent}%</Text>
                  <View style={styles.todayCountWrap}>
                    <Text style={styles.todayCount}>{takenCount}/{totalCount}</Text>
                    <Text style={styles.todayCountLabel}>Taken</Text>
                  </View>
                </View>

                <View style={styles.todayProgressWrap}>
                  <AnimatedProgressBar value={percent} />
                </View>

                <View style={styles.todayMessageRow}>
                  <View style={styles.todayDot} />
                  <Text style={styles.todayMessage}>
                    {remaining.length ? `Just ${remaining.length} more to hit your daily goal!` : 'You hit your daily goal.'}
                  </Text>
                </View>

              {remaining.length ? (
                <View style={styles.todayRemainingWrap}>
                  <Text style={styles.todayRemainingLabel}>Remaining</Text>
                  <View style={styles.remainingList}>
                    {remaining.slice(0, 2).map(item => (
                      <Pill
                        key={item.id}
                        tone="dark"
                        compact
                        left={<Clock size={16} color="#ffffff" />}
                        text={`${item.name} · ${item.time}`}
                        right={<Text style={styles.remainingMark}>Mark</Text>}
                        onPress={() => toggleDone(item)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.todayActionWrap}>
                <ScalePressable
                  accessibilityLabel="Log remaining"
                  onPress={markAllRemaining}
                  disabled={!remaining.length}
                  style={[styles.todayActionButton, remaining.length ? styles.todayActionEnabled : styles.todayActionDisabled]}
                  scaleTo={0.95}
                >
                  <Text style={[styles.todayActionText, remaining.length ? styles.todayActionTextEnabled : styles.todayActionTextDisabled]}>
                    Log remaining
                  </Text>
                </ScalePressable>
              </View>
            </View>
          </Card>
        </View>

        {/* Streak + Plan */}
        <View style={[styles.sectionSpacing, { marginTop: MAIN_CARD_GAP }]}>
          <Card style={[styles.planWideCard, styles.remindersCard, { height: planCardHeight }]}>
            <ScalePressable accessibilityLabel="Plan" onPress={() => setSheet('reminders')} style={styles.fill} scaleTo={0.95}>
              <View style={[styles.squarePressable, styles.planPressable]}>
                <View style={styles.squareHeaderRow}>
                  <Text style={styles.squareTitle} numberOfLines={1} ellipsizeMode="tail">Plan</Text>
                  <View style={[styles.squareIconWrap, styles.planIconWrap]}>
                    <Clock size={16} color="#0f172a" />
                  </View>
                </View>

                <View style={styles.squareBody}>
                  {planCardItems.map(item => {
                    const status = item.done
                      ? 'Done'
                      : planNextId && item.id === planNextId
                        ? 'Next'
                        : 'Remaining';
                    const backupTag = backupReminderSet.has(item.id) ? ' (Backup)' : '';
                    const foodTag = item.withFood ? ' · With food' : '';
                    return (
                      <Pill
                        key={item.id}
                        dense
                        left={
                          item.done ? (
                            <CheckCircle2 size={14} color="#0f172a" />
                          ) : (
                            <Clock size={14} color="#0f172a" />
                          )
                        }
                        text={`${formatPlanTitle(item.name, item.timeLabel)}${backupTag}${foodTag}`}
                        right={<Text style={styles.reminderTag}>{status}</Text>}
                        onPress={() => setSheet('reminders')}
                      />
                    );
                  })}
                </View>

                <Text style={styles.squareFooter}>Tap card to edit.</Text>
              </View>
            </ScalePressable>
          </Card>
        </View>

        {/* Trend */}
        <View style={[styles.sectionSpacing, { marginTop: MAIN_CARD_GAP }]}>
          <Card style={styles.trendCard}>
            <View style={styles.trendContent}>
              <View style={styles.trendHeaderRow}>
                <Text style={styles.trendTitle}>{trend.title}</Text>
                <IconButton
                  label="Trend details"
                  onPress={() => setSheet('trend')}
                  icon={<Activity size={20} color="#0f172a" />}
                  style={styles.iconButtonLight}
                />
              </View>

              <View style={styles.trendBarsRow}>
                {trend.series.map((entry, idx) => {
                  const isActive = activeTrendIndex !== null && idx === activeTrendIndex;
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
                        onPress={() => setSelectedTrendIndex(prev => (prev === idx ? null : idx))}
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
                                    : Math.max(
                                        TREND_BAR_MIN_HEIGHT,
                                        (entry.v / 100) * TREND_BAR_HEIGHT,
                                      ),
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
                        <Text
                          style={[styles.trendBarValue, isActive && styles.trendBarValueActive]}
                          numberOfLines={1}
                          ellipsizeMode="clip"
                        >
                          {entry.v === null ? '--' : `${entry.v}%`}
                        </Text>
                      </Pressable>
                    </MotiView>
                  );
                })}
              </View>

              <View style={styles.trendSummary}>
                <Text style={styles.trendSummaryPrimary}>{trend.summaryA}</Text>
                <Text style={styles.trendSummarySecondary}>{trendDetailLine}</Text>
              </View>

              <View style={styles.trendSegmentWrap}>
                <SegmentedControl value={range} onChange={setRange} />
              </View>
            </View>
          </Card>
        </View>

        {/* Achievements */}
        <View style={[styles.sectionSpacing, { marginTop: MAIN_CARD_GAP }]}>
          <Card style={styles.achievementsCard}>
            <View style={styles.achievementsContent}>
              <View style={styles.achievementsHeaderRow}>
                <Text style={styles.achievementsTitle}>Achievements</Text>
                <View style={styles.achievementsActions}>
                  <ScalePressable accessibilityLabel="View all achievements" onPress={() => setSheet('achievements')} style={styles.viewAllButton} scaleTo={0.97}>
                    <Text style={styles.achievementsLink}>View all</Text>
                  </ScalePressable>
                  <IconButton
                    label="Achievements details"
                    onPress={() => setSheet('achievements')}
                    icon={<Trophy size={20} color="#0f172a" />}
                    style={styles.iconButtonLight}
                  />
                </View>
              </View>

              <View style={styles.achievementsRow}>
                {[
                  { label: 'FIRST', icon: CheckCircle2, unlocked: true, tint: '#CFF6E3' },
                  { label: '3 DAY', icon: Flame, unlocked: true, tint: '#FFE9C7' },
                  { label: '7 DAY', icon: Flame, unlocked: false, tint: 'rgba(15,23,42,0.04)' },
                  { label: 'CHAMP', icon: Trophy, unlocked: false, tint: 'rgba(15,23,42,0.04)' },
                ].map(badge => {
                  const Icon = badge.icon;
                  return (
                    <View key={badge.label} style={[styles.achievementItem, !badge.unlocked && styles.achievementLocked]}>
                      <View style={[styles.achievementIcon, { backgroundColor: badge.tint }]}>
                        <Icon size={20} color="#0f172a" />
                      </View>
                      <Text style={styles.achievementLabel}>{badge.label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </Card>
        </View>
        </ContentFrame>
      </ScrollView>

      <Sheet
        open={sheet !== null}
        title={
          sheet === 'today'
            ? 'Today details'
            : sheet === 'adherence'
            ? 'Streak'
            : sheet === 'reminders'
            ? 'Plan'
            : sheet === 'trend'
            ? 'Trend'
            : sheet === 'achievements'
            ? 'Achievements'
            : null
        }
        onClose={() => setSheet(null)}
        pageX={tokens.pageX}
      >
        {sheet === 'today' ? (
          <View>
            <Text style={styles.sheetSectionTitle}>Today plan</Text>
            <View style={styles.sheetList}>
              {todayItems.map(item => (
                <ScalePressable key={item.id} accessibilityLabel={item.name} onPress={() => toggleDone(item)} style={styles.sheetRowButton} scaleTo={0.98}>
                  <View style={styles.sheetRowInner}>
                    <View>
                      <Text style={styles.sheetRowTitle}>{item.name}</Text>
                      <Text style={styles.sheetRowSubtitle}>{item.time}</Text>
                    </View>
                    <View style={styles.sheetRowRight}>
                      <Text style={styles.sheetRowStatus}>{item.done ? 'Taken' : 'Remaining'}</Text>
                      <View style={[styles.sheetStatusIcon, item.done ? styles.sheetStatusIconDone : styles.sheetStatusIconPending]}>
                        <CheckCircle2 size={18} color="#0f172a" />
                      </View>
                    </View>
                  </View>
                </ScalePressable>
              ))}
            </View>

            <ScalePressable accessibilityLabel="Mark all as taken" onPress={markAllRemaining} style={styles.sheetActionButton} scaleTo={0.98}>
              <Text style={styles.sheetActionText}>Mark all as taken</Text>
            </ScalePressable>
          </View>
        ) : sheet === 'adherence' ? (
          <View>
            <Text style={styles.sheetSectionTitle}>{adherence.label}</Text>
            <View style={styles.sheetList}>
              {adherence.items.map(item => (
                <View key={item.name} style={styles.sheetMetricCard}>
                  <View style={styles.sheetMetricHeader}>
                    <Text style={styles.sheetRowTitle}>{item.name}</Text>
                    <Text style={styles.sheetRowTitle}>{item.val}%</Text>
                  </View>
                  <View style={styles.sheetMetricTrack}>
                    <View style={[styles.sheetMetricFill, { width: `${item.val}%` }]} />
                  </View>
                </View>
              ))}
            </View>

            <ScalePressable accessibilityLabel="Adjust plan" onPress={() => setSheet('reminders')} style={styles.sheetActionButton} scaleTo={0.98}>
              <Text style={styles.sheetActionText}>Adjust plan</Text>
            </ScalePressable>
          </View>
        ) : sheet === 'reminders' ? (
          <View>
            <Text style={styles.sheetSectionTitle}>Today plan</Text>
            <View style={styles.sheetList}>
              {planItems.flatMap(item => {
                const status = item.done
                  ? 'Done'
                  : planNextId && item.id === planNextId
                    ? 'Next reminder'
                    : 'Remaining';
                const rows = [
                  <ScalePressable
                    key={item.id}
                    accessibilityLabel={item.name}
                    onPress={() => setBackupCandidateId(item.id)}
                    style={[
                      styles.sheetMetricCard,
                      styles.sheetSelectableCard,
                      backupCandidateId === item.id && styles.sheetSelectableCardActive,
                    ]}
                    scaleTo={0.98}
                  >
                    <View>
                      <Text style={styles.sheetRowTitle}>{formatPlanTitle(item.name, item.timeLabel)}</Text>
                      <Text style={styles.sheetRowSubtitle}>{status}</Text>
                      {item.withFood ? <Text style={styles.sheetRowNote}>Take with food</Text> : null}
                    </View>
                  </ScalePressable>,
                ];

                if (backupReminderSet.has(item.id)) {
                  const backupLabel = addMinutesToTimeLabel(item.timeRaw) ?? 'Backup reminder';
                  rows.push(
                    <View key={`${item.id}-backup`} style={styles.sheetMetricCard}>
                      <Text style={styles.sheetRowTitle}>{formatPlanTitle(item.name, backupLabel)}</Text>
                      <Text style={styles.sheetRowSubtitle}>Backup reminder</Text>
                      {item.withFood ? <Text style={styles.sheetRowNote}>Take with food</Text> : null}
                    </View>,
                  );
                }

                return rows;
              })}
            </View>
            {backupCandidateItem ? (
              <ScalePressable
                accessibilityLabel={backupCandidateActive ? 'Cancel backup reminder' : 'Enable backup reminder'}
                onPress={() => {
                  if (!backupCandidateId) return;
                  setBackupReminders(prev => {
                    if (prev.includes(backupCandidateId)) {
                      return prev.filter(id => id !== backupCandidateId);
                    }
                    return [...prev, backupCandidateId];
                  });
                }}
                style={[
                  styles.sheetActionButton,
                  backupCandidateActive ? styles.sheetActionButtonMuted : styles.sheetActionButtonPrimary,
                ]}
                scaleTo={0.98}
              >
                <Text style={backupCandidateActive ? styles.sheetActionTextMuted : styles.sheetActionText}>
                  {backupCandidateActive ? 'Cancel backup reminder' : 'Enable backup reminder'}
                </Text>
              </ScalePressable>
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },

  screen: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },

  content: {
    width: '100%',
  },
  contentFrame: {
    width: '100%',
    alignSelf: 'center',
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  headerTitle: {
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.2,
    includeFontPadding: false,
  },

  row: {
    flexDirection: 'row',
    gap: 16,
  },
  sectionSpacing: {
    marginTop: 0,
  },

  cardBase: {
    position: 'relative',
    borderRadius: 32,
    borderCurve: 'continuous',
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 40,
    elevation: 6,
  },
  cardInsetHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },

  iconButtonBase: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  segmentedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: 999,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(15,23,42,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
  },
  segmentedOption: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedOptionActive: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    elevation: 2,
  },
  segmentedOptionInactive: {
    backgroundColor: 'transparent',
  },
  segmentedText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    includeFontPadding: false,
  },
  segmentedTextActive: {
    color: 'rgba(15,23,42,0.92)',
  },
  segmentedTextInactive: {
    color: 'rgba(15,23,42,0.55)',
  },

  progressTrack: {
    height: 20,
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },

  miniMetricCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    flex: 1,
  },
  miniMetricCardSquare: {
    aspectRatio: 1,
  },
  miniMetricCardCompact: {
    minHeight: 160,
  },
  miniMetricPressable: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniMetricPressableCompact: {
    padding: 16,
  },
  miniMetricIcon: {
    width: 56,
    height: 56,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    marginBottom: 12,
  },
  miniMetricIconCompact: {
    width: 48,
    height: 48,
    marginBottom: 10,
  },
  miniMetricTextWrap: { alignItems: 'center', minWidth: 0, width: '100%' },
  miniMetricLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 2,
    textTransform: 'uppercase',
    includeFontPadding: false,
    textAlign: 'center',
  },
  miniMetricLabelCompact: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
  },
  miniMetricValue: {
    marginTop: 4,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
    textAlign: 'center',
  },
  miniMetricValueCompact: {
    fontSize: 26,
    lineHeight: 30,
  },
  miniMetricSub: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: '#64748b',
    includeFontPadding: false,
    textAlign: 'center',
  },
  miniMetricSubCompact: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 12,
  },

  todayCard: { backgroundColor: '#253FAE' },
  todayContent: { padding: 24 },
  todayHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  todayTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.3,
    includeFontPadding: false,
  },
  todaySubtitle: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 3.5,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  todayIconButton: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  todayStatsRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  todayPercent: {
    fontSize: 60,
    lineHeight: 66,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -1.2,
    includeFontPadding: false,
  },
  todayCountWrap: { alignItems: 'flex-end', paddingBottom: 8 },
  todayCount: { fontSize: 24, lineHeight: 28, fontWeight: '800', color: '#ffffff', includeFontPadding: false },
  todayCountLabel: { fontSize: 14, lineHeight: 18, fontWeight: '700', color: 'rgba(255,255,255,0.8)', includeFontPadding: false },
  todayProgressWrap: { marginTop: 16 },
  todayMessageRow: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  todayDot: { width: 8, height: 8, borderRadius: 999, borderCurve: 'continuous', backgroundColor: '#ffffff' },
  todayMessage: { fontSize: 16, lineHeight: 22, fontWeight: '700', color: 'rgba(255,255,255,0.85)', flex: 1, includeFontPadding: false },
  todayRemainingWrap: { marginTop: 16 },
  todayRemainingLabel: { fontSize: 11, lineHeight: 14, fontWeight: '800', color: 'rgba(255,255,255,0.6)', letterSpacing: 2.5, textTransform: 'uppercase', includeFontPadding: false },
  remainingList: { marginTop: 12, gap: 8 },
  remainingMark: { fontSize: 11, lineHeight: 14, fontWeight: '800', color: 'rgba(255,255,255,0.8)', includeFontPadding: false },
  todayActionWrap: { marginTop: 16 },
  todayActionButton: { paddingVertical: 12, borderRadius: 999, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  todayActionEnabled: { backgroundColor: 'rgba(255,255,255,0.92)' },
  todayActionDisabled: { backgroundColor: 'rgba(255,255,255,0.45)' },
  todayActionText: { fontSize: 14, lineHeight: 18, fontWeight: '800', includeFontPadding: false },
  todayActionTextEnabled: { color: '#253FAE' },
  todayActionTextDisabled: { color: 'rgba(37,63,174,0.6)' },

  squareCard: { flex: 1, aspectRatio: 1 },
  planWideCard: { flex: 1 },
  squarePressable: { flex: 1, padding: 16 },
  planPressable: { padding: 24 },
  squareHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  squareTitle: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
    color: '#0f172a',
    paddingTop: 2,
    includeFontPadding: false,
  },
  squareIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  planIconWrap: {
    transform: [{ translateY: -12 }],
  },
  squareBody: { marginTop: 12, flex: 1, justifyContent: 'center', gap: 8 },
  squareFooter: { marginTop: 20, fontSize: 11, lineHeight: 14, fontWeight: '700', color: 'rgba(51,65,85,0.7)', includeFontPadding: false, alignSelf: 'flex-start', transform: [{ translateY: 8 }] },
  consistencyCard: { backgroundColor: '#E6E0CF' },
  remindersCard: { backgroundColor: '#F3D153' },

  consistencyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  consistencyLabel: { width: 36, fontSize: 12, lineHeight: 16, fontWeight: '800', color: '#1e293b', includeFontPadding: false },
  consistencyTrack: { flex: 1, height: 10, borderRadius: 999, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.18)' },
  consistencyFill: { height: '100%', borderRadius: 999, borderCurve: 'continuous', backgroundColor: 'rgba(15,23,42,0.92)' },
  consistencyValue: { width: 36, textAlign: 'right', fontSize: 12, lineHeight: 16, fontWeight: '900', color: '#0f172a', includeFontPadding: false },

  reminderTag: { fontSize: 10, lineHeight: 12, fontWeight: '900', color: '#475569', includeFontPadding: false },

  trendCard: { backgroundColor: '#A8C9FF' },
  trendContent: { padding: 24 },
  trendHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  trendTitle: { fontSize: 30, lineHeight: 36, fontWeight: '900', color: '#0f172a', includeFontPadding: false },
  iconButtonLight: { backgroundColor: 'rgba(0,0,0,0.06)' },
  trendBarsRow: { marginTop: 24, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  trendBarColumn: { flex: 1, alignItems: 'center', gap: 8 },
  trendBarPressable: { width: '100%', alignItems: 'center', gap: 8 },
  trendBarTrack: { width: 32, height: TREND_BAR_HEIGHT, borderRadius: 999, borderCurve: 'continuous', overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.22)' },
  trendBarFill: { width: '100%', borderRadius: 999, borderCurve: 'continuous', shadowColor: '#000000', shadowOpacity: 0.1, shadowOffset: { width: 0, height: 4 }, shadowRadius: 6, elevation: 2 },
  trendBarFillActive: { backgroundColor: '#1e293b' },
  trendBarFillInactive: { backgroundColor: 'rgba(15,23,42,0.55)' },
  trendBarFillEmpty: { backgroundColor: 'rgba(15,23,42,0.2)' },
  trendBarFillZero: { backgroundColor: 'transparent', shadowOpacity: 0, elevation: 0 },
  trendBarLabel: { fontSize: 11, lineHeight: 14, fontWeight: '900', color: 'rgba(15,23,42,0.75)', includeFontPadding: false, textAlign: 'center', width: '100%' },
  trendBarLabelActive: { color: '#0f172a' },
  trendBarValue: { fontSize: 12, lineHeight: 16, fontWeight: '900', color: 'rgba(71,85,105,0.9)', includeFontPadding: false, textAlign: 'center', width: '100%', letterSpacing: -0.2, fontVariant: ['tabular-nums'] },
  trendBarValueActive: { color: '#0f172a' },
  trendSummary: { marginTop: 20, gap: 4 },
  trendSummaryPrimary: { fontSize: 14, lineHeight: 18, fontWeight: '900', color: '#0f172a', includeFontPadding: false },
  trendSummarySecondary: { fontSize: 14, lineHeight: 18, fontWeight: '700', color: 'rgba(15,23,42,0.8)', includeFontPadding: false },
  trendSegmentWrap: {
    marginTop: 12,
    alignSelf: 'flex-end',
  },

  achievementsCard: { backgroundColor: '#D0E6A5' },
  achievementsContent: { padding: 24 },
  achievementsHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  achievementsTitle: { fontSize: 30, lineHeight: 36, fontWeight: '900', color: '#0f172a', includeFontPadding: false },
  achievementsActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewAllButton: { justifyContent: 'center' },
  achievementsLink: { fontSize: 12, lineHeight: 16, fontWeight: '800', color: 'rgba(15,23,42,0.7)', includeFontPadding: false },
  achievementsRow: { marginTop: 24, flexDirection: 'row', gap: 20 },
  achievementItem: { flex: 1, alignItems: 'center', gap: 8 },
  achievementLocked: { opacity: 0.45 },
  achievementIcon: { width: 48, height: 48, borderRadius: 999, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)' },
  achievementLabel: { fontSize: 10, lineHeight: 12, fontWeight: '900', letterSpacing: 2, color: 'rgba(15,23,42,0.8)', textTransform: 'uppercase', textAlign: 'center', includeFontPadding: false },

  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheetHitbox: { width: '100%' },
  sheetContainer: {
    width: '100%',
    maxHeight: SHEET_MAX_HEIGHT,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderCurve: 'continuous',
    shadowColor: '#0f172a',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: -30 },
    shadowRadius: 70,
    elevation: 12,
  },
  sheetHeader: { paddingHorizontal: PAGE_X, paddingTop: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 20, lineHeight: 24, fontWeight: '900', color: '#0f172a', includeFontPadding: false },
  sheetCloseButton: { width: 40, height: 40, borderRadius: 999, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(241,245,249,0.7)', borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)' },
  sheetContent: { paddingHorizontal: PAGE_X, paddingBottom: 32 },
  sheetSectionTitle: { fontSize: 14, lineHeight: 18, fontWeight: '800', color: '#0f172a', includeFontPadding: false },
  sheetList: { marginTop: 12, gap: 12 },
  sheetRowButton: { borderRadius: 16, borderCurve: 'continuous', backgroundColor: 'rgba(15,23,42,0.04)', borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)' },
  sheetRowInner: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetRowTitle: { fontSize: 14, lineHeight: 18, fontWeight: '900', color: '#0f172a', includeFontPadding: false },
  sheetRowSubtitle: { marginTop: 2, fontSize: 12, lineHeight: 16, fontWeight: '700', color: '#475569', includeFontPadding: false },
  sheetRowNote: { marginTop: 6, fontSize: 12, lineHeight: 16, fontWeight: '700', color: '#64748b', includeFontPadding: false },
  sheetRowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetRowStatus: { fontSize: 12, lineHeight: 16, fontWeight: '800', color: '#475569', includeFontPadding: false },
  sheetStatusIcon: { width: 36, height: 36, borderRadius: 999, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  sheetStatusIconDone: { backgroundColor: 'rgba(34,197,94,0.16)' },
  sheetStatusIconPending: { backgroundColor: 'rgba(148,163,184,0.20)' },
  sheetActionButton: { marginTop: 20, paddingVertical: 12, borderRadius: 999, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.92)' },
  sheetActionButtonPrimary: { backgroundColor: 'rgba(15,23,42,0.92)' },
  sheetActionButtonMuted: { backgroundColor: 'rgba(15,23,42,0.10)' },
  sheetActionText: { fontSize: 14, lineHeight: 18, fontWeight: '900', color: '#ffffff', includeFontPadding: false },
  sheetActionTextMuted: { fontSize: 14, lineHeight: 18, fontWeight: '900', color: 'rgba(15,23,42,0.70)', includeFontPadding: false },
  sheetMetricCard: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderCurve: 'continuous', backgroundColor: 'rgba(15,23,42,0.04)', borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)' },
  sheetSelectableCard: { alignItems: 'flex-start' },
  sheetSelectableCardActive: { backgroundColor: '#DBEAFE', borderColor: '#BFDBFE' },
  sheetMetricHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  sheetMetricTrack: { marginTop: 8, height: 12, borderRadius: 999, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: 'rgba(15,23,42,0.14)' },
  sheetMetricFill: { height: '100%', backgroundColor: 'rgba(15,23,42,0.92)' },

  // Pill
  pillBase: {
    width: '100%',
    borderWidth: 1,
    borderCurve: 'continuous',
    alignSelf: 'stretch',
  },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pillDefault: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 18, borderCurve: 'continuous' },
  pillCompact: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderCurve: 'continuous' },
  pillDense: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderCurve: 'continuous' },
  pillLight: { backgroundColor: 'rgba(255,255,255,0.38)', borderColor: 'rgba(15,23,42,0.08)' },
  pillDark: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.18)' },
  pillIconDefault: { width: 32, height: 32, borderRadius: 999, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  pillIconCompact: { width: 28, height: 28, borderRadius: 999, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  pillIconDense: { width: 24, height: 24, borderRadius: 999, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  pillIconLight: { backgroundColor: 'rgba(255,255,255,0.55)' },
  pillIconDark: { backgroundColor: 'rgba(255,255,255,0.14)' },
  pillTextWrap: { flex: 1, minWidth: 0 },
  pillRight: { alignItems: 'center', justifyContent: 'center' },
  pillTextDefault: { fontSize: 14, lineHeight: 18, fontWeight: '900', includeFontPadding: false },
  pillTextCompact: { fontSize: 13, lineHeight: 18, fontWeight: '900', includeFontPadding: false },
  pillTextDense: { fontSize: 12, lineHeight: 16, fontWeight: '900', includeFontPadding: false },
  pillTextLight: { color: '#0f172a' },
  pillTextDark: { color: '#ffffff' },
});
