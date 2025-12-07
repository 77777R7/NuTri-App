import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  BarChart2,
  Bell,
  Bookmark,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  Flame,
  Home,
  MoreHorizontal,
  Pill,
  Plus,
  ScanBarcode,
  ScanText,
  Send,
  Sparkles,
  User,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
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

// --- 核心动画库引入 ---
import { AnimatePresence, MotiView } from 'moti';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeInUp,
  FadeInRight,
  interpolateColor,
  Layout,
  runOnJS,
  runOnUI,
  useDerivedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  ZoomIn,
  ZoomOut
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';

// --- 全局定义 ---

// 创建支持动画的 Pressable
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedText = Animated.createAnimatedComponent(Text);
const AnimatedView = Animated.createAnimatedComponent(View);

// 类型定义
type SupplementItem = {
  name: string;
  dose: string;
  color: string;
  iconColor: string;
  iconBg: string;
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

// -----------------------------------------------------
// 1. New Optimized Card Component (核心优化组件)
// -----------------------------------------------------

const SupplementCheckInCard = ({
  item,
  isChecked,
  onCheckIn
}: {
  item: SupplementItem,
  isChecked: boolean,
  onCheckIn: () => void
}) => {
  // 动画共享值
  const progress = useSharedValue(isChecked ? 1 : 0);
  const scale = useSharedValue(1);

  // 监听选中状态
  useEffect(() => {
    progress.value = withSpring(isChecked ? 1 : 0, {
      mass: 1,
      damping: 15,
      stiffness: 120,
    });
  }, [isChecked, progress]);

  // 按压交互
  const handlePressIn = () => { scale.value = withSpring(0.96); };
  const handlePressOut = () => { scale.value = withSpring(1); };

  // 样式动画：缩放
  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // 样式动画：按钮背景色和缩放
  const buttonAnimatedStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(
      progress.value,
      [0, 1],
      ['rgba(255, 255, 255, 0.5)', '#10b981']
    );
    const scaleVal = 1 + (progress.value * 0.1);
    return {
      backgroundColor,
      transform: [{ scale: scaleVal }],
      borderColor: isChecked ? 'transparent' : 'rgba(255,255,255,0.4)',
    };
  });

  // 样式动画：文字颜色
  const titleTextStyle = useAnimatedStyle(() => {
    const color = interpolateColor(progress.value, [0, 1], ['#0f172a', '#047857']);
    return { color };
  });

  const subtitleTextStyle = useAnimatedStyle(() => {
    const color = interpolateColor(progress.value, [0, 1], ['#475569', '#059669']);
    return { color };
  });

  // 样式动画：成功背景透明度
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  return (
    <AnimatedPressable
      onPress={onCheckIn}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.cardContainer, containerStyle]}
      // 保留 item.color 用于背景色 (Tailwind)
      className={`${item.color} relative overflow-hidden`}
    >
      {/* 1. 磨砂玻璃背景 */}
      <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFill} />

      {/* 2. 边框层 */}
      <View style={styles.borderLayer} />

      {/* 3. 成功时的绿色高亮背景 */}
      <Animated.View style={[styles.successOverlay, overlayStyle]} />

      {/* 4. 内容层 */}
      <View style={styles.contentContainer}>
        {/* Header Row */}
        <View style={styles.headerRow}>
          <View className={`w-9 h-9 rounded-full items-center justify-center ${item.iconBg} ${item.iconColor}`}>
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

        {/* Text Row */}
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
// Header
// -----------------------------------------------------

const Header = () => {
  return (
    <Animated.View
      className="w-full flex-row justify-end mb-4 px-6 pt-2"
      entering={FadeInUp.duration(600).springify()} // 整体进场
      layout={Layout.springify()}
    >
      <AnimatedPressable
        onPress={() => { }}
        className="w-12 h-12 rounded-2xl bg-white border border-slate-100 shadow-sm items-center justify-center relative"
        // 按下时的微缩放 (Framer Motion: whileTap={{ scale: 0.95 }})
        style={({ pressed }) => ({
          transform: [{ scale: pressed ? 0.92 : 1 }]
        })}
      >
        <Bell size={20} strokeWidth={2.5} color="#64748b" />
        {/* 红点呼吸动画 */}
        <Animated.View
          entering={ZoomIn.delay(500).springify()}
          className="absolute top-3 right-3 w-2 h-2 rounded-full bg-rose-500 border-2 border-white"
        />
      </AnimatedPressable>
    </Animated.View>
  );
};

