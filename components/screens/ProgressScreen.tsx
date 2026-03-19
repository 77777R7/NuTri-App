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
import Reanimated, {
  Easing as ReanimatedEasing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { ContentFrame } from '@/components/common/ContentFrame';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { useDailyCheckIns } from '@/contexts/DailyCheckInContext';
import { useProgressRange, type ProgressRange } from '@/contexts/ProgressRangeContext';
import { useSavedSupplements } from '@/contexts/SavedSupplementsContext';
import { useScreenTokens } from '@/hooks/useScreenTokens';
import {
  buildCheckInSeries,
  buildStreakAchievementBadges,
  getCurrentPerfectStreakDays,
  getNextStreakMilestone,
  hasAnyCompletedCheckInDay,
  summarizeCheckInDay,
} from '@/lib/check-in-adherence';
import { validateCheckInDateForItem } from '@/lib/check-in-eligibility';
import { buildCheckInKey, getLocalDateKey } from '@/lib/check-ins';
import {
  Activity,
  Check,
  CheckCircle2,
  Clock,
  Flame,
  Medal,
  Trophy,
  X,
} from 'lucide-react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_MAX_HEIGHT = Math.round(SCREEN_HEIGHT * 0.85);

const SCREEN_BG = '#F2F3F7';
const PAGE_X = 24;
const NAV_HEIGHT = 64;
const MINI_METRIC_GAP = 16;
const MAIN_CARD_GAP = 16;
const CARD_RADIUS = 28;
const CARD_PADDING_X = 20;
const CARD_PADDING_Y = 18;
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
  const progress = useSharedValue(pct / 100);
  const trackWidth = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(pct / 100, {
      duration: 480,
      easing: ReanimatedEasing.out(ReanimatedEasing.cubic),
    });
  }, [pct, progress]);

  const fillStyle = useAnimatedStyle(() => {
    const scale = progress.value;
    const translateX = (scale - 1) * 0.5 * trackWidth.value;
    return {
      transform: [{ translateX }, { scaleX: scale }],
    };
  });

  return (
    <View
      style={styles.progressTrack}
      onLayout={event => {
        trackWidth.value = event.nativeEvent.layout.width;
      }}
    >
      <Reanimated.View style={[styles.progressFill, fillStyle]} />
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
  const trackedItems = useMemo(
    () => savedSupplements.filter(item => item.syncedToCheckIn),
    [savedSupplements],
  );
  const hasAnyTrackedItems = trackedItems.length > 0;
  const resolveExpectedForDate = useCallback(
    (dateKey: string) => {
      const eligibleItems = trackedItems.filter(item => validateCheckInDateForItem(item, dateKey, todayKey).isValid);
      const expectedKeys = eligibleItems.map(item =>
        buildCheckInKey({ supplementId: item.supplementId, localId: item.id }),
      );
      return {
        expectedCount: expectedKeys.length,
        expectedKeySet: new Set(expectedKeys),
      };
    },
    [todayKey, trackedItems],
  );
  const todayExpected = useMemo(() => resolveExpectedForDate(todayKey), [resolveExpectedForDate, todayKey]);
  const expectedCount = todayExpected.expectedCount;
  const todaySummary = useMemo(
    () => summarizeCheckInDay(trackedItems, checkInsByDate, todayKey, todayKey),
    [checkInsByDate, todayKey, trackedItems],
  );

  const todayItems = useMemo(() => {
    const checked = new Set(checkInsByDate[todayKey] ?? []);
    return trackedItems
      .filter(item => validateCheckInDateForItem(item, todayKey, todayKey).isValid)
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
  }, [checkInsByDate, todayKey, trackedItems]);

  const planItems = useMemo<PlanItem[]>(() => {
    const checked = new Set(checkInsByDate[todayKey] ?? []);
    return trackedItems
      .filter(item => validateCheckInDateForItem(item, todayKey, todayKey).isValid)
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
  }, [checkInsByDate, todayKey, trackedItems]);

  const planNextId = useMemo(() => planItems.find(item => !item.done)?.id ?? null, [planItems]);
  const pendingPlanItems = useMemo(() => planItems.filter(item => !item.done), [planItems]);
  const pendingPlanCount = pendingPlanItems.length;
  const planTotalCount = planItems.length;
  const planPreviewCount = planCardHeight < 200 ? 1 : 2;

  const planNextItem = useMemo(
    () => (planNextId ? planItems.find(item => item.id === planNextId) : null),
    [planItems, planNextId],
  );

  const planSummaryLabel = useMemo(() => {
    if (!planTotalCount) return hasAnyTrackedItems ? 'No reminders today' : 'Set schedule';
    if (!pendingPlanCount) return 'All done';
    return pendingPlanCount === 1 ? '1 remaining' : `${pendingPlanCount} remaining`;
  }, [hasAnyTrackedItems, pendingPlanCount, planTotalCount]);

  const planSubLabel = useMemo(() => {
    if (!planTotalCount) {
      return hasAnyTrackedItems ? 'Your next plan resumes on a scheduled day.' : 'Tap to set reminders.';
    }
    if (!pendingPlanCount) return "You're set for today.";
    if (!planNextItem) return 'Next: Anytime';
    const time = planNextItem.timeLabel ?? 'Anytime';
    return time === 'Anytime' ? 'Next: Anytime' : `Next at ${time}`;
  }, [hasAnyTrackedItems, pendingPlanCount, planNextItem, planTotalCount]);

  const planCardItems = useMemo(() => {
    if (!pendingPlanItems.length) return [];
    return pendingPlanItems.slice(0, planPreviewCount);
  }, [pendingPlanItems, planPreviewCount]);

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
  const nextRemaining = remaining[0] ?? null;
  const percentShared = useSharedValue(percent);
  const [displayPercent, setDisplayPercent] = useState(percent);

  useEffect(() => {
    percentShared.value = withTiming(percent, {
      duration: 520,
      easing: ReanimatedEasing.out(ReanimatedEasing.cubic),
    });
  }, [percent, percentShared]);

  useAnimatedReaction(
    () => Math.round(percentShared.value),
    (next, prev) => {
      if (next !== prev) {
        runOnJS(setDisplayPercent)(next);
      }
    },
    [percentShared],
  );

  const countCompletedForDate = useCallback(
    (dateKey: string) => {
      const { expectedCount, expectedKeySet } = resolveExpectedForDate(dateKey);
      if (expectedCount === 0) return 0;
      const completedSet = new Set(checkInsByDate[dateKey] ?? []);
      let completedCount = 0;
      expectedKeySet.forEach(key => {
        if (completedSet.has(key)) completedCount += 1;
      });
      return completedCount;
    },
    [checkInsByDate, resolveExpectedForDate],
  );

  const toggleDone = useCallback(
    (item: TodayItem) => {
      const savedItem = savedSupplements.find(saved => saved.id === item.id);
      void toggleCheckIn(todayKey, item.checkInKey, item.supplementId, {
        createdAt: savedItem?.createdAt ?? null,
        syncedToCheckIn: savedItem?.syncedToCheckIn ?? true,
        routine: savedItem?.routine ?? undefined,
      });
    },
    [savedSupplements, todayKey, toggleCheckIn],
  );

  const togglePlanDone = useCallback(
    (item: PlanItem) => {
      const savedItem = savedSupplements.find(saved => saved.id === item.id);
      void toggleCheckIn(todayKey, item.checkInKey, item.supplementId, {
        createdAt: savedItem?.createdAt ?? null,
        syncedToCheckIn: savedItem?.syncedToCheckIn ?? true,
        routine: savedItem?.routine ?? undefined,
      });
    },
    [savedSupplements, todayKey, toggleCheckIn],
  );

  const markAllRemaining = useCallback(() => {
    if (!remaining.length) return;
    void addCheckIns(
      todayKey,
      remaining.map(item => ({
        key: item.checkInKey,
        supplementId: item.supplementId,
        createdAt: savedSupplements.find(saved => saved.id === item.id)?.createdAt ?? null,
        syncedToCheckIn: savedSupplements.find(saved => saved.id === item.id)?.syncedToCheckIn ?? true,
        routine: savedSupplements.find(saved => saved.id === item.id)?.routine ?? undefined,
      })),
    );
  }, [addCheckIns, remaining, savedSupplements, todayKey]);

  const recent30DaySeries = useMemo(
    () => buildCheckInSeries(trackedItems, checkInsByDate, todayKey, 30),
    [checkInsByDate, todayKey, trackedItems],
  );
  const currentStreakDays = useMemo(
    () => getCurrentPerfectStreakDays(trackedItems, checkInsByDate, todayKey),
    [checkInsByDate, todayKey, trackedItems],
  );
  const achievementBadges = useMemo(
    () => buildStreakAchievementBadges(currentStreakDays, hasAnyCompletedCheckInDay(checkInsByDate)),
    [checkInsByDate, currentStreakDays],
  );
  const badgeUnlocked = achievementBadges.filter(badge => badge.unlocked).length;
  const nextStreakMilestone = useMemo(
    () => getNextStreakMilestone(currentStreakDays),
    [currentStreakDays],
  );
  const nextBadgeDaysLeft = nextStreakMilestone.daysRemaining;
  const streakGoalDays = nextStreakMilestone.goalDays;
  const streakSecuredToday = todaySummary.expectedCount === 0 ? true : todaySummary.isPerfectDay;
  const streakStatus =
    !hasAnyTrackedItems
      ? 'SET YOUR PLAN TO START'
      : totalCount === 0
        ? 'NO CHECK-IN DUE TODAY'
      : streakSecuredToday
        ? 'STREAK SECURED FOR TODAY'
        : takenCount > 0
          ? 'FINISH TODAY TO KEEP YOUR STREAK'
          : 'CHECK IN TODAY TO KEEP YOUR STREAK';

  const weekActiveDays = useMemo(() => {
    const startDate = getWeekStartMonday(new Date());
    let activeDays = 0;
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);
      if (countCompletedForDate(getLocalDateKey(date)) > 0) activeDays += 1;
    }
    return activeDays;
  }, [countCompletedForDate]);

  const activeDays30 = useMemo(() => {
    return recent30DaySeries.reduce(
      (count, day) => count + (day.completedCount > 0 ? 1 : 0),
      0,
    );
  }, [recent30DaySeries]);

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
      const { expectedCount: total } = resolveExpectedForDate(dateKey);
      const completed = countCompletedForDate(dateKey);
      const value = total > 0 ? calcPercent(completed, total) : null;
      return {
        k: TREND_DAY_LABELS[date.getDay()],
        v: value,
        completed,
        total,
        dateKey,
      };
    });
  }, [countCompletedForDate, resolveExpectedForDate]);

  const trendSeries30d = useMemo<TrendSeriesEntry[]>(() => {
    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 28 }, (_, index) => {
      const date = new Date(endDate);
      date.setDate(endDate.getDate() - (27 - index));
      const dateKey = getLocalDateKey(date);
      const { expectedCount: total } = resolveExpectedForDate(dateKey);
      const completed = countCompletedForDate(dateKey);
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
  }, [countCompletedForDate, resolveExpectedForDate]);

  const todayTimelineSeries = useMemo<TrendSeriesEntry[]>(() => {
    if (!planItems.length) return [];

    const map = new Map<
      string,
      {
        k: string;
        timeMinutes: number | null;
        completed: number;
        total: number;
      }
    >();

    for (const item of planItems) {
      const key = item.timeMinutes === null ? 'anytime' : `t-${item.timeMinutes}`;
      const existing = map.get(key);

      if (!existing) {
        map.set(key, {
          k: item.timeLabel,
          timeMinutes: item.timeMinutes,
          completed: item.done ? 1 : 0,
          total: 1,
        });
      } else {
        existing.total += 1;
        if (item.done) existing.completed += 1;
      }
    }

    const groups = Array.from(map.values()).sort((a, b) => {
      if (a.timeMinutes === null && b.timeMinutes === null) return 0;
      if (a.timeMinutes === null) return 1;
      if (b.timeMinutes === null) return -1;
      return a.timeMinutes - b.timeMinutes;
    });

    return groups.map(group => ({
      k: group.k,
      v: group.total > 0 ? calcPercent(group.completed, group.total) : null,
      completed: group.completed,
      total: group.total,
      dateKey: group.timeMinutes === null ? 'anytime' : `t-${group.timeMinutes}`,
    }));
  }, [planItems]);

  const trend = useMemo(() => {
    if (range === 'today') {
      return {
        title: 'Today Timeline',
        series: todayTimelineSeries,
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
  }, [range, remaining, takenCount, todayTimelineSeries, totalCount, trendSeries30d, trendSeries7d]);

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

  const streakCardHeight = Math.max(190, Math.round(planCardHeight * 1.05));

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
              value={
                nextBadgeDaysLeft === 0
                  ? 'Done'
                  : `${nextBadgeDaysLeft} day${nextBadgeDaysLeft === 1 ? '' : 's'}`
              }
              sub={
                nextBadgeDaysLeft === 0
                  ? `${streakGoalDays}-day streak reached`
                  : `to ${streakGoalDays}-day streak`
              }
              onPress={() => setSheet('achievements')}
              density={twoUpDensity}
            />
          </View>

          {/* Today card */}
          <View style={[styles.sectionSpacing, { marginTop: MAIN_CARD_GAP }]}>
            <Card style={styles.todayCard}>
              <View style={styles.todayContent}>
                <View style={styles.todayHeaderRow}>
                  <View style={styles.todayHeaderLeft}>
                    <Text style={styles.todayTitle}>{"Today's Progress"}</Text>
                    <Text style={styles.todaySubtitle}>
                      {totalCount === 0
                        ? 'No items scheduled'
                        : remaining.length === 0
                        ? 'Goal hit for today'
                        : `${remaining.length} remaining`}
                    </Text>
                  </View>
                  <IconButton
                    label="Today details"
                    onPress={() => setSheet('today')}
                    icon={<Activity size={18} color="#ffffff" />}
                    style={styles.todayIconButton}
                  />
                </View>

                <View style={styles.todayStatsRow}>
                  <Text style={styles.todayPercent}>{displayPercent}%</Text>
                  <View style={styles.todayCountWrap}>
                    <Text style={styles.todayCount}>
                      {takenCount}/{totalCount}
                    </Text>
                    <Text style={styles.todayCountLabel}>Taken</Text>
                  </View>
                </View>

                <View style={styles.todayProgressWrap}>
                  <AnimatedProgressBar value={percent} />
                </View>

                <View style={styles.todayMessageRow}>
                  <View style={styles.todayDot} />
                  <Text style={styles.todayMessage}>
                    {totalCount === 0
                      ? 'Add items to your plan to start tracking.'
                      : remaining.length
                      ? `Just ${remaining.length} more to hit your daily goal!`
                      : 'You hit your daily goal.'}
                  </Text>
                </View>

                {totalCount > 0 ? (
                  <View style={styles.todayNextWrap}>
                    <Text style={styles.todayNextLabel}>Next up</Text>

                    {nextRemaining ? (
                      <View style={styles.todayNextCard}>
                        <View style={styles.todayNextIconWrap}>
                          <Clock size={16} color="#ffffff" />
                        </View>

                        <ScalePressable
                          accessibilityLabel={`View details for ${nextRemaining.name}`}
                          onPress={() => setSheet('today')}
                          style={styles.todayNextTextPressable}
                          scaleTo={0.98}
                        >
                          <View style={styles.todayNextTextWrap}>
                            <Text style={styles.todayNextName} numberOfLines={2} ellipsizeMode="tail">
                              {nextRemaining.name}
                            </Text>
                            <Text style={styles.todayNextMeta} numberOfLines={1} ellipsizeMode="tail">
                              {nextRemaining.time}
                            </Text>
                          </View>
                        </ScalePressable>

                        <ScalePressable
                          accessibilityLabel={`Mark ${nextRemaining.name} as taken`}
                          onPress={() => toggleDone(nextRemaining)}
                          style={styles.todayNextCheckButton}
                          scaleTo={0.92}
                        >
                          <View style={styles.todayNextCheckInner}>
                            <Check size={18} color="#253FAE" />
                          </View>
                        </ScalePressable>
                      </View>
                    ) : (
                      <View style={styles.todayNextCardDone}>
                        <View style={styles.todayNextIconWrap}>
                          <CheckCircle2 size={16} color="#ffffff" />
                        </View>
                        <View style={styles.todayNextTextWrap}>
                          <Text style={styles.todayNextName} numberOfLines={1}>
                            All items logged
                          </Text>
                          <Text style={styles.todayNextMeta} numberOfLines={1}>
                            Nice work today.
                          </Text>
                        </View>
                      </View>
                    )}

                    {remaining.length > 1 ? (
                      <ScalePressable
                        accessibilityLabel="View all remaining"
                        onPress={() => setSheet('today')}
                        style={styles.todayViewAllButton}
                        scaleTo={0.98}
                      >
                        <Text style={styles.todayViewAllText}>View all ({remaining.length})</Text>
                      </ScalePressable>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.todayActionWrap}>
                  <ScalePressable
                    accessibilityLabel={totalCount === 0 ? 'Set up plan' : 'Today details'}
                    onPress={() => {
                      if (totalCount === 0) {
                        setSheet('reminders');
                      } else {
                        setSheet('today');
                      }
                    }}
                    style={[styles.todayActionButton, styles.todayActionEnabled]}
                    scaleTo={0.95}
                  >
                    <Text style={[styles.todayActionText, styles.todayActionTextEnabled]}>
                      {totalCount === 0
                        ? 'Set up plan'
                        : remaining.length
                        ? `View remaining (${remaining.length})`
                        : 'View today details'}
                    </Text>
                  </ScalePressable>
                </View>
              </View>
            </Card>
          </View>

        {/* Plan */}
        <View style={[styles.sectionSpacing, { marginTop: MAIN_CARD_GAP }]}>
          <Card style={[styles.planWideCard, styles.remindersCard, { height: planCardHeight }]}>
            <ScalePressable
              accessibilityLabel="Plan"
              onPress={() => setSheet('reminders')}
              style={styles.fill}
              scaleTo={0.97}
            >
              <View style={styles.planCardContent}>
                <View style={styles.planHeaderRow}>
                  <View style={styles.planHeaderLeft}>
                    <Text style={styles.planTitleText}>Plan</Text>
                    <View style={styles.planSummaryChip}>
                      <Text style={styles.planSummaryText} numberOfLines={1} ellipsizeMode="tail">
                        {planSummaryLabel}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.planHeaderRight}>
                    <Text style={styles.planEditLabel}>Edit</Text>
                    <View style={styles.planHeaderIconWrap}>
                      <Clock size={16} color="#0f172a" />
                    </View>
                  </View>
                </View>

                <Text style={styles.planSubLabel} numberOfLines={1} ellipsizeMode="tail">
                  {planSubLabel}
                </Text>

                {!planTotalCount ? (
                  <View style={styles.planEmptyState}>
                    <Text style={styles.planEmptyTitle}>
                      {hasAnyTrackedItems ? 'Nothing scheduled today' : 'No reminders yet'}
                    </Text>
                    <Text style={styles.planEmptySub}>
                      {hasAnyTrackedItems ? 'Your plan resumes on the next eligible day.' : 'Tap to schedule your plan.'}
                    </Text>
                  </View>
                ) : !pendingPlanCount ? (
                  <View style={styles.planAllDoneState}>
                    <View style={styles.planAllDoneIconWrap}>
                      <CheckCircle2 size={16} color="#0f172a" />
                    </View>
                    <View style={styles.planAllDoneTextWrap}>
                      <Text style={styles.planAllDoneTitle} numberOfLines={1} ellipsizeMode="tail">
                        All done for today
                      </Text>
                      <Text style={styles.planAllDoneSub} numberOfLines={1} ellipsizeMode="tail">
                        Tap to review or edit reminders.
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.planRows}>
                    {planCardItems.map(item => {
                      const isNext = Boolean(planNextId && item.id === planNextId);
                      const metaParts = [];
                      if (isNext) metaParts.push('Next');
                      metaParts.push(item.timeLabel);
                      if (item.withFood) metaParts.push('With food');
                      if (backupReminderSet.has(item.id)) metaParts.push('Backup');
                      const metaText = metaParts.join(' · ');

                      return (
                        <View key={item.id} style={[styles.planRow, isNext ? styles.planRowNext : null]}>
                          <View style={[styles.planRowIconWrap, isNext ? styles.planRowIconWrapNext : null]}>
                            <Clock size={14} color="#0f172a" />
                          </View>

                          <View style={styles.planRowTextWrap}>
                            <Text style={styles.planRowTitle} numberOfLines={1} ellipsizeMode="tail">
                              {item.name}
                            </Text>
                            <Text style={styles.planRowMeta} numberOfLines={1} ellipsizeMode="tail">
                              {metaText}
                            </Text>
                          </View>

                          <ScalePressable
                            accessibilityLabel={`Mark ${item.name} as taken`}
                            onPress={() => togglePlanDone(item)}
                            style={styles.planMarkButton}
                            scaleTo={0.9}
                          >
                            <Check size={16} color="#0f172a" />
                          </ScalePressable>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            </ScalePressable>
          </Card>
        </View>

        {/* Streak */}
        <View style={[styles.sectionSpacing, { marginTop: MAIN_CARD_GAP }]}>
          <Card style={[styles.planWideCard, styles.streakWideCard, { height: streakCardHeight }]}>
            <View style={styles.streakContent}>
              <View style={styles.streakHeaderRow}>
                <Text style={styles.streakTitle}>Streak</Text>
                <View style={styles.streakIconWrap}>
                  <Trophy size={18} color="#7C3AED" />
                </View>
              </View>

              <View style={styles.streakBody}>
                <View style={styles.streakBodyRow}>
                  <View style={styles.streakPrimary}>
                    <View style={styles.streakMainRow}>
                      <Text style={styles.streakDaysValue}>{currentStreakDays}</Text>
                      <Text style={styles.streakDaysLabel}>DAYS</Text>
                    </View>
                    <Text style={styles.streakSubLabel}>TO {streakGoalDays}-DAY STREAK</Text>

                    <View style={styles.streakStatusRow}>
                      {streakSecuredToday ? (
                        <CheckCircle2 size={14} color="#1F2937" />
                      ) : totalCount === 0 ? (
                        <Flame size={14} color="#1F2937" />
                      ) : (
                        <Clock size={14} color="#1F2937" />
                      )}
                      <Text style={styles.streakStatus} numberOfLines={2}>
                        {streakStatus}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.streakSideMetrics}>
                    <View style={styles.streakSideMetricRow}>
                      <Text style={styles.streakSideMetricLabel}>THIS WEEK</Text>
                      <Text style={styles.streakSideMetricValue} numberOfLines={1}>
                        {weekActiveDays}/7{' '}
                        <Text style={styles.streakSideMetricSuffix}>CHECK-INS</Text>
                      </Text>
                    </View>

                    <View style={styles.streakSideMetricRow}>
                      <Text style={styles.streakSideMetricLabel}>LAST 30 DAYS</Text>
                      <Text style={styles.streakSideMetricValue} numberOfLines={1}>
                        {activeDays30}{' '}
                        <Text style={styles.streakSideMetricSuffix}>ACTIVE DAYS</Text>
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
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

              {range === 'today' ? (
                <View style={styles.trendTimelineWrap}>
                  {trend.series.length ? (
                    <>
                      <View style={styles.trendTimelineTimeRow}>
                        {trend.series.map((entry, idx) => {
                          const isActive = activeTrendIndex !== null && idx === activeTrendIndex;
                          return (
                            <View key={`${entry.k}-${idx}-time`} style={styles.trendTimelineColumn}>
                              <MotiView
                                animate={{ translateY: isActive ? -2 : 0 }}
                                transition={{ type: 'timing', duration: 200 }}
                              >
                                <Text
                                  style={[styles.trendTimelineTime, isActive && styles.trendTimelineTimeActive]}
                                  numberOfLines={1}
                                  ellipsizeMode="tail"
                                >
                                  {entry.k}
                                </Text>
                              </MotiView>
                              {isActive ? (
                                <View style={styles.trendTimelineUnderlineWrap}>
                                  <MotiView
                                    from={{ width: 0, opacity: 0 }}
                                    animate={{ width: 22, opacity: 1 }}
                                    transition={{ type: 'timing', duration: 220 }}
                                    style={styles.trendTimelineActiveUnderline}
                                  />
                                </View>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>

                      <View style={styles.trendTimelineTrackRow}>
                        <View pointerEvents="none" style={styles.trendTimelineTrack} />
                        {trend.series.map((entry, idx) => {
                          const isActive = activeTrendIndex !== null && idx === activeTrendIndex;
                          const pctLabel = entry.v === null ? '--' : `${entry.v}%`;
                          const dotTone =
                            entry.v === null
                              ? styles.trendTimelineDotEmpty
                              : entry.v >= 100
                                ? styles.trendTimelineDotDone
                                : entry.v > 0
                                  ? styles.trendTimelineDotPartial
                                  : styles.trendTimelineDotPending;

                          return (
                            <MotiView
                              key={`${entry.k}-${idx}-dot`}
                              style={styles.trendTimelineColumn}
                              animate={{ scale: isActive ? 1.08 : 1 }}
                              transition={{ type: 'timing', duration: 200 }}
                            >
                              <Pressable
                                onPress={() => setSelectedTrendIndex(prev => (prev === idx ? null : idx))}
                                style={styles.trendTimelineDotPressable}
                                hitSlop={10}
                                accessibilityRole="button"
                                accessibilityLabel={`Timeline ${entry.k}`}
                              >
                                {isActive ? (
                                  <MotiView
                                    key={`${entry.k}-${idx}-active-dot`}
                                    from={{ scale: 0.6 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: 'timing', duration: 220 }}
                                    style={[
                                      styles.trendTimelineDot,
                                      dotTone,
                                      styles.trendTimelineDotActive,
                                    ]}
                                  />
                                ) : (
                                  <View style={[styles.trendTimelineDot, dotTone]} />
                                )}
                              </Pressable>
                            </MotiView>
                          );
                        })}
                      </View>

                      <View style={styles.trendTimelineValueRow}>
                        {trend.series.map((entry, idx) => {
                          const isActive = activeTrendIndex !== null && idx === activeTrendIndex;
                          return (
                            <View key={`${entry.k}-${idx}-val`} style={styles.trendTimelineColumn}>
                              <Text
                                style={[styles.trendTimelineValue, isActive && styles.trendTimelineValueActive]}
                                numberOfLines={1}
                                ellipsizeMode="clip"
                              >
                                {entry.v === null ? '--' : `${entry.v}%`}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    </>
                  ) : (
                    <View style={styles.trendEmptyWrap}>
                      <Text style={styles.trendEmptyText}>No items scheduled today.</Text>
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.trendBarsRow}>
                  {trend.series.map((entry, idx) => {
                    const isActive = activeTrendIndex !== null && idx === activeTrendIndex;
                    const pctLabel = entry.v === null ? '--' : `${entry.v}%`;
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
                          accessibilityRole="button"
                          accessibilityLabel={`Trend ${entry.k}`}
                        >
                          <View style={[styles.trendBarTrack, isActive && styles.trendBarTrackActive]}>
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
                            {pctLabel}
                          </Text>
                        </Pressable>
                      </MotiView>
                    );
                  })}
                </View>
              )}

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
                {achievementBadges.map(badge => {
                  const Icon =
                    badge.label === 'FIRST'
                      ? CheckCircle2
                      : badge.label === 'CHAMP'
                        ? Trophy
                        : Flame;
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
                    <View style={styles.sheetRowTextWrap}>
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
    borderRadius: CARD_RADIUS,
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
    width: '100%',
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
  todayContent: { paddingHorizontal: CARD_PADDING_X, paddingTop: CARD_PADDING_Y, paddingBottom: CARD_PADDING_Y },
  todayHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  todayHeaderLeft: { flex: 1, minWidth: 0, paddingRight: 12 },
  todayTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.3,
    includeFontPadding: false,
  },
  todaySubtitle: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 1.8,
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

  todayNextWrap: { marginTop: 18 },
  todayNextLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  todayNextCard: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    gap: 12,
  },
  todayNextCardDone: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    gap: 12,
  },
  todayNextIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  todayNextTextPressable: { flex: 1, minWidth: 0 },
  todayNextTextWrap: { flex: 1, minWidth: 0 },
  todayNextName: { fontSize: 14, lineHeight: 18, fontWeight: '800', color: '#ffffff', includeFontPadding: false },
  todayNextMeta: { marginTop: 2, fontSize: 12, lineHeight: 16, fontWeight: '700', color: 'rgba(255,255,255,0.72)', includeFontPadding: false },
  todayNextCheckButton: { padding: 2 },
  todayNextCheckInner: {
    width: 42,
    height: 42,
    borderRadius: 999,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayViewAllButton: { marginTop: 10, alignSelf: 'flex-start' },
  todayViewAllText: { fontSize: 12, lineHeight: 16, fontWeight: '800', color: 'rgba(255,255,255,0.85)', includeFontPadding: false },
  todayRemainingWrap: { marginTop: 16 },
  todayRemainingLabel: { fontSize: 11, lineHeight: 14, fontWeight: '800', color: 'rgba(255,255,255,0.6)', letterSpacing: 2.5, textTransform: 'uppercase', includeFontPadding: false },
  remainingList: { marginTop: 12, gap: 8 },
  remainingMark: { fontSize: 11, lineHeight: 14, fontWeight: '800', color: 'rgba(255,255,255,0.8)', includeFontPadding: false },
  todayActionWrap: { marginTop: 18 },
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
  planCardContent: { flex: 1, paddingHorizontal: CARD_PADDING_X, paddingVertical: CARD_PADDING_Y },
  planHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  planTitleText: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
  },
  planSummaryChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
  },
  planSummaryText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
    letterSpacing: 0.2,
  },
  planHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planEditLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: 'rgba(15,23,42,0.75)',
    includeFontPadding: false,
  },
  planHeaderIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  planSubLabel: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: 'rgba(15,23,42,0.7)',
    includeFontPadding: false,
  },
  planRows: { marginTop: 12, gap: 10 },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.50)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
  },
  planRowNext: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderColor: 'rgba(15,23,42,0.14)',
  },
  planRowIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.08)',
    marginRight: 10,
  },
  planRowIconWrapNext: { backgroundColor: 'rgba(15,23,42,0.12)' },
  planRowTextWrap: { flex: 1, minWidth: 0 },
  planRowTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
  },
  planRowMeta: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: 'rgba(15,23,42,0.65)',
    includeFontPadding: false,
  },
  planMarkButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.65)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.12)',
  },
  planEmptyState: { flex: 1, justifyContent: 'center', paddingTop: 8 },
  planEmptyTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
  },
  planEmptySub: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: 'rgba(15,23,42,0.7)',
    includeFontPadding: false,
  },
  planAllDoneState: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
  },
  planAllDoneIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.08)',
    marginRight: 10,
  },
  planAllDoneTextWrap: { flex: 1, minWidth: 0 },
  planAllDoneTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
  },
  planAllDoneSub: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: 'rgba(15,23,42,0.65)',
    includeFontPadding: false,
  },
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
  streakWideCard: { backgroundColor: '#C9B6FF' },

  streakContent: { flex: 1, paddingHorizontal: CARD_PADDING_X, paddingVertical: CARD_PADDING_Y },
  streakHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  streakTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    color: '#1F2937',
    includeFontPadding: false,
  },
  streakIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124,58,237,0.14)',
  },
  streakBody: { flex: 1, marginTop: 12 },
  streakBodyRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  streakPrimary: { flex: 1, minWidth: 0, gap: 6 },
  streakMainRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  streakDaysValue: {
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '900',
    color: '#1F2937',
    includeFontPadding: false,
    letterSpacing: -0.6,
  },
  streakDaysLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    color: '#1F2937',
    includeFontPadding: false,
    letterSpacing: 0.6,
  },
  streakSubLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#4B5563',
    includeFontPadding: false,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  streakStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  streakStatus: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#4B5563',
    includeFontPadding: false,
    flexShrink: 1,
  },
  streakSideMetrics: {
    flexBasis: 132,
    flexShrink: 0,
    alignSelf: 'stretch',
    paddingLeft: 14,
    borderLeftWidth: 1,
    borderColor: 'rgba(15,23,42,0.12)',
    gap: 12,
    paddingTop: 4,
  },
  streakSideMetricRow: { alignItems: 'flex-end', gap: 4 },
  streakSideMetricLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    color: '#6B7280',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  streakSideMetricValue: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '900',
    color: '#1F2937',
    includeFontPadding: false,
    letterSpacing: 0.2,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  streakSideMetricSuffix: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    color: 'rgba(31,41,55,0.7)',
    includeFontPadding: false,
  },

  consistencyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  consistencyLabel: { width: 36, fontSize: 12, lineHeight: 16, fontWeight: '800', color: '#1e293b', includeFontPadding: false },
  consistencyTrack: { flex: 1, height: 10, borderRadius: 999, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.18)' },
  consistencyFill: { height: '100%', borderRadius: 999, borderCurve: 'continuous', backgroundColor: 'rgba(15,23,42,0.92)' },
  consistencyValue: { width: 36, textAlign: 'right', fontSize: 12, lineHeight: 16, fontWeight: '900', color: '#0f172a', includeFontPadding: false },

  reminderTag: { fontSize: 10, lineHeight: 12, fontWeight: '900', color: '#475569', includeFontPadding: false },

  trendCard: { backgroundColor: '#A8C9FF' },
  trendContent: { paddingHorizontal: CARD_PADDING_X, paddingVertical: CARD_PADDING_Y },
  trendHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  trendTitle: { fontSize: 24, lineHeight: 30, fontWeight: '900', color: '#0f172a', includeFontPadding: false },
  iconButtonLight: { backgroundColor: 'rgba(0,0,0,0.06)' },
  trendBarsRow: { marginTop: 24, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  trendBarColumn: { flex: 1, alignItems: 'center', gap: 8 },
  trendBarPressable: { width: '100%', alignItems: 'center', gap: 8, position: 'relative' },
  trendBarTrack: {
    width: 32,
    height: TREND_BAR_HEIGHT,
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.10)',
  },
  trendBarTrackActive: { borderColor: 'rgba(15,23,42,0.18)' },
  trendBarFill: { width: '100%', borderRadius: 999, borderCurve: 'continuous', shadowColor: '#000000', shadowOpacity: 0.1, shadowOffset: { width: 0, height: 4 }, shadowRadius: 6, elevation: 2 },
  trendBarFillActive: { backgroundColor: '#1e293b' },
  trendBarFillInactive: { backgroundColor: 'rgba(15,23,42,0.55)' },
  trendBarFillEmpty: { backgroundColor: 'rgba(15,23,42,0.2)' },
  trendBarFillZero: { backgroundColor: 'transparent', shadowOpacity: 0, elevation: 0 },
  trendBarLabel: { fontSize: 11, lineHeight: 14, fontWeight: '900', color: 'rgba(15,23,42,0.75)', includeFontPadding: false, textAlign: 'center', width: '100%' },
  trendBarLabelActive: { color: '#0f172a', textDecorationLine: 'underline' },
  trendBarValue: { fontSize: 12, lineHeight: 16, fontWeight: '900', color: 'rgba(71,85,105,0.9)', includeFontPadding: false, textAlign: 'center', width: '100%', letterSpacing: -0.2, fontVariant: ['tabular-nums'] },
  trendBarValueActive: { color: '#0f172a' },
  trendTimelineWrap: { marginTop: 24 },
  trendTimelineTimeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  trendTimelineTrackRow: { marginTop: 10, flexDirection: 'row', gap: 10, alignItems: 'center', position: 'relative', height: 30 },
  trendTimelineValueRow: { marginTop: 10, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  trendTimelineColumn: { flex: 1, alignItems: 'center', minWidth: 0 },
  trendTimelineTime: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    color: 'rgba(15,23,42,0.70)',
    includeFontPadding: false,
    textAlign: 'center',
  },
  trendTimelineTimeActive: { color: '#0f172a' },
  trendTimelineUnderlineWrap: {
    marginTop: 4,
    width: 22,
    height: 2,
    borderRadius: 999,
    overflow: 'hidden',
    alignSelf: 'center',
  },
  trendTimelineActiveUnderline: {
    height: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.92)',
  },
  trendTimelineTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.18)',
  },
  trendTimelineDotPressable: { position: 'relative', alignItems: 'center', justifyContent: 'center', width: 22, height: 22 },
  trendTimelineDot: {
    width: 14,
    height: 14,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.16)',
    backgroundColor: 'rgba(15,23,42,0.12)',
  },
  trendTimelineDotDone: { backgroundColor: 'rgba(15,23,42,0.92)', borderColor: 'rgba(15,23,42,0.92)' },
  trendTimelineDotPartial: { backgroundColor: 'rgba(15,23,42,0.60)', borderColor: 'rgba(15,23,42,0.60)' },
  trendTimelineDotPending: { backgroundColor: 'rgba(15,23,42,0.12)', borderColor: 'rgba(15,23,42,0.16)' },
  trendTimelineDotEmpty: { backgroundColor: 'rgba(15,23,42,0.10)', borderColor: 'rgba(15,23,42,0.10)' },
  trendTimelineDotActive: {
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 4,
  },
  trendTimelineValue: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    color: 'rgba(71,85,105,0.90)',
    includeFontPadding: false,
    textAlign: 'center',
    width: '100%',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  trendTimelineValueActive: { color: '#0f172a' },
  trendEmptyWrap: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
  },
  trendEmptyText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    color: 'rgba(15,23,42,0.65)',
    includeFontPadding: false,
  },
  trendSummary: { marginTop: 20, gap: 4 },
  trendSummaryPrimary: { fontSize: 14, lineHeight: 18, fontWeight: '900', color: '#0f172a', includeFontPadding: false },
  trendSummarySecondary: { fontSize: 14, lineHeight: 18, fontWeight: '700', color: 'rgba(15,23,42,0.8)', includeFontPadding: false },
  trendSegmentWrap: {
    marginTop: 12,
    alignSelf: 'flex-end',
  },

  achievementsCard: { backgroundColor: '#D0E6A5' },
  achievementsContent: { paddingHorizontal: CARD_PADDING_X, paddingVertical: CARD_PADDING_Y },
  achievementsHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  achievementsTitle: { fontSize: 24, lineHeight: 30, fontWeight: '900', color: '#0f172a', includeFontPadding: false },
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
  sheetRowInner: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  sheetRowTextWrap: { flex: 1, minWidth: 0, paddingRight: 4 },
  sheetRowTitle: { flexShrink: 1, fontSize: 14, lineHeight: 18, fontWeight: '900', color: '#0f172a', includeFontPadding: false },
  sheetRowSubtitle: { marginTop: 2, fontSize: 12, lineHeight: 16, fontWeight: '700', color: '#475569', includeFontPadding: false },
  sheetRowNote: { marginTop: 6, fontSize: 12, lineHeight: 16, fontWeight: '700', color: '#64748b', includeFontPadding: false },
  sheetRowRight: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  sheetRowStatus: { fontSize: 12, lineHeight: 16, fontWeight: '800', color: '#475569', includeFontPadding: false, textAlign: 'right' },
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
