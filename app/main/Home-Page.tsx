import ProgressScreen from '@/components/screens/ProgressScreen';
import { MySupplementView } from '@/components/screens/MySupplement';
import { useSavedSupplements } from '@/contexts/SavedSupplementsContext';
import { useScanHistory } from '@/contexts/ScanHistoryContext';
import { useScreenTokens } from '@/hooks/useScreenTokens';
import { useTranslation } from '@/lib/i18n';
import type { RoutinePreferences } from '@/types/saved-supplements';
import type { ScanHistoryItem } from '@/types/scan-history';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
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
  ScanText,
  Send,
  ShieldPlus,
  Sparkles,
  User,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
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
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';

// 创建支持动画的 Pressable
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedText = Animated.createAnimatedComponent(Text);
const AnimatedView = Animated.createAnimatedComponent(View);

const SCREEN_BG = '#F2F3F7';
const PAGE_X = 24;
const SECTION_GAP = 24;
const STACK_GAP = 16;

const BOTTOM_INSET_TRIM = 0;
const BOTTOM_FADE_EXTRA = 120;
const NAV_HEIGHT = 64;

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
}: {
  item: SupplementItem;
  isChecked: boolean;
  onCheckIn: () => void;
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

  return (
    <AnimatedPressable
      onPress={onCheckIn}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
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
            ) : (
              <Animated.View entering={ZoomIn.rotate('90deg')} exiting={ZoomOut.rotate('90deg')}>
                <Plus size={18} color={getIconColorHex(item.iconColor)} strokeWidth={3} />
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

const days = [
  { day: 'S', date: 14 },
  { day: 'M', date: 15 },
  { day: 'T', date: 16 },
  { day: 'W', date: 17 },
  { day: 'T', date: 18 },
  { day: 'F', date: 19 },
  { day: 'S', date: 20 },
];

type DayItemProps = {
  item: { day: string; date: number };
  isSelected: boolean;
  onPress: () => void;
};

const DayItemComponent = ({ item, isSelected, onPress }: DayItemProps) => {
  const progress = useSharedValue(isSelected ? 1 : 0);

  useEffect(() => {
    progress.value = withSpring(isSelected ? 1 : 0, {
      mass: 1,
      damping: 15,
      stiffness: 120,
      overshootClamping: false,
    });
  }, [isSelected, progress]);

  const bgStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: progress.value }],
  }));

  const dayTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], ['#94a3b8', '#94a3b8']),
  }));

  const dateTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], ['#0f172a', '#ffffff']),
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      style={({ pressed }) => ({
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      <View style={[styles.dayItemBase, !isSelected && styles.dayItemInactive]}>
        <Animated.View style={[styles.dayItemActiveBg, bgStyle]} />
        <AnimatedText style={[styles.dayLabel, dayTextStyle]}>{item.day}</AnimatedText>

        <View style={styles.dayDateWrap}>
          <AnimatedText style={[styles.dayDate, dateTextStyle]}>{item.date}</AnimatedText>
          {isSelected ? (
            <Animated.View
              entering={ZoomIn.duration(200)}
              exiting={ZoomOut.duration(200)}
              style={styles.dayDot}
            />
          ) : null}
        </View>
      </View>
    </AnimatedPressable>
  );
};

const DayItem = React.memo(DayItemComponent, (prevProps, nextProps) => {
  return prevProps.isSelected === nextProps.isSelected && prevProps.item.date === nextProps.item.date;
});
DayItem.displayName = 'DayItem';

const WeekdaySelector = () => {
  const [selectedDate, setSelectedDate] = useState(14);
  const calendarOpacity = useSharedValue(1);

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

      <View style={styles.daysRow}>
        {days.map(item => (
          <DayItem
            key={item.date}
            item={item}
            isSelected={selectedDate === item.date}
            onPress={() => setSelectedDate(item.date)}
          />
        ))}
      </View>
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

const SavedSupplements = () => {
  const { t } = useTranslation();
  const { savedSupplements } = useSavedSupplements();
  const [scrollProgress, setScrollProgress] = useState(0);
  const [checkedItems, setCheckedItems] = useState<string[]>([]);

  const supplements: (SupplementItem & { id: string })[] = useMemo(() => {
    const visible = savedSupplements
      .filter(item => item.syncedToCheckIn)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return visible.map((item, index) => {
      const theme = CHECKIN_THEMES[index % CHECKIN_THEMES.length];
      return {
        id: item.id,
        name: item.productName,
        dose: item.dosageText,
        ...theme,
      };
    });
  }, [savedSupplements]);

  const handleCheckIn = (id: string) => {
    setCheckedItems(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const scrollableWidth = contentSize.width - layoutMeasurement.width;
    if (scrollableWidth <= 0) {
      setScrollProgress(0);
      return;
    }

    const progress = contentOffset.x / scrollableWidth;
    setScrollProgress(Math.min(Math.max(progress, 0), 1));
  };

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
            <Text style={styles.checkInEmptyTitle}>{t.checkInEmptyTitle}</Text>
            <Text style={styles.checkInEmptyDescription}>{t.checkInEmptyDescription}</Text>
          </View>
        </View>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            decelerationRate="fast"
            snapToInterval={CARD_WIDTH + CARD_GAP}
            snapToAlignment="center"
            style={{ marginHorizontal: -PAGE_X, height: CARD_HEIGHT + 20 }}
            contentContainerStyle={{
              paddingHorizontal: PAGE_X,
              paddingBottom: 8,
              alignItems: 'center',
            }}
          >
            {supplements.map((item, index) => (
              <View
                key={item.id}
                style={{ marginRight: index === supplements.length - 1 ? 0 : CARD_GAP }}
              >
                <SupplementCheckInCard
                  item={item}
                  isChecked={checkedItems.includes(item.id)}
                  onCheckIn={() => handleCheckIn(item.id)}
                />
              </View>
            ))}
          </ScrollView>

          <View style={styles.indicatorTrack}>
            <AnimatedView
              style={[
                styles.indicatorThumb,
                { width: INDICATOR_WIDTH, left: scrollProgress * INDICATOR_MAX_LEFT },
              ]}
            />
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
  const today = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const progress = 0.6;

  return (
    <Animated.View
      entering={FadeInUp.delay(300).duration(500).springify()}
      className="w-full bg-blue-800 rounded-[2rem] p-6 text-white relative overflow-hidden h-64"
      style={{ borderCurve: 'continuous' }}
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
          <AnimatedText entering={FadeInUp.delay(500).springify()} style={styles.progressBig}>
            60%
          </AnimatedText>

          <View style={{ marginTop: 8, gap: 6 }}>
            <View className="flex-row items-center gap-2">
              <CheckCircle2 size={16} color="#34d399" />
              <Text style={styles.progressTaken}>Taken: 3 / 5</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <View className="w-4 h-4 items-center justify-center">
                <View className="w-1.5 h-1.5 rounded-full bg-blue-400/50" />
              </View>
              <Text style={styles.progressRemain}>Remaining: 2</Text>
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
            <Circle
              cx="50"
              cy="50"
              r={radius}
              stroke="#3b82f6"
              strokeWidth={10}
              fill="transparent"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
            />
          </Svg>

          <View className="absolute inset-0 items-center justify-center pt-1">
            <Text style={styles.goalValue}>3</Text>
            <Text style={styles.goalSub}>of 5</Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

const NutriChatCard = () => (
  <Animated.View
    entering={FadeInUp.delay(300).duration(500).springify()}
    className="bg-[#F8F4E3] rounded-[2rem] p-5 flex-1 flex-col justify-between h-48 relative overflow-hidden"
    style={{ borderCurve: 'continuous' }}
  >
    <View className="flex-row items-center gap-1.5 z-10">
      <View
        className="w-8 h-8 rounded-full border border-slate-300/50 items-center justify-center bg-white"
        style={{ borderCurve: 'continuous' }}
      >
        <Sparkles size={16} color="#f59e0b" />
      </View>
      <Text style={styles.smallCardTitle}>NuTri Chat</Text>
    </View>

    <View className="flex-1 justify-between z-10 mt-2 mb-1">
      <View
        className="self-start bg-white p-3 rounded-2xl shadow-sm border border-slate-200/50 max-w-[90%]"
        style={{ borderCurve: 'continuous' }}
      >
        <Text style={styles.chatBubbleText}>Questions about your intake? I&apos;m here to help!</Text>
      </View>

      <View
        className="w-full h-9 bg-white/60 rounded-full border border-slate-200/60 flex-row items-center px-3 gap-2"
        style={{ borderCurve: 'continuous' }}
      >
        <Text style={styles.chatPlaceholder}>Ask AI anything...</Text>
        <View className="ml-auto w-6 h-6 rounded-full bg-slate-800 items-center justify-center">
          <Send size={12} color="#ffffff" />
        </View>
      </View>
    </View>
  </Animated.View>
);

const StreakCard = () => (
  <Animated.View
    entering={FadeInUp.delay(300).duration(500).springify()}
    className="bg-yellow-400 rounded-[2rem] p-6 flex-1 flex-col justify-between h-48 relative overflow-hidden"
    style={{ borderCurve: 'continuous' }}
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
      <View>
        <View className="flex-row items-baseline gap-1">
          <Text style={styles.streakValue}>6</Text>
          <Text style={styles.streakUnit}>Days</Text>
        </View>
        <View className="mt-1 bg-slate-900/10 px-2 py-1 rounded-lg" style={{ borderCurve: 'continuous' }}>
          <Text style={styles.streakGoal}>Goal: 30 Days</Text>
        </View>
      </View>

      <View className="h-10 flex-row items-end gap-1">
        {[0.4, 0.6, 0.3, 0.7, 0.5, 0.9, 1].map((h, i) => (
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

// -----------------------------------------------------
// Recently Scanned
// -----------------------------------------------------

const RecentlyScanned = () => {
  const { addSupplement, savedSupplements } = useSavedSupplements();
  const { scans } = useScanHistory();
  const { t } = useTranslation();
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
  const buildKey = useCallback(
    (productName: string, brandName: string) => `name:${normalize(brandName)}:${normalize(productName)}`,
    [normalize],
  );

  const savedKeys = useMemo(
    () => new Set(savedSupplements.map(item => buildKey(item.productName, item.brandName))),
    [buildKey, savedSupplements],
  );

  const items = useMemo(() => scans.slice(0, 3), [scans]);

  const handleSave = (item: ScanHistoryItem) => {
    if (savingIds[item.id]) return;
    if (savedKeys.has(buildKey(item.productName, item.brandName))) return;

    setSavingIds(prev => ({ ...prev, [item.id]: true }));
    addSupplement({
      barcode: item.barcode ?? null,
      productName: item.productName,
      brandName: item.brandName,
      dosageText: item.dosageText || item.category || '',
    });

    setTimeout(() => {
      setSavingIds(prev => ({ ...prev, [item.id]: false }));
    }, 240);
  };

  return (
    <Animated.View
      entering={FadeInUp.delay(600).duration(500)}
      className="bg-blue-300 rounded-[2rem] p-6 pb-24"
      style={{ borderCurve: 'continuous' }}
    >
      <View className="flex-row justify-between items-start mb-4">
        <View>
          <Text style={styles.recentTitle}>Recently Scanned</Text>
          <Text style={styles.recentSubtitle}>Today</Text>
        </View>

        <AnimatedPressable
          onPress={() => {}}
          className="w-10 h-10 rounded-full border border-slate-700/10 items-center justify-center bg-white/20"
          style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.95 : 1 }] }, { borderCurve: 'continuous' }]}
        >
          <ScanBarcode size={20} color="#0f172a" />
        </AnimatedPressable>
      </View>

      <View style={{ gap: 8 }}>
        {items.length === 0 ? (
          <View className="rounded-2xl bg-white/20 border border-white/10 p-4" style={{ borderCurve: 'continuous' }}>
            <Text style={styles.recentEmpty}>{t.emptyScans}</Text>
          </View>
        ) : (
          items.map((item, index) => {
            const isSaved = savedKeys.has(buildKey(item.productName, item.brandName));
            const isSaving = savingIds[item.id];
            const isActive = isSaved || isSaving;

            const iconConfig = getCategoryIconConfig(item.category, item.productName || '');
            const Icon = iconConfig.icon;
            const iconStyle = iconConfig.rotate ? { transform: [{ rotate: iconConfig.rotate }] } : undefined;

            return (
              <Animated.View
                key={item.id}
                entering={FadeInRight.delay(700 + index * 100).springify()}
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
                  <Text style={styles.recentItemTitle} numberOfLines={2} ellipsizeMode="tail">
                    {cleanProductName(item.productName || 'Unknown supplement')}
                  </Text>
                </View>

                <Pressable
                  onPress={() => handleSave(item)}
                  disabled={isActive}
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
              </Animated.View>
            );
          })
        )}
      </View>
    </Animated.View>
  );
};

// -----------------------------------------------------
// Refined Bottom Nav + 1:1 Floating Menu (原样保留)
// -----------------------------------------------------

type TabId = 'home' | 'progress' | 'saved' | 'profile';
type TabType = 'text' | 'icon';

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
        item.id === 'home' ? { marginRight: 'auto' } : {},
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
}: {
  currentTab: TabId;
  onTabChange: (tab: TabId) => void;
}) => {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(0, insets.bottom - BOTTOM_INSET_TRIM);
  const bottomFadeHeight = Math.max(160, bottomInset + BOTTOM_FADE_EXTRA);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const activeId = useSharedValue<TabId>(currentTab);

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

      <View pointerEvents="box-none" style={[styles.bottomBarContainer, { paddingBottom: bottomInset }]}>
        <View
          pointerEvents="none"
          style={[
            styles.bottomFade,
            {
              left: -24,
              right: -24,
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
            <BlurView intensity={32} tint="light" style={StyleSheet.absoluteFill} />
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

        <View style={styles.outerWrapper}>
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
                  <View key={tab.id} onLayout={onTabLayout(tab.id, tab.type, tab.activeColor)} style={tab.id === 'home' ? { marginRight: 'auto' } : {}}>
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
                  labelTop="Text"
                  labelBottom="Scan"
                  Icon={ScanText}
                  delay={100}
                  onPress={() => router.push('/scan/label')}
                />
                <FloatingMenuItem
                  labelTop="Barcode"
                  labelBottom="Scan"
                  Icon={ScanBarcode}
                  delay={0}
                  onPress={() => router.push('/scan/barcode')}
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
            paddingHorizontal: tokens.pageX,
          },
        ]}
      >
        <View style={styles.screenHeaderRow}>
          <Text style={[styles.h1, { fontSize: tokens.h1Size, lineHeight: tokens.h1Line }]} maxFontSizeMultiplier={1.2}>
            NuTri
          </Text>
        </View>

        <WeekdaySelector />

        <View style={styles.sectionBlock}>
          <SavedSupplements />
        </View>

        <View style={styles.sectionBlock}>
          <View style={styles.stack16}>
            <ProgressCard />
            <View style={styles.row16}>
              <NutriChatCard />
              <StreakCard />
            </View>
          </View>
        </View>

        <View style={styles.sectionBlock}>
          <RecentlyScanned />
        </View>
      </ScrollView>
    </View>
  );
};

const ProfileTab = () => {
  const tokens = useScreenTokens(NAV_HEIGHT);
  const contentTopPadding = tokens.contentTopPadding;
  const contentBottomPadding = tokens.contentBottomPadding;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: contentTopPadding, bottom: contentBottomPadding }}
        contentContainerStyle={{
          paddingTop: contentTopPadding,
          paddingBottom: contentBottomPadding,
          paddingHorizontal: tokens.pageX,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.screenHeaderRow}>
          <Text style={[styles.h1, { fontSize: tokens.h1Size, lineHeight: tokens.h1Line }]} maxFontSizeMultiplier={1.2}>
            Profile
          </Text>
        </View>
        <View>
          <Text style={styles.placeholderText}>Profile</Text>
        </View>
      </ScrollView>
    </View>
  );
};