// -----------------------------------------------------
// Date Selector
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
  index: number;
};

// 1. 使用 React.memo 包裹组件，并添加对比函数
const DayItemComponent = ({ item, isSelected, onPress, index }: DayItemProps) => {
  // 动画值：0 = 未选中, 1 = 选中
  const progress = useSharedValue(isSelected ? 1 : 0);

  useEffect(() => {
    progress.value = withSpring(isSelected ? 1 : 0, {
      mass: 1,
      damping: 15,
      stiffness: 120,
      overshootClamping: false, // 允许一点点回弹过冲，更自然
    });
  }, [isSelected, progress]);

  // 背景缩放
  const bgStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: progress.value }],
  }));

  // 文字颜色插值
  const dayTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], ['#94a3b8', '#94a3b8']),
  }));

  const dateTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], ['#0f172a', '#ffffff']),
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      // 注意：这里移除了 entering 动画，因为在列表频繁交互时，entering 可能会引起冲突
      // 如果你非常想要进场动画，可以在父组件整体做，或者只在组件 mount 时做一次
      style={({ pressed }) => ({
        transform: [{ scale: pressed ? 0.95 : 1 }]
      })}
    >
      <View className={`w-12 h-20 rounded-[2rem] items-center justify-center gap-1.5 relative overflow-hidden ${isSelected ? '' : 'bg-white/50 border border-slate-100/50'}`}>
        {/* 黑色背景层 */}
        <Animated.View
          style={[
            { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0f172a', borderRadius: 32 },
            bgStyle
          ]}
        />
        <AnimatedText style={[{ fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, zIndex: 10 }, dayTextStyle]}>
          {item.day}
        </AnimatedText>
        <View className="items-center z-10">
          <AnimatedText style={[{ fontSize: 20, fontWeight: '700', lineHeight: 20 }, dateTextStyle]}>
            {item.date}
          </AnimatedText>
          {isSelected && (
            <Animated.View
              entering={ZoomIn.duration(200)}
              exiting={ZoomOut.duration(200)}
              className="w-1 h-1 bg-blue-400 rounded-full mt-1.5"
            />
          )}
        </View>
      </View>
    </AnimatedPressable>
  );
};

const DayItem = React.memo(DayItemComponent, (prevProps, nextProps) => {
  // --- 核心优化逻辑 ---
  // 只有当 isSelected 发生变化时，才允许重新渲染。
  // 即使父组件传递的 onPress 函数变了，只要选中状态没变，就不重绘。
  return prevProps.isSelected === nextProps.isSelected && prevProps.item.date === nextProps.item.date;
});

DayItem.displayName = 'DayItem';

const DateSelector = () => {
  const [selectedDate, setSelectedDate] = useState(14);
  const calendarOpacity = useSharedValue(1);

  const calendarStyle = useAnimatedStyle(() => ({
    opacity: calendarOpacity.value,
  }));

  return (
    <View className="w-full mb-2">
      <Animated.View entering={FadeInUp.duration(500)} className="mb-6">
        <Text className="text-4xl font-black tracking-tight text-slate-900 mb-3 pt-2">NuTri</Text>
        <View className="flex-row justify-between items-center">
          <Text className="text-slate-500 font-semibold text-lg">Week Days</Text>
          <AnimatedPressable
            onPressIn={() => (calendarOpacity.value = withTiming(0.5))}
            onPressOut={() => (calendarOpacity.value = withTiming(1))}
            style={[calendarStyle]}
            className="p-1 rounded-md"
          >
            <CalendarIcon size={24} color="#0f172a" />
          </AnimatedPressable>
        </View>
      </Animated.View>

      <View className="flex-row justify-between items-center w-full gap-2">
        {days.map((item, index) => (
          <DayItem
            key={item.date}
            item={item}
            index={index}
            isSelected={selectedDate === item.date}
            // 这里我们传递一个新的函数引用，但因为上面的 memo 逻辑，
            // 只有真正变成选中或变成未选中的两个组件会响应，其他5个会被拦截。
            onPress={() => setSelectedDate(item.date)}
          />
        ))}
      </View>
    </View>
  );
};

