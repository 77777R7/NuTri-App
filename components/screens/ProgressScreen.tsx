import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { useScreenTokens } from '@/hooks/useScreenTokens';
import {
  Activity,
  AlertCircle,
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

type RangeKey = 'today' | '7d' | '30d';
type SheetKey = 'today' | 'adherence' | 'reminders' | 'trend' | 'achievements' | null;

type TodayItem = {
  id: string;
  name: string;
  time: string;
  done: boolean;
};

const calcPercent = (taken: number, total: number) => {
  if (total <= 0) return 0;
  return Math.round((taken / total) * 100);
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
};

const MiniMetricCard = ({ icon, label, value, sub, onPress }: MiniMetricCardProps) => {
  return (
    <Card style={styles.miniMetricCard}>
      <ScalePressable accessibilityLabel={label} onPress={onPress} style={styles.fill} scaleTo={0.95}>
        <View style={styles.miniMetricPressable}>
          <LinearGradient
            colors={['rgba(255,255,255,0.9)', 'rgba(255,255,255,0.55)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.miniMetricIcon}
          >
            {icon}
          </LinearGradient>

          <View style={styles.miniMetricTextWrap}>
            <Text style={styles.miniMetricLabel}>{label}</Text>
            <Text style={styles.miniMetricValue}>{value}</Text>
            {sub ? <Text style={styles.miniMetricSub}>{sub}</Text> : null}
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
};

const Sheet = ({ open, title, onClose, children }: SheetProps) => {
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
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <ScalePressable accessibilityLabel="Close" onPress={onClose} style={styles.sheetCloseButton} scaleTo={0.95}>
                <X size={18} color="#0f172a" />
              </ScalePressable>
            </View>

            <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
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

  const [range, setRange] = useState<RangeKey>('7d');
  const [sheet, setSheet] = useState<SheetKey>(null);
  const [backupReminder, setBackupReminder] = useState(false);

  const [todayItems, setTodayItems] = useState<TodayItem[]>([
    { id: 'vitd', name: 'Vit D', time: 'Morning', done: true },
    { id: 'omega3', name: 'Omega-3', time: 'Dinner', done: true },
    { id: 'probiotic', name: 'Probiotic', time: 'Lunch', done: true },
    { id: 'mag', name: 'Magnesium', time: '9:00 PM', done: false },
  ]);

  const takenCount = todayItems.filter(item => item.done).length;
  const totalCount = todayItems.length;
  const percent = calcPercent(takenCount, totalCount);
  const remaining = todayItems.filter(item => !item.done);

  const markAllRemaining = () => setTodayItems(prev => prev.map(item => ({ ...item, done: true })));
  const toggleDone = (id: string) => setTodayItems(prev => prev.map(item => (item.id === id ? { ...item, done: !item.done } : item)));

  const badgeUnlocked = 2;
  const nextBadgeDaysLeft = 1;

  const adherence = useMemo(() => {
    if (range === 'today') {
      const vitd = todayItems.find(item => item.id === 'vitd');
      const mag = todayItems.find(item => item.id === 'mag');
      return {
        label: 'Streak',
        items: [
          { name: 'Vit D', val: vitd?.done ? 100 : 0 },
          { name: 'Mag', val: mag?.done ? 100 : 0 },
        ],
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

  const trend = useMemo(() => {
    if (range === 'today') {
      const slots = [
        { label: 'AM', id: 'vitd' },
        { label: 'Noon', id: 'probiotic' },
        { label: 'PM', id: 'omega3' },
        { label: '9pm', id: 'mag' },
      ];
      const series = slots.map(slot => {
        const item = todayItems.find(entry => entry.id === slot.id);
        return { k: slot.label, v: item?.done ? 100 : 0 };
      });
      return {
        title: 'Today Timeline',
        series,
        summaryA: `Taken: ${takenCount}/${totalCount}`,
        summaryB: remaining.length ? `Remaining: ${remaining[0].name}` : 'All done today',
      };
    }

    if (range === '30d') {
      const series = [
        { k: 'W1', v: 72 },
        { k: 'W2', v: 78 },
        { k: 'W3', v: 83 },
        { k: 'W4', v: 86 },
      ];
      const avg = calcPercent(series.reduce((total, entry) => total + entry.v, 0), series.length * 100);
      const best = series.reduce((prev, current) => (current.v > prev.v ? current : prev), series[0]);
      const low = series.reduce((prev, current) => (current.v < prev.v ? current : prev), series[0]);
      return {
        title: '30-Day Trend',
        series,
        summaryA: `Average: ${avg}%`,
        summaryB: `Lowest: ${low.k} ${low.v}% · Best: ${best.k} ${best.v}%`,
      };
    }

    const series = [
      { k: 'M', v: 65 },
      { k: 'T', v: 80 },
      { k: 'W', v: 30 },
      { k: 'T', v: 90 },
      { k: 'F', v: 100 },
      { k: 'S', v: 95 },
      { k: 'S', v: 100 },
    ];
    const avg = calcPercent(series.reduce((total, entry) => total + entry.v, 0), series.length * 100);
    const best = series.reduce((prev, current) => (current.v > prev.v ? current : prev), series[0]);
    const low = series.reduce((prev, current) => (current.v < prev.v ? current : prev), series[0]);
    return {
      title: '7-Day Trend',
      series,
      summaryA: `Average: ${avg}%`,
      summaryB: `Lowest: ${low.k} ${low.v}% · Best: ${best.k} ${best.v}%`,
    };
  }, [range, remaining, takenCount, todayItems, totalCount]);

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
            paddingHorizontal: tokens.pageX,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={[styles.headerRow, { marginBottom: tokens.sectionGap }]}>
          <Text style={[styles.headerTitle, { fontSize: tokens.h1Size, lineHeight: tokens.h1Line }]} maxFontSizeMultiplier={1.2}>
            Progress
          </Text>
          <View style={styles.segmentedOffset}>
            <SegmentedControl value={range} onChange={setRange} />
          </View>
        </View>

        {/* Top mini metrics */}
        <View style={styles.row}>
          <MiniMetricCard
            icon={<Medal size={22} color="#b45309" />}
            label="Badges unlocked"
            value={String(badgeUnlocked)}
            sub="Streak + Perfect Day"
            onPress={() => setSheet('achievements')}
          />
          <MiniMetricCard
            icon={<Trophy size={22} color="#334155" />}
            label="Next badge"
            value={`${nextBadgeDaysLeft} day`}
            sub="to 7-day streak"
            onPress={() => setSheet('achievements')}
          />
        </View>

        {/* Today card */}
        <View style={[styles.sectionSpacing, { marginTop: tokens.sectionGap }]}>
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
                        onPress={() => toggleDone(item.id)}
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
        <View style={[styles.row, styles.sectionSpacing, { marginTop: tokens.sectionGap }]}>
          <Card style={[styles.squareCard, styles.consistencyCard]}>
            <ScalePressable accessibilityLabel="Streak" onPress={() => setSheet('adherence')} style={styles.fill} scaleTo={0.95}>
              <View style={styles.squarePressable}>
                <View style={styles.squareHeaderRow}>
                  <Text style={styles.squareTitle} numberOfLines={1} ellipsizeMode="tail">Streak</Text>
                  <View style={styles.squareIconWrap}>
                    <AlertCircle size={16} color="#0f172a" />
                  </View>
                </View>

                <View style={styles.squareBody}>
                  {adherence.items.slice(0, 2).map(item => (
                    <View key={item.name} style={styles.consistencyRow}>
                      <Text style={styles.consistencyLabel} numberOfLines={1}>{item.name}</Text>
                      <View style={styles.consistencyTrack}>
                        <View style={[styles.consistencyFill, { width: `${item.val}%` }]} />
                      </View>
                      <Text style={styles.consistencyValue}>{item.val}%</Text>
                    </View>
                  ))}
                </View>

                <Text style={styles.squareFooter}>Tap card for details.</Text>
              </View>
            </ScalePressable>
          </Card>

          <Card style={[styles.squareCard, styles.remindersCard]}>
            <ScalePressable accessibilityLabel="Plan" onPress={() => setSheet('reminders')} style={styles.fill} scaleTo={0.95}>
              <View style={styles.squarePressable}>
                <View style={styles.squareHeaderRow}>
                  <Text style={styles.squareTitle} numberOfLines={1} ellipsizeMode="tail">Plan</Text>
                  <View style={styles.squareIconWrap}>
                    <Clock size={16} color="#0f172a" />
                  </View>
                </View>

                <View style={styles.squareBody}>
                  <Pill
                    dense
                    left={<Clock size={14} color="#0f172a" />}
                    text={backupReminder ? 'Mg · 9pm (Backup)' : 'Mg · 9pm'}
                    right={<Text style={styles.reminderTag}>Next</Text>}
                    onPress={() => setSheet('reminders')}
                  />
                  <Pill
                    dense
                    left={<CheckCircle2 size={14} color="#0f172a" />}
                    text="Vit D"
                    right={<Text style={styles.reminderTag}>Done</Text>}
                    onPress={() => setSheet('reminders')}
                  />
                </View>

                <Text style={styles.squareFooter}>Tap card to edit.</Text>
              </View>
            </ScalePressable>
          </Card>
        </View>

        {/* Trend */}
        <View style={[styles.sectionSpacing, { marginTop: tokens.sectionGap }]}>
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
                {trend.series.map((entry, idx) => (
                  <View key={`${entry.k}-${idx}`} style={styles.trendBarColumn}>
                    <View style={styles.trendBarTrack}>
                      <View style={[styles.trendBarFill, { height: `${entry.v}%` }]} />
                    </View>
                    <Text style={styles.trendBarLabel}>{entry.k}</Text>
                    <Text style={styles.trendBarValue} numberOfLines={1} ellipsizeMode="clip">{entry.v}%</Text>
                  </View>
                ))}
              </View>

              <View style={styles.trendSummary}>
                <Text style={styles.trendSummaryPrimary}>{trend.summaryA}</Text>
                <Text style={styles.trendSummarySecondary}>{trend.summaryB}</Text>
              </View>
            </View>
          </Card>
        </View>

        {/* Achievements */}
        <View style={[styles.sectionSpacing, { marginTop: tokens.sectionGap }]}>
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
      >
        {sheet === 'today' ? (
          <View>
            <Text style={styles.sheetSectionTitle}>Today plan</Text>
            <View style={styles.sheetList}>
              {todayItems.map(item => (
                <ScalePressable key={item.id} accessibilityLabel={item.name} onPress={() => toggleDone(item.id)} style={styles.sheetRowButton} scaleTo={0.98}>
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
              <View style={styles.sheetMetricCard}>
                <Text style={styles.sheetRowTitle}>Mg · 9:00 PM</Text>
                <Text style={styles.sheetRowSubtitle}>Next reminder</Text>
              </View>

              {backupReminder ? (
                <View style={styles.sheetMetricCard}>
                  <Text style={styles.sheetRowTitle}>Mg · 9:15 PM</Text>
                  <Text style={styles.sheetRowSubtitle}>Backup reminder</Text>
                </View>
              ) : null}

              <View style={styles.sheetMetricCard}>
                <Text style={styles.sheetRowTitle}>Vit D</Text>
                <Text style={styles.sheetRowSubtitle}>Done</Text>
              </View>
            </View>

            <ScalePressable
              accessibilityLabel="Enable backup reminder"
              onPress={() => setBackupReminder(true)}
              style={[styles.sheetActionButton, backupReminder ? styles.sheetActionButtonMuted : styles.sheetActionButtonPrimary]}
              scaleTo={0.98}
            >
              <Text style={backupReminder ? styles.sheetActionTextMuted : styles.sheetActionText}>
                {backupReminder ? 'Backup reminder enabled' : 'Enable backup reminder'}
              </Text>
            </ScalePressable>
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

  content: {},

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
  segmentedOffset: {
    transform: [{ translateY: 6 }],
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
    aspectRatio: 1,
  },
  miniMetricPressable: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
  miniMetricTextWrap: { alignItems: 'center' },
  miniMetricLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 2,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  miniMetricValue: {
    marginTop: 4,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
  },
  miniMetricSub: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: '#64748b',
    includeFontPadding: false,
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
  squarePressable: { flex: 1, padding: 16 },
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
  squareBody: { marginTop: 12, flex: 1, justifyContent: 'center', gap: 8 },
  squareFooter: { marginTop: 8, fontSize: 11, lineHeight: 14, fontWeight: '700', color: 'rgba(51,65,85,0.7)', includeFontPadding: false, alignSelf: 'flex-start' },
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
  trendBarTrack: { width: 32, height: 128, borderRadius: 999, borderCurve: 'continuous', overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.22)' },
  trendBarFill: { width: '100%', borderRadius: 999, borderCurve: 'continuous', backgroundColor: '#1e293b', shadowColor: '#000000', shadowOpacity: 0.1, shadowOffset: { width: 0, height: 4 }, shadowRadius: 6, elevation: 2 },
  trendBarLabel: { fontSize: 11, lineHeight: 14, fontWeight: '900', color: '#000000', includeFontPadding: false, textAlign: 'center', width: '100%' },
  trendBarValue: { fontSize: 12, lineHeight: 16, fontWeight: '900', color: '#475569', includeFontPadding: false, textAlign: 'center', width: '100%', letterSpacing: -0.2, fontVariant: ['tabular-nums'] },
  trendSummary: { marginTop: 20, gap: 4 },
  trendSummaryPrimary: { fontSize: 14, lineHeight: 18, fontWeight: '900', color: '#0f172a', includeFontPadding: false },
  trendSummarySecondary: { fontSize: 14, lineHeight: 18, fontWeight: '700', color: 'rgba(15,23,42,0.8)', includeFontPadding: false },

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
