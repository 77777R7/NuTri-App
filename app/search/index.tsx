import { useScreenTokens } from '@/hooks/useScreenTokens';
import { useFullBleed } from '@/hooks/useFullBleed';
import { apiClient, type SearchAPIResponse, type SearchSupplement } from '@/lib/api-client';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, router } from 'expo-router';
import { MotiView } from 'moti';
import { ArrowLeft, ChevronRight, Search, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

type Category =
  | 'All'
  | 'Vitamins'
  | 'Minerals'
  | 'Herbs'
  | 'Probiotics'
  | 'Protein';

const NAV_HEIGHT = 0;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const CATEGORIES: Category[] = [
  'All',
  'Vitamins',
  'Minerals',
  'Herbs',
  'Probiotics',
  'Protein',
];
const SEARCH_REQUEST_TIMEOUT_MS = 8000;

const CATEGORY_STYLES: Record<string, { pillBg: string; pillText: string; pillBorder: string }> = {
  Vitamins: {
    pillBg: '#FEF3C6',
    pillText: '#BB4D00',
    pillBorder: '#FEE685',
  },
  Minerals: {
    pillBg: '#E0E7FF',
    pillText: '#432DD7',
    pillBorder: '#C6D2FF',
  },
  Herbs: {
    pillBg: '#D0FAE5',
    pillText: '#007A55',
    pillBorder: '#A4F4CF',
  },
  Probiotics: {
    pillBg: '#E0F2FE',
    pillText: '#0F6CBD',
    pillBorder: '#BAE6FD',
  },
  Protein: {
    pillBg: '#FFE4E6',
    pillText: '#C70036',
    pillBorder: '#FFCCD3',
  },
  Essential: {
    pillBg: '#DBEAFE',
    pillText: '#1447E6',
    pillBorder: '#BEDBFF',
  },
  'Amino Acids': {
    pillBg: '#F3E8FF',
    pillText: '#8200DB',
    pillBorder: '#E9D4FF',
  },
  Supplement: {
    pillBg: '#F1F5F9',
    pillText: '#314158',
    pillBorder: '#E2E8F0',
  },
};

const resolveSearchPayload = (response: SearchAPIResponse) => ('data' in response ? response.data : response);

const SearchPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<Category>('All');
  const [results, setResults] = useState<SearchSupplement[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultsTransitionKey, setResultsTransitionKey] = useState(0);
  const tokens = useScreenTokens(NAV_HEIGHT);
  const { bleedStyle, contentStyle } = useFullBleed(tokens.pageX);
  const scrollY = useSharedValue(0);
  const hasMountedRef = useRef(false);

  const contentScale = clamp(Math.min(tokens.width, 430) / 390, 0.92, 1.06);
  const horizontalPadding = tokens.pageX;
  const topPadding = clamp(Math.round(6 * contentScale), 4, 8);
  const bottomPadding = Math.max(tokens.insets.bottom + 18, 28);
  const sectionGap = clamp(Math.round(tokens.sectionGap * 0.88), 14, 24);
  const titleSize = clamp(tokens.h1Size - 5, 28, 36);
  const titleLineHeight = clamp(tokens.h1Line - 6, 30, 40);
  const searchHeight = clamp(Math.round(48 * contentScale), 44, 52);
  const chipHeight = clamp(Math.round(36 * contentScale), 32, 40);
  const cardRadius = clamp(Math.round(22 * contentScale), 18, 24);
  const cardMinHeight = clamp(Math.round(114 * contentScale), 106, 126);
  const cardPaddingX = clamp(Math.round(16 * contentScale), 14, 18);
  const cardPaddingY = clamp(Math.round(15 * contentScale), 13, 18);
  const titleFontSize = clamp(Math.round(16 * contentScale), 15, 17);
  const benefitFontSize = clamp(Math.round(13 * contentScale), 12, 14);
  const doseFontSize = clamp(Math.round(12.5 * contentScale), 12, 13);
  const chipFontSize = clamp(Math.round(13 * contentScale), 12, 14);
  const categoryFontSize = clamp(Math.round(10.5 * contentScale), 10, 11);
  const actionSize = clamp(Math.round(36 * contentScale), 32, 40);
  const imageSize = clamp(Math.round(54 * contentScale), 46, 58);
  const isNarrow = tokens.width < 380;
  const headerTitleGap = clamp(Math.round(sectionGap * 0.7), 12, 18);
  const headerOverlayHeight =
    topPadding +
    36 +
    headerTitleGap +
    titleLineHeight * 2 +
    clamp(Math.round(14 * contentScale), 10, 18);
  const headerMaskHeight = headerOverlayHeight + clamp(Math.round(26 * contentScale), 18, 30);
  const titleExitStart = clamp(Math.round(14 * contentScale), 10, 18);
  const titleExitEnd = clamp(Math.round(54 * contentScale), 42, 68);
  const rowExitStart = clamp(Math.round(42 * contentScale), 32, 52);
  const rowExitEnd = clamp(Math.round(94 * contentScale), 72, 110);
  const searchFadeStart = clamp(Math.round(92 * contentScale), 76, 108);
  const searchFadeEnd = clamp(Math.round(154 * contentScale), 126, 176);
  const railFadeStart = clamp(Math.round(110 * contentScale), 92, 128);
  const railFadeEnd = clamp(Math.round(184 * contentScale), 148, 208);
  const debouncedQuery = useMemo(() => searchQuery.trim(), [searchQuery]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    setResultsTransitionKey((value) => value + 1);
  }, [activeFilter]);

  useEffect(() => {
    const controller = new AbortController();
    let didTimeout = false;

    const debounceTimeout = setTimeout(async () => {
      const requestTimeout = setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, SEARCH_REQUEST_TIMEOUT_MS);

      try {
        setLoading(true);
        setErrorMessage(null);

        const response = await apiClient.search(
          {
            query: debouncedQuery,
            category: activeFilter !== 'All' ? activeFilter : undefined,
            page: 1,
            limit: 20,
          },
          {
            signal: controller.signal,
          },
        );

        const payload = resolveSearchPayload(response);
        setResults(payload.supplements ?? []);
      } catch (error) {
        if (controller.signal.aborted && !didTimeout) return;
        setErrorMessage(
          didTimeout
            ? 'Search is still warming up. Please try again in a moment.'
            : error instanceof Error
              ? error.message
              : 'Search failed',
        );
        setResults([]);
      } finally {
        clearTimeout(requestTimeout);
        if (!controller.signal.aborted || didTimeout) {
          setLoading(false);
        }
      }
    }, debouncedQuery.length >= 2 ? 220 : 80);

    return () => {
      controller.abort();
      clearTimeout(debounceTimeout);
    };
  }, [activeFilter, debouncedQuery]);

  const handleScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  const headerRowAnimatedStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      [rowExitStart, rowExitEnd],
      [0, 1],
      Extrapolation.CLAMP,
    );

    return {
      opacity: 1 - progress,
      transform: [{ translateY: -4 * progress }],
    };
  });

  const headerTitleAnimatedStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      [titleExitStart, titleExitEnd],
      [0, 1],
      Extrapolation.CLAMP,
    );

    return {
      opacity: 1 - progress,
      transform: [{ translateY: -titleExitEnd * 0.82 * progress }],
    };
  });

  const headerOverlayAnimatedStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      [rowExitStart, rowExitEnd],
      [0, 1],
      Extrapolation.CLAMP,
    );

    return {
      opacity: 1 - progress * 0.22,
    };
  });

  const searchSecondaryAnimatedStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      [searchFadeStart, searchFadeEnd],
      [0, 1],
      Extrapolation.CLAMP,
    );

    return {
      opacity: 1 - progress * 0.18,
      transform: [{ translateY: -1.5 * progress }],
    };
  });

  const filterSecondaryAnimatedStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      [railFadeStart, railFadeEnd],
      [0, 1],
      Extrapolation.CLAMP,
    );

    return {
      opacity: 1 - progress * 0.16,
      transform: [{ translateY: -1.5 * progress }],
    };
  });

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.screen}>
          <LinearGradient
            colors={['#F9FAFC', '#F3F6FA']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          <Animated.View
            pointerEvents="box-none"
            style={[
              styles.headerOverlay,
              {
                height: headerMaskHeight,
                paddingTop: topPadding,
                paddingHorizontal: horizontalPadding,
              },
              headerOverlayAnimatedStyle,
            ]}
          >
            <MotiView
              from={{ opacity: 0, translateY: 8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 340, delay: 40 }}
            >
              <Animated.View style={[styles.headerRow, headerRowAnimatedStyle]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.back()}
                  style={styles.backButton}
                >
                  <ArrowLeft size={22} color="#14213D" strokeWidth={2.3} />
                </Pressable>

                <View style={styles.headerPill}>
                  <Text style={styles.headerPillText}>Database</Text>
                </View>

                <View style={styles.headerSpacer} />
              </Animated.View>

              <Animated.View
                style={[
                  styles.headerTitleWrap,
                  { marginTop: headerTitleGap },
                  headerTitleAnimatedStyle,
                ]}
              >
                <Text
                  style={[
                    styles.heroTitle,
                    {
                      fontSize: titleSize,
                      lineHeight: titleLineHeight,
                    },
                  ]}
                >
                  Find your{'\n'}
                  supplement.
                </Text>
              </Animated.View>
            </MotiView>
          </Animated.View>

          <Animated.ScrollView
            bounces
            showsVerticalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            contentContainerStyle={{
              paddingTop: headerOverlayHeight,
              paddingBottom: bottomPadding,
            }}
          >
            <Animated.View
              style={[
                styles.frame,
                {
                  paddingHorizontal: horizontalPadding,
                  gap: sectionGap,
                },
              ]}
            >
              <MotiView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'timing', duration: 360, delay: 120 }}
              >
                <Animated.View style={searchSecondaryAnimatedStyle}>
                  <View style={[styles.searchInputWrap, { minHeight: searchHeight }]}>
                    <Search size={18} color="#8E98AD" strokeWidth={2.2} />
                    <TextInput
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      placeholder="Search by name, brand, or goal..."
                      placeholderTextColor="rgba(142,152,173,0.78)"
                      style={[styles.searchInput, { fontSize: benefitFontSize + 1 }]}
                    />
                    {searchQuery ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setSearchQuery('')}
                        style={styles.clearButton}
                      >
                        <X size={13} color="#7B879C" strokeWidth={2.4} />
                      </Pressable>
                    ) : null}
                  </View>
                </Animated.View>
              </MotiView>

              <MotiView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'timing', duration: 360, delay: 160 }}
              >
                <Animated.View style={filterSecondaryAnimatedStyle}>
                  <View style={[styles.filterRailShell, bleedStyle]}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={[styles.filterRail, contentStyle]}
                    >
                      {CATEGORIES.map((category) => {
                        const isActive = activeFilter === category;

                        return (
                          <Pressable
                            key={category}
                            onPress={() => setActiveFilter(category)}
                            style={[
                              styles.filterChip,
                              { height: chipHeight, borderRadius: chipHeight / 2 },
                              isActive ? styles.filterChipActive : styles.filterChipInactive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.filterChipText,
                                { fontSize: chipFontSize },
                                isActive
                                  ? styles.filterChipTextActive
                                  : styles.filterChipTextInactive,
                              ]}
                            >
                              {category === 'Probiotics' && isNarrow ? 'Probiotic' : category}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>

                    <LinearGradient
                      pointerEvents="none"
                      colors={['rgba(247,248,251,0.58)', 'rgba(247,248,251,0)']}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={[styles.railFade, styles.railFadeLeft]}
                    />
                    <LinearGradient
                      pointerEvents="none"
                      colors={['rgba(247,248,251,0)', 'rgba(247,248,251,0.58)']}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={[styles.railFade, styles.railFadeRight]}
                    />
                  </View>
                </Animated.View>
              </MotiView>

              {loading && results.length === 0 ? (
                <View style={styles.resultsList}>
                  {Array.from({ length: 6 }).map((_, index) => (
                    <View key={`skeleton-${index}`} style={styles.resultRow}>
                      <View
                        style={[
                          styles.resultCard,
                          styles.resultCardSkeleton,
                          {
                            minHeight: cardMinHeight,
                            borderRadius: cardRadius,
                            paddingHorizontal: cardPaddingX,
                            paddingVertical: cardPaddingY,
                          },
                        ]}
                      >
                        <View style={styles.resultContentRow}>
                          <View
                            style={[
                              styles.skeletonImage,
                              {
                                width: imageSize,
                                height: imageSize,
                                borderRadius: Math.round(imageSize * 0.24),
                                marginRight: 12,
                              },
                            ]}
                          />
                          <View style={styles.resultCopy}>
                            <View style={[styles.skeletonLine, styles.skeletonTitle]} />
                            <View style={[styles.skeletonLine, styles.skeletonBenefit]} />
                            <View style={styles.resultMetaRow}>
                              <View style={styles.skeletonTag} />
                              <View style={[styles.skeletonLine, styles.skeletonDose]} />
                            </View>
                          </View>
                        </View>
                        <View style={styles.resultAction}>
                          <View
                            style={[
                              styles.resultActionCircle,
                              styles.resultActionCircleSkeleton,
                              {
                                width: actionSize,
                                height: actionSize,
                                borderRadius: actionSize / 2,
                              },
                            ]}
                          />
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ) : results.length > 0 ? (
                <View key={`results-${resultsTransitionKey}`} style={styles.resultsList}>
                  {results.map((item, index) => {
                    const categoryStyle = CATEGORY_STYLES[item.category] ?? CATEGORY_STYLES.Supplement;
                    return (
                    <MotiView
                      key={`${resultsTransitionKey}-${item.id}`}
                      from={{ opacity: 0, translateY: 12 }}
                      animate={{ opacity: 1, translateY: 0 }}
                      transition={{
                        type: 'timing',
                        duration: 320,
                        delay: 200 + index * 34,
                      }}
                    >
                      <Pressable style={styles.resultRow}>
                        <View
                          style={[
                            styles.resultCard,
                            {
                              minHeight: cardMinHeight,
                              borderRadius: cardRadius,
                              paddingHorizontal: cardPaddingX,
                              paddingVertical: cardPaddingY,
                            },
                          ]}
                        >
                          <View style={styles.resultContentRow}>
                            <View
                              style={[
                                styles.resultImageWrap,
                                {
                                  width: imageSize,
                                  height: imageSize,
                                  borderRadius: Math.round(imageSize * 0.24),
                                  marginRight: 12,
                                },
                              ]}
                            >
                              {item.imageUrl ? (
                                <Image
                                  source={{ uri: item.imageUrl }}
                                  style={styles.resultImage}
                                  resizeMode="contain"
                                />
                              ) : (
                                <View style={styles.resultImageFallback}>
                                  <Text style={styles.resultImageFallbackText}>
                                    {item.category.slice(0, 1).toUpperCase()}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <View style={styles.resultCopy}>
                              <Text
                                numberOfLines={2}
                                style={[
                                  styles.resultTitle,
                                  { fontSize: titleFontSize, lineHeight: titleFontSize * 1.22 },
                                ]}
                              >
                                {item.name}
                              </Text>
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.resultBenefit,
                                  {
                                    fontSize: benefitFontSize,
                                    lineHeight: benefitFontSize * 1.45,
                                  },
                                ]}
                              >
                                {item.benefit}
                              </Text>

                              <View style={styles.resultMetaRow}>
                                <View
                                  style={[
                                    styles.categoryTag,
                                    {
                                      backgroundColor: categoryStyle.pillBg,
                                      borderColor: categoryStyle.pillBorder,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.categoryTagText,
                                      {
                                        color: categoryStyle.pillText,
                                        fontSize: categoryFontSize,
                                      },
                                    ]}
                                  >
                                    {item.category}
                                  </Text>
                                </View>
                                {item.dose ? (
                                  <Text style={[styles.doseText, { fontSize: doseFontSize }]}>
                                    {item.dose}
                                  </Text>
                                ) : null}
                              </View>
                            </View>
                          </View>

                          <View style={styles.resultAction}>
                            <View
                              style={[
                                styles.resultActionCircle,
                                {
                                  width: actionSize,
                                  height: actionSize,
                                  borderRadius: actionSize / 2,
                                },
                              ]}
                            >
                              <ChevronRight
                                size={Math.round(actionSize * 0.54)}
                                color="#4A67FF"
                                strokeWidth={2.75}
                              />
                            </View>
                          </View>
                        </View>
                      </Pressable>
                    </MotiView>
                    );
                  })}
                </View>
              ) : (
                <MotiView
                  key={`empty-${resultsTransitionKey}`}
                  from={{ opacity: 0, translateY: 12 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'timing', duration: 320, delay: 180 }}
                  style={styles.emptyState}
                >
                  <View style={styles.emptyIconWrap}>
                    <Search size={28} color="#7B879C" strokeWidth={2.1} />
                  </View>
                  <Text style={styles.emptyTitle}>
                    {errorMessage ? 'Search unavailable' : 'No supplements found'}
                  </Text>
                  <Text style={styles.emptyBody}>
                    {errorMessage
                      ? 'The catalog could not load right now. Please try again in a moment.'
                      : 'Try searching with a different keyword or ingredient name.'}
                  </Text>
                </MotiView>
              )}
            </Animated.View>
          </Animated.ScrollView>
        </View>
      </SafeAreaView>
    </>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F8FB',
  },
  screen: {
    flex: 1,
    backgroundColor: '#F7F8FB',
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    overflow: 'hidden',
  },
  frame: {
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerPill: {
    minWidth: 92,
    height: 34,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  headerPillText: {
    color: '#14213D',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  headerSpacer: {
    width: 36,
    height: 36,
  },
  headerTitleWrap: {
    width: '100%',
  },
  heroTitle: {
    color: '#14213D',
    fontWeight: '800',
    letterSpacing: -0.9,
  },
  searchInputWrap: {
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    color: '#24324B',
    fontWeight: '500',
    paddingVertical: 10,
    letterSpacing: -0.2,
  },
  clearButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRailShell: {
    position: 'relative',
  },
  filterRail: {
    gap: 8,
    paddingLeft: 8,
    paddingRight: 12,
  },
  railFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 12,
  },
  railFadeLeft: {
    left: 0,
  },
  railFadeRight: {
    right: 0,
  },
  filterChip: {
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: {
    backgroundColor: '#0F1E46',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  filterChipInactive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  filterChipText: {
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  filterChipTextInactive: {
    color: '#7C8AA5',
  },
  resultsList: {
    gap: 12,
  },
  resultRow: {
    borderRadius: 22,
  },
  resultCard: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#0F172A',
    shadowOpacity: 0.03,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  resultCardSkeleton: {
    backgroundColor: '#FFFFFF',
  },
  resultContentRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  resultImageWrap: {
    overflow: 'hidden',
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultImage: {
    width: '100%',
    height: '100%',
  },
  resultImageFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2F7',
  },
  resultImageFallbackText: {
    color: '#91A0B8',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  resultCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  resultTitle: {
    color: '#14213D',
    fontWeight: '700',
    letterSpacing: -0.45,
  },
  resultBenefit: {
    marginTop: 5,
    fontWeight: '500',
    color: '#73819B',
    letterSpacing: -0.18,
  },
  resultMetaRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryTag: {
    minHeight: 24,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  categoryTagText: {
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.55,
  },
  doseText: {
    marginLeft: 8,
    fontWeight: '600',
    color: '#95A3B8',
    letterSpacing: -0.08,
  },
  resultAction: {
    marginLeft: 10,
    alignSelf: 'center',
  },
  resultActionCircle: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  resultActionCircleSkeleton: {
    backgroundColor: '#F3F6FA',
    shadowOpacity: 0,
    elevation: 0,
  },
  skeletonImage: {
    backgroundColor: '#EEF2F7',
  },
  skeletonLine: {
    borderRadius: 999,
    backgroundColor: '#EEF2F7',
  },
  skeletonTitle: {
    width: '62%',
    height: 16,
  },
  skeletonBenefit: {
    width: '54%',
    height: 12,
    marginTop: 9,
  },
  skeletonTag: {
    width: 84,
    height: 24,
    borderRadius: 7,
    backgroundColor: '#EEF2F7',
  },
  skeletonDose: {
    width: 56,
    height: 12,
    marginLeft: 8,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 80,
  },
  emptyIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#EEF2F7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#14213D',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
    color: '#73819B',
    textAlign: 'center',
    letterSpacing: -0.12,
  },
});

export default SearchPage;