// -----------------------------------------------------
// Saved Supplements Container
// -----------------------------------------------------

const CARD_WIDTH = 160;
const CARD_HEIGHT = 112; // 调整为和新卡片高度一致
const CARD_GAP = 16;
const INDICATOR_TRACK_WIDTH = 128;
const INDICATOR_WIDTH = INDICATOR_TRACK_WIDTH / 3;
const INDICATOR_MAX_LEFT = INDICATOR_TRACK_WIDTH - INDICATOR_WIDTH;

const SavedSupplements = () => {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [checkedItems, setCheckedItems] = useState<string[]>([]);

  const supplements: SupplementItem[] = [
    {
      name: 'Omega-3',
      dose: '1000mg',
      color: 'bg-blue-100',
      iconColor: 'text-blue-700',
      iconBg: 'bg-blue-100/40',
    },
    {
      name: 'Vitamin D3',
      dose: '2000IU',
      color: 'bg-yellow-100',
      iconColor: 'text-yellow-700',
      iconBg: 'bg-yellow-100/40',
    },
    {
      name: 'Magnesium',
      dose: '400mg',
      color: 'bg-purple-100',
      iconColor: 'text-purple-700',
      iconBg: 'bg-purple-100/40',
    },
    {
      name: 'Protein',
      dose: '30g',
      color: 'bg-emerald-100',
      iconColor: 'text-emerald-700',
      iconBg: 'bg-emerald-100/40',
    },
    {
      name: 'Iron',
      dose: '65mg',
      color: 'bg-rose-100',
      iconColor: 'text-rose-700',
      iconBg: 'bg-rose-100/40',
    },
  ];

  const handleCheckIn = (name: string) => {
    if (checkedItems.includes(name)) {
      setCheckedItems(checkedItems.filter(item => item !== name));
    } else {
      setCheckedItems([...checkedItems, name]);
    }
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
    <AnimatedView
      entering={FadeInUp.delay(200).duration(500)}
      className="flex flex-col gap-4 py-4"
    >
      <View className="flex-row justify-between items-end px-1">
        <Text className="text-slate-600 font-medium text-lg">
          Daily Check-in
        </Text>
        <Pressable>
          <Text className="text-slate-400 text-sm font-medium">View All</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        decelerationRate="fast"
        // Snap settings adjusted
        snapToInterval={CARD_WIDTH + CARD_GAP}
        snapToAlignment="center"
        // 确保高度足够容纳卡片和阴影
        style={{ marginHorizontal: -24, height: CARD_HEIGHT + 20 }}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingBottom: 8,
          alignItems: 'center', // 垂直居中
        }}
      >
        {supplements.map((item, index) => (
          <View
            key={item.name}
            style={{
              marginRight: index === supplements.length - 1 ? 0 : CARD_GAP,
            }}
          >
            <SupplementCheckInCard
              item={item}
              isChecked={checkedItems.includes(item.name)}
              onCheckIn={() => handleCheckIn(item.name)}
            />
          </View>
        ))}
      </ScrollView>

      <View className="h-1.5 w-32 bg-slate-200/80 rounded-full mt-2 overflow-hidden relative self-center">
        <AnimatedView
          className="absolute top-0 left-0 h-full bg-slate-400 rounded-full"
          style={{ width: INDICATOR_WIDTH, left: scrollProgress * INDICATOR_MAX_LEFT }}
        />
      </View>
    </AnimatedView>
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
      // 替换 MotionView: 使用 entering 属性
      entering={FadeInUp.delay(300).duration(500).springify()}
      className="w-full bg-blue-800 rounded-[2rem] p-6 text-white relative overflow-hidden h-64"
    >
      <View className="flex-1 justify-between relative z-10">
        <View className="flex-row items-center gap-2">
          <View className="w-8 h-8 rounded-full border border-blue-400/30 items-center justify-center">
            <Pill size={16} color="#bfdbfe" />
          </View>
          <Text className="text-blue-100 font-medium">
            Today’s Supplement Progress
          </Text>
        </View>

        <View className="mt-auto mb-1">
          <AnimatedText
            // 替换 MotionText: 简单的进场动画
            entering={FadeInUp.delay(500).springify()}
            className="text-6xl font-bold tracking-tight text-white"
          >
            60%
          </AnimatedText>

          <View className="mt-2 gap-1">
            <View className="flex-row items-center gap-2">
              <CheckCircle2 size={16} color="#34d399" />
              <Text className="text-blue-100 text-sm font-semibold">
                Taken: 3 / 5
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              <View className="w-4 h-4 items-center justify-center">
                <View className="w-1.5 h-1.5 rounded-full bg-blue-400/50" />
              </View>
              <Text className="text-blue-300 text-sm font-medium">
                Remaining: 2
              </Text>
            </View>
          </View>

          <Text className="text-blue-200/40 text-xs mt-3 font-medium uppercase tracking-wider">
            {today}
          </Text>
        </View>
      </View>

      {/* 右下角圆环进度 */}
      <View className="absolute right-6 bottom-6 bg-white text-slate-900 rounded-2xl p-4 w-32 shadow-xl shadow-blue-900/20">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Goal
          </Text>
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
            <Text className="text-3xl font-black text-slate-900 leading-none">
              3
            </Text>
            <Text className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">
              of 5
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