// -----------------------------------------------------
// Main Screen
// -----------------------------------------------------

export default function MainScreen() {
  const [currentTab, setCurrentTab] = useState<TabId>('home');
  const screenTab = useSharedValue<TabId>(currentTab);
  const { savedSupplements, removeSupplements, updateRoutine } = useSavedSupplements();

  useEffect(() => {
    screenTab.value = currentTab;
  }, [currentTab, screenTab]);

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

        <BottomNav currentTab={currentTab} onTabChange={setCurrentTab} />
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
  homeContent: {},
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
    justifyContent: 'space-between',
    gap: 4,
    marginHorizontal: -PAGE_X,
    paddingHorizontal: 4,
  },
  dayItemBase: {
    width: 48,
    height: 80,
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
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#60a5fa',
    marginTop: 8,
    borderCurve: 'continuous',
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
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: 'rgba(219,234,254,0.95)',
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

  smallCardTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: '#334155',
    letterSpacing: 0.8,
    includeFontPadding: false,
    textTransform: 'uppercase',
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
  chatBubbleText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: '#475569',
    includeFontPadding: false,
  },
  chatPlaceholder: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    color: '#94a3b8',
    includeFontPadding: false,
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
  recentActionPressable: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentActionBubble: {
    width: 24,
    height: 24,
    borderRadius: 12,
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

  // ---- Tabs container ----
  tabContainer: {
    flex: 1,
    position: 'relative',
  },
  tabScreen: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholderText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: '#94a3b8',
    includeFontPadding: false,
  },

  // ---- Bottom nav ----
  bottomBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  outerWrapper: {
    flex: 1,
    maxWidth: 380,
    marginRight: 16,
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
    justifyContent: 'space-between',
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