const NutriChatCard = () => (
  <Animated.View
    entering={FadeInRight.delay(400).springify().damping(14)}
    className="bg-[#F8F4E3] rounded-[2rem] p-5 flex-1 flex-col justify-between h-48 relative overflow-hidden"
  >
    <View className="flex-row items-center gap-2 z-10">
      <View className="w-8 h-8 rounded-full border border-slate-300/50 items-center justify-center bg-white">
        <Sparkles size={16} color="#f59e0b" />
      </View>
      <Text className="text-slate-700 font-bold text-sm tracking-wide">
        NuTri Chat
      </Text>
    </View>

    <View className="flex-1 justify-between z-10 mt-2 mb-1">
      <View className="self-start bg-white p-3 rounded-2xl shadow-sm border border-slate-200/50 max-w-[90%]">
        <Text className="text-xs text-slate-600 font-medium leading-relaxed">
          Questions about your intake? I&apos;m here to help!
        </Text>
      </View>

      <View className="w-full h-9 bg-white/60 rounded-full border border-slate-200/60 flex-row items-center px-3 gap-2">
        <Text className="text-[10px] text-slate-400 font-medium pl-1">
          Ask AI anything...
        </Text>
        <View className="ml-auto w-6 h-6 rounded-full bg-slate-800 items-center justify-center">
          <Send size={12} color="#ffffff" />
        </View>
      </View>
    </View>
  </Animated.View>
);

const StreakCard = () => (
  <Animated.View
    entering={FadeInRight.delay(500).springify().damping(14)}
    className="bg-yellow-400 rounded-[2rem] p-6 flex-1 flex-col justify-between h-48 relative overflow-hidden"
  >
    <View className="flex-row items-center justify-between z-10">
      <View className="flex-row items-center gap-2">
        <View className="w-8 h-8 rounded-full bg-orange-500/20 items-center justify-center">
          <Flame size={16} color="#ea580c" />
        </View>
        <Text className="text-slate-900 font-bold text-sm tracking-wide">
          Streak
        </Text>
      </View>
    </View>

    <View className="z-10 mt-auto flex-row justify-between items-end">
      <View>
        <View className="flex-row items-baseline gap-1">
          <Text className="text-4xl font-black text-slate-900 tracking-tight">
            6
          </Text>
          <Text className="text-lg font-bold text-slate-700">Days</Text>
        </View>
        <View className="mt-1 bg-slate-900/10 px-2 py-1 rounded-lg">
          <Text className="text-xs font-medium text-slate-700/80">
            Goal: 30 Days
          </Text>
        </View>
      </View>

      <View className="h-10 flex-row items-end gap-1">
        {[0.4, 0.6, 0.3, 0.7, 0.5, 0.9, 1].map((h, i) => (
          <Animated.View
            key={i}
            entering={FadeInUp.delay(600 + i * 100).springify()}
            style={{ height: `${h * 100}%` }}
            className={`w-1.5 rounded-t-sm ${i === 6 ? 'bg-slate-900' : 'bg-slate-900/30'
              }`}
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
  const items = [
    { name: 'Avocado Toast', calories: '280 Kcal', time: '10:42 AM', icon: '🥑' },
    { name: 'Almond Milk', calories: '60 Kcal', time: '09:15 AM', icon: '🥛' },
    { name: 'Blueberries', calories: '85 Kcal', time: '08:30 AM', icon: '🫐' },
  ];

  return (
    <Animated.View
      entering={FadeInUp.delay(600).duration(500)}
      className="bg-blue-300 rounded-[2rem] p-6 pb-24"
    >
      <View className="flex-row justify-between items-start mb-4">
        <View>
          <Text className="text-xl font-bold text-slate-900">
            Recently Scanned
          </Text>
          <Text className="text-slate-700 text-sm font-medium">Today</Text>
        </View>

        <AnimatedPressable
          onPress={() => { }}
          className="w-10 h-10 rounded-full border border-slate-700/10 items-center justify-center bg-white/20"
          style={({ pressed }) => ({
            transform: [{ scale: pressed ? 0.95 : 1 }]
          })}
        >
          <ScanBarcode size={20} color="#0f172a" />
        </AnimatedPressable>
      </View>

      <View className="gap-2">
        {items.map((item, index) => (
          <Animated.View
            key={item.name}
            entering={FadeInRight.delay(700 + index * 100).springify()}
            className="flex-row items-center justify-between p-3 rounded-2xl bg-white/20 border border-white/10"
          >
            <View className="flex-row items-center gap-3">
              <View className="w-10 h-10 rounded-xl bg-white/40 items-center justify-center">
                <Text className="text-xl">{item.icon}</Text>
              </View>
              <View>
                <Text className="font-bold text-slate-900 text-sm">
                  {item.name}
                </Text>
                <Text className="text-xs text-slate-700 font-medium">
                  {item.time}
                </Text>
              </View>
            </View>

            <View className="flex-row items-center gap-2">
              <Text className="font-bold text-slate-900 text-sm">
                {item.calories}
              </Text>
              <View className="w-6 h-6 rounded-full bg-white/40 items-center justify-center">
                <Plus size={12} color="#0f172a" />
              </View>
            </View>
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
};

// -----------------------------------------------------
// Refined Bottom Nav + 1:1 Floating Menu
// -----------------------------------------------------

type TabId = 'Home' | 'Progress' | 'Saved' | 'Profile';
type TabType = 'text' | 'icon';

// --- 新增组件：独立处理动画的 TabItem ---
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
    withTiming(activeTabId.value === item.id ? 1 : 0, { duration: 200 })
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
        item.id === 'Home' ? { marginRight: 'auto' } : {},
        { zIndex: 10 }
      ]}
    >
      <View style={styles.contentLayer}>
        {isText ? (
          <AnimatedText style={[styles.label, textStyle]}>
            {item.label}
          </AnimatedText>
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

const BottomNav = () => {
  const insets = useSafeAreaInsets();
  const [currentTab, setCurrentTab] = useState<TabId>('Home'); // 用于路由/业务
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const activeId = useSharedValue<TabId>('Home'); // UI 高亮用

  type TabItemConfig = { id: TabId; label: string; icon: any; type: TabType; activeColor?: string };

  const tabs: TabItemConfig[] = useMemo(() => ([
    { id: 'Home', label: 'Home', icon: Home, type: 'text' },
    { id: 'Progress', label: 'Progress', icon: BarChart2, type: 'icon', activeColor: '#6366f1' },
    { id: 'Saved', label: 'Saved', icon: Bookmark, type: 'icon', activeColor: '#f97316' },
    { id: 'Profile', label: 'Profile', icon: User, type: 'icon', activeColor: '#10b981' },
  ]), []);

  type TabLayout = { x: number; width: number; type: TabType; activeColor?: string };
  const layoutRef = useRef<Record<TabId, TabLayout>>({} as Record<TabId, TabLayout>);
  const tabMeta = useSharedValue<{ id: TabId; x: number; width: number; center: number; type: TabType; activeColor?: string }[]>([]);
  const pillX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const pillRadius = useSharedValue(24);
  const dragStartX = useSharedValue(0);
  const pillScale = useSharedValue(1);

  const initPillToActive = useCallback(() => {
    const meta = Object.values(layoutRef.current);
    if (meta.length !== tabs.length) return;
    const arranged = tabs.map((t) => {
      const l = layoutRef.current[t.id];
      return l ? { ...l, id: t.id, center: l.x + l.width / 2 } : null;
    }).filter(Boolean) as { id: TabId; x: number; width: number; center: number; type: TabType; activeColor?: string }[];

    if (!arranged.length) return;
    tabMeta.value = arranged;
    activeId.value = currentTab;
    const activeLayout = arranged.find((m) => m.id === currentTab);
    if (activeLayout) {
      pillX.value = activeLayout.x;
      pillWidth.value = activeLayout.width;
      pillRadius.value = activeLayout.type === 'text' ? 24 : activeLayout.width / 2;
    }
  }, [activeId, currentTab, pillRadius, pillWidth, pillX, tabMeta, tabs]);

  const onTabLayout = useCallback((id: TabId, type: TabType, activeColor?: string) => (e: any) => {
    const { x, width } = e.nativeEvent.layout;
    layoutRef.current[id] = { x, width, type, activeColor };
    if (Object.keys(layoutRef.current).length === tabs.length) {
      initPillToActive();
    }
  }, [initPillToActive, tabs.length]);

  const snapToTab = useCallback((targetId: TabId) => {
    const worklet = (id: TabId) => {
      'worklet';
      const metaList = tabMeta.value;
      if (!metaList.length) return;
      const target = metaList.find((m) => m.id === id);
      if (!target) return;

      activeId.value = id; // UI 线程即时高亮

      const radius = target.type === 'text' ? 24 : target.width / 2;
      pillWidth.value = withSpring(target.width, { damping: 14, stiffness: 220, mass: 0.9 });
      pillRadius.value = withSpring(radius, { damping: 14, stiffness: 220, mass: 0.9 });
      pillX.value = withSpring(target.x, { damping: 14, stiffness: 220, mass: 0.9 }, (finished) => {
        if (finished) runOnJS(setCurrentTab)(id);
      });
    };
    runOnUI(worklet)(targetId);
  }, [activeId, pillRadius, pillWidth, pillX, tabMeta]);

  const pillGesture = useMemo(() => Gesture.Pan()
    .onStart(() => {
      dragStartX.value = pillX.value;
      pillScale.value = withSpring(1.07, { damping: 14, stiffness: 260 });
      runOnJS(Haptics.selectionAsync)();
    })
    .onChange((event) => {
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
        activeId.value = closest.id; // UI 线程立即高亮
        runOnJS(Haptics.selectionAsync)();
      }
    })
    .onEnd(() => {
      const metaList = tabMeta.value;
      if (!metaList.length) return;
      pillScale.value = withSpring(1, { damping: 14, stiffness: 260 });

      const currentActive = activeId.value;
      const target = metaList.find((m) => m.id === currentActive) || metaList[0];
      const radius = target.type === 'text' ? 24 : target.width / 2;
      pillWidth.value = withSpring(target.width, { damping: 14, stiffness: 220, mass: 0.9 });
      pillRadius.value = withSpring(radius, { damping: 14, stiffness: 220, mass: 0.9 });
      pillX.value = withSpring(target.x, { damping: 14, stiffness: 220, mass: 0.9 }, (finished) => {
        if (finished) runOnJS(setCurrentTab)(target.id as TabId);
      });
    }), [activeId, dragStartX, pillScale, pillWidth, pillX, pillRadius, tabMeta]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }, { scale: pillScale.value }],
    width: pillWidth.value,
    borderRadius: pillRadius.value,
  }));

  return (
    <>
      {/* 1. 全局遮罩层 (点击空白处关闭) */}
      <AnimatePresence>
        {isMenuOpen && (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'timing', duration: 200 }}
            style={[StyleSheet.absoluteFill, { zIndex: 40 }]}
          >
            {/* 背景模糊层 */}
            <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFill} />
            <View className="absolute inset-0 bg-white/10" />
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsMenuOpen(false)} />
          </MotiView>
        )}
      </AnimatePresence>

      {/* 底部导航区域容器 */}
      <View
        pointerEvents="box-none"
        style={[styles.bottomBarContainer, { paddingBottom: insets.bottom }]}
      >

        {/* 2. 左侧导航栏 (Glassmorphism Bar) */}
        <View style={styles.outerWrapper}>
          <View style={styles.glassContainer}>
            <BlurView intensity={30} tint="light" style={StyleSheet.absoluteFill} />
            <View style={styles.bgOverlay} />

            <View style={styles.tabsRow}>
              {/* Layer 1: 视觉胶囊（底层） */}
              <Animated.View
                style={[
                  styles.pillContainer,
                  pillStyle,
                  { zIndex: 0 }
                ]}
                pointerEvents="none"
              >
                <View style={styles.pillBase} />
              </Animated.View>

              {/* Layer 2: 图标/文字内容 */}
              {tabs.map((tab) => (
                <View
                  key={tab.id}
                  onLayout={onTabLayout(tab.id, tab.type, tab.activeColor)}
                  style={tab.id === 'Home' ? { marginRight: 'auto' } : {}}
                >
                  <TabItem
                    item={tab}
                    activeTabId={activeId}
                    onPress={() => snapToTab(tab.id)}
                  />
                </View>
              ))}

              {/* Layer 3: 幽灵胶囊（顶层捕获手势） */}
              <GestureDetector gesture={pillGesture}>
                <Animated.View
                  style={[
                    styles.pillContainer,
                    pillStyle,
                    {
                      zIndex: 100,
                      opacity: 0,
                      backgroundColor: 'red'
                    }
                  ]}
                  pointerEvents="box-only"
                />
              </GestureDetector>
            </View>
          </View>
        </View>

        {/* 3. 右侧: 悬浮菜单 (1:1 还原区域) */}
        <View className="relative items-center justify-center">

          <AnimatePresence>
            {isMenuOpen && (
              <MotiView
                className="absolute bottom-20 right-0 flex-col gap-5 items-end min-w-[200px] z-40 mb-2"
                from={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {/* Text Scan Option */}
                <FloatingMenuItem
                  labelTop="Text"
                  labelBottom="Scan"
                  Icon={ScanText}
                  delay={100}
                  onPress={() => router.push('/scan/label')}
                />

                {/* Barcode Scan Option */}
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

          {/* 主 FAB 按钮 */}
          <Pressable onPress={() => {
            Haptics.selectionAsync();
            setIsMenuOpen(!isMenuOpen);
          }}>
            <MotiView
              animate={{ rotate: isMenuOpen ? '45deg' : '0deg' }}
              transition={{ type: 'timing', duration: 180 }}
              className={`
                w-16 h-16 rounded-full 
                border border-white/60 
                items-center justify-center 
                shadow-2xl overflow-hidden z-50
                ${isMenuOpen ? 'bg-slate-900' : 'bg-blue-400/30'}
              `}
              style={{
                shadowColor: isMenuOpen ? "#0f172a" : "#60a5fa",
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.3,
                shadowRadius: 12,
                elevation: 10
              }}
            >
              {/* 只有在未打开时显示毛玻璃，打开变纯黑 */}
              {!isMenuOpen && (
                <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
              )}

              <Plus
                size={32}
                strokeWidth={2.5}
                color={isMenuOpen ? 'white' : '#0f172a'}
              />
            </MotiView>
          </Pressable>
        </View>
      </View>
    </>
  );
};

// -----------------------------------------------------
// Helper Component for Menu Items (Animation Logic)
// -----------------------------------------------------

function FloatingMenuItem({ labelTop, labelBottom, Icon, delay, onPress }: any) {
  return (
    <MotiView
      from={{ opacity: 0, translateY: 12, scale: 0.95 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      exit={{ opacity: 0, translateY: 12, scale: 0.95 }}
      transition={{
        type: 'timing',
        duration: 180,
        delay
      }}
      className="flex-row items-center gap-4 justify-end"
    >
      <Pressable onPress={onPress} className="flex-row items-center gap-4">
        {/* Label Box */}
        <View
          className="bg-white px-6 py-3 rounded-[1.5rem] border border-white flex-col items-center"
          style={{
            shadowColor: "#cbd5e1",
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.3,
            shadowRadius: 10,
            elevation: 5
          }}
        >
          <Text className="text-sm font-black tracking-wide text-slate-900">{labelTop}</Text>
          <Text className="text-sm font-bold text-slate-600">{labelBottom}</Text>
        </View>

        {/* Icon Box */}
        <View
          className="w-16 h-16 rounded-[1.5rem] bg-white border border-white items-center justify-center"
          style={{
            shadowColor: "#cbd5e1",
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.3,
            shadowRadius: 10,
            elevation: 5
          }}
        >
          <Icon color="#334155" size={28} strokeWidth={2} />
        </View>
      </Pressable>
    </MotiView>
  );
}

// -----------------------------------------------------
// Gradual Blur Component (True Gradient)
// -----------------------------------------------------

const GradualBlur = () => {
  // 将模糊限制在导航栏下方：顶部透明，向下渐变
  return (
    <View
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 180,
        zIndex: 40,
        pointerEvents: 'none',
      }}
    >
      <MaskedView
        style={StyleSheet.absoluteFill}
        maskElement={
          <LinearGradient
            // 顶部透明，向下逐渐不透明，控制模糊只在导航栏以下
            colors={['transparent', 'transparent', 'transparent', 'rgba(0,0,0,1)']}
            locations={[0, 0.5, 0.7, 1]}
            style={StyleSheet.absoluteFill}
          />
        }
      >
        <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.4)']}
          style={StyleSheet.absoluteFill}
        />
      </MaskedView>
    </View>
  );
};

// -----------------------------------------------------
// Main Screen
// -----------------------------------------------------

export default function MainScreen() {
  return (
    <SafeAreaView className="flex-1 bg-[#F2F3F7]">
      <StatusBar style="dark" />
      <View className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerClassName="pt-6 pb-40 gap-6"
          showsVerticalScrollIndicator={false}
        >
          {/* 顶部 Header + 日期，左右有留白 */}
          <View className="px-6">
            <Header />
            <DateSelector />
          </View>

          {/* Daily Check-in，卡片贴边 */}
          <View className="mt-2 px-6">
            <SavedSupplements />
          </View>

          {/* 中部三个卡片：Progress 全宽，Chat/Streak 两列 */}
          <View className="mt-2 px-6 gap-4">
            <ProgressCard />
            <View className="flex-row gap-4">
              <NutriChatCard />
              <StreakCard />
            </View>
          </View>

          {/* Recently Scanned */}
          <View className="mt-4 px-6">
            <RecentlyScanned />
          </View>
        </ScrollView>

        <GradualBlur />

        <BottomNav />
      </View>
    </SafeAreaView>
  );
}

// -----------------------------------------------------
// Styles for New Components
// -----------------------------------------------------

const styles = StyleSheet.create({
  cardContainer: {
    width: 160,
    height: 112,
    borderRadius: 32,
    padding: 16,
    // gap 由父容器 View 处理，这里只负责阴影
    shadowColor: "#000",
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  checkboxButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    // borderColor 由动画控制
  },
  textRow: {
    marginTop: 'auto',
    gap: 2,
  },
  titleText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitleText: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.9,
  },
  bottomBarContainer: {
    position: 'absolute',
    bottom: -16, // 进一步向下偏移
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
    shadowColor: "#4b5563",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 8,
  },
  glassContainer: {
    borderRadius: 100,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.65)',
    backgroundColor: 'rgba(255,255,255,0.28)', // 更透的毛玻璃底色
  },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.12)', // 轻薄雾面层
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8, // 贴近 web: px-1
    paddingVertical: 8, // 对称上下留白
    gap: 6,
    justifyContent: 'space-between',
    position: 'relative',
  },
  tabItem: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    height: 44, // 贴近 web w-11/h-11
    zIndex: 2,
  },
  tabItemText: {
    paddingHorizontal: 20, // px-5
    paddingVertical: 10, // py-2.5
    borderRadius: 22,
  },
  tabItemIcon: {
    width: 44,
    borderRadius: 22,
  },
  contentLayer: {
    zIndex: 10,
    pointerEvents: 'none',
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  pillContainer: {
    position: 'absolute',
    top: 8, // 与 tabsRow padding 对齐，垂直居中
    left: 0,
    height: 44,
    overflow: 'hidden',
    zIndex: 1, // 在图标下方，仍可捕获手势
    pointerEvents: 'box-only',
  },
  pillBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF', // 纯白胶囊
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)', // 细白描边，贴近 web
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    pointerEvents: 'none',
  },
  pillHighlight: {
    position: 'absolute',
    top: 3,
    left: 8,
    right: 8,
    height: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.45)',
    opacity: 0.75,
  }
});
