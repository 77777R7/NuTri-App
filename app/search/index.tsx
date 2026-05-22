import { useScreenTokens } from '@/hooks/useScreenTokens';
import { useFullBleed } from '@/hooks/useFullBleed';
import { usePremiumAccess } from '@/hooks/usePremiumAccess';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  apiClient,
  type ProductSearchCatalogStats,
  type SearchAPIResponse,
  type SearchBootstrapAPIResponse,
  type SearchResponse,
  type SearchSupplement,
} from '@/lib/api-client';
import { buildOfficialPaywallParams, getProductSearchGateDecision } from '@/lib/pro/featureGates';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, router } from 'expo-router';
import { MotiView } from 'moti';
import { ArrowLeft, ChevronRight, Search, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
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
  | 'Essential'
  | 'Amino Acids'
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
  'Essential',
  'Amino Acids',
  'Probiotics',
  'Protein',
];
const SEARCH_REQUEST_TIMEOUT_MS = 8000;
const SEARCH_LOAD_MORE_TIMEOUT_MS = 10000;
const SEARCH_BOOTSTRAP_STORAGE_KEY = 'product-search-bootstrap-v7';
const SEARCH_BOOTSTRAP_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const SEARCH_PAGE_LIMIT = 20;
const RESULT_SEPARATOR_HEIGHT = 10;

const buildSearchRequestKey = (category: Category, query: string, page = 1) =>
  `${category}::${query.trim().toLowerCase()}::${page}`;

const resolveSearchBootstrapPayload = (response: SearchBootstrapAPIResponse) =>
  'data' in response ? response.data : response;

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

const buildBrandMonogram = (brand: string) => {
  const parts = brand
    .split(/[\s&'’.-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return 'N';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
};

type StoredSearchBootstrap = {
  savedAt: number;
  categories: Partial<Record<Category, SearchSupplement[]>>;
  paginationByCategory?: Partial<Record<Category, SearchResponse['pagination']>>;
  catalogStats?: ProductSearchCatalogStats | null;
};

const bootstrapPayloadHasContinuationContract = (
  payload: Pick<StoredSearchBootstrap, 'categories' | 'paginationByCategory'>,
): boolean => {
  const allRows = payload.categories?.All;
  if (!Array.isArray(allRows) || allRows.length === 0) return false;
  if (!allRows.every(hasNavigableProductId)) return false;

  const hasInvalidCategoryRows = Object.values(payload.categories ?? {}).some(
    (rows) => Array.isArray(rows) && rows.some((item) => !hasNavigableProductId(item)),
  );
  if (hasInvalidCategoryRows) return false;

  const allPagination = payload.paginationByCategory?.All;
  const total = allPagination?.total ?? allRows.length;
  const shown = allPagination?.shown ?? allRows.length;

  return (
    allRows.length > SEARCH_PAGE_LIMIT ||
    allPagination?.hasMore === true ||
    (Number.isFinite(total) && total > shown)
  );
};

const storedBootstrapHasContinuationContract = (payload: StoredSearchBootstrap): boolean =>
  bootstrapPayloadHasContinuationContract(payload);

const isCategory = (value: string): value is Category =>
  CATEGORIES.includes(value as Category);

const buildSearchPagination = (
  supplements: SearchSupplement[],
  pagination?: SearchResponse['pagination'],
): SearchResponse['pagination'] => {
  const total = pagination?.total ?? supplements.length;
  const page = pagination?.page ?? 1;
  const limit = pagination?.limit ?? (supplements.length || SEARCH_PAGE_LIMIT);
  const totalPages = pagination?.totalPages ?? 1;
  const hasMore = pagination?.hasMore ?? page < totalPages;

  return {
    total,
    page,
    limit,
    totalPages,
    hasMore,
    nextPage: pagination?.nextPage ?? (hasMore ? page + 1 : null),
    shown: pagination?.shown ?? Math.min(total, page * limit),
    totalIsExact: pagination?.totalIsExact ?? true,
  };
};

const getResultTier = (item: SearchSupplement) => {
  if (item.resultTier) return item.resultTier;
  if (item.coverageStatus === 'coverage_ready' && item.factsStatus === 'full') {
    return 'analysis_ready';
  }
  return item.factsStatus === 'partial' ? 'basic_catalog' : 'needs_label_verification';
};

const buildCoverageLabel = (item: SearchSupplement) => {
  const tier = getResultTier(item);
  if (tier === 'analysis_ready') return 'Full facts';
  return item.resultTierLabel ?? (tier === 'basic_catalog' ? 'Basic record' : 'Needs label verification');
};

const buildResultTierDescription = (item: SearchSupplement) =>
  getResultTier(item) === 'analysis_ready'
    ? null
    : item.resultTierDescription ?? 'Not enough label detail for full analysis';

const hasNavigableProductId = (item: SearchSupplement) =>
  typeof item.productId === 'string' && item.productId.trim().length > 0;

const getNavigableSupplements = (supplements: SearchSupplement[]) =>
  supplements.filter(hasNavigableProductId);

const getSearchResultIdentity = (item: SearchSupplement) =>
  item.productId?.trim() || item.id?.trim() || item.barcode?.trim() || item.upcCode?.trim() || '';

const buildCachedSearchResponse = (
  supplements: SearchSupplement[],
  pagination?: SearchResponse['pagination'],
  catalogStats?: ProductSearchCatalogStats | null,
): SearchResponse => ({
  supplements,
  pagination: buildSearchPagination(supplements, pagination),
  suggestions: {
    categories: CATEGORIES,
    brands: [],
    popularSearches: [],
  },
  ...(catalogStats ? { catalogStats } : {}),
});

const AnimatedSearchFlatList = Animated.createAnimatedComponent(FlatList<SearchSupplement>);

type SearchResultRowProps = {
  item: SearchSupplement;
  index: number;
  onOpen: (item: SearchSupplement) => void;
  cardMinHeight: number;
  cardRadius: number;
  cardPaddingX: number;
  cardPaddingY: number;
  imageSize: number;
  actionSize: number;
  titleFontSize: number;
  benefitFontSize: number;
  doseFontSize: number;
  categoryFontSize: number;
};

const SearchResultRow = React.memo(function SearchResultRow({
  item,
  index,
  onOpen,
  cardMinHeight,
  cardRadius,
  cardPaddingX,
  cardPaddingY,
  imageSize,
  actionSize,
  titleFontSize,
  benefitFontSize,
  doseFontSize,
  categoryFontSize,
}: SearchResultRowProps) {
  const categoryStyle = CATEGORY_STYLES[item.category] ?? CATEGORY_STYLES.Supplement;
  const resultTier = getResultTier(item);
  const resultTierDescription = buildResultTierDescription(item);

  return (
    <Pressable
      accessibilityRole="button"
      disabled={!item.productId}
      onPress={() => onOpen(item)}
      style={styles.resultRow}
      testID={`product-search-result-card-${item.productId || index}`}
    >
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
        <View style={styles.resultCardBody}>
          <View style={styles.resultTopRow}>
            <View
              style={[
                styles.resultImageWrap,
                {
                  width: imageSize,
                  height: imageSize,
                  borderRadius: Math.round(imageSize * 0.24),
                  marginRight: 14,
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
                    {buildBrandMonogram(item.brand)}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.resultCopy}>
              <Text
                numberOfLines={2}
                style={[
                  styles.resultTitle,
                  { fontSize: titleFontSize, lineHeight: titleFontSize * 1.18 },
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
                    lineHeight: benefitFontSize * 1.42,
                  },
                ]}
              >
                {`${item.brand} · ${item.benefit}`}
              </Text>
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
            {item.matchReason ? (
              <View style={styles.signalTag}>
                <Text style={styles.signalTagText}>{item.matchReason}</Text>
              </View>
            ) : null}
            <View
              style={[
                styles.signalTag,
                resultTier === 'analysis_ready'
                  ? styles.signalTagReady
                  : resultTier === 'basic_catalog'
                    ? styles.signalTagBasic
                    : styles.signalTagVerification,
              ]}
            >
              <Text
                style={[
                  styles.signalTagText,
                  resultTier === 'analysis_ready'
                    ? styles.signalTagTextReady
                    : resultTier === 'basic_catalog'
                      ? styles.signalTagTextBasic
                      : styles.signalTagTextVerification,
                ]}
              >
                {buildCoverageLabel(item)}
              </Text>
            </View>
          </View>
          {resultTierDescription ? (
            <Text style={styles.resultTierDescription} numberOfLines={2}>
              {resultTierDescription}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});

const ResultSeparator = React.memo(function ResultSeparator() {
  return <View style={styles.resultSeparator} />;
});

const SearchExperience = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<Category>('All');
  const [results, setResults] = useState<SearchSupplement[]>([]);
  const [pagination, setPagination] = useState<SearchResponse['pagination']>(() =>
    buildSearchPagination([]),
  );
  const [catalogStats, setCatalogStats] = useState<ProductSearchCatalogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [resultsTransitionKey, setResultsTransitionKey] = useState(0);
  const [bootstrapStatus, setBootstrapStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>(
    'idle',
  );
  const tokens = useScreenTokens(NAV_HEIGHT);
  const { bleedStyle, contentStyle } = useFullBleed(tokens.pageX);
  const scrollY = useSharedValue(0);
  const requestSeqRef = useRef(0);
  const loadMoreSeqRef = useRef(0);
  const resultsCacheRef = useRef<Map<string, SearchResponse>>(new Map());
  const inflightResultsRef = useRef<Map<string, Promise<SearchResponse>>>(new Map());
  const bootstrapSeededRef = useRef(false);
  const bootstrapInflightRef = useRef<Promise<void> | null>(null);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const debouncedQuery = useMemo(() => searchQuery.trim(), [searchQuery]);

  const contentScale = clamp(Math.min(tokens.width, 430) / 390, 0.92, 1.06);
  const horizontalPadding = tokens.pageX;
  const topPadding = clamp(Math.round(6 * contentScale), 4, 8);
  const bottomPadding = Math.max(tokens.insets.bottom + 18, 28);
  const sectionGap = clamp(Math.round(tokens.sectionGap * 0.88), 14, 24);
  const titleSize = clamp(tokens.h1Size - 5, 28, 36);
  const titleLineHeight = clamp(tokens.h1Line - 6, 30, 40);
  const searchHeight = clamp(Math.round(48 * contentScale), 44, 52);
  const chipHeight = clamp(Math.round(36 * contentScale), 32, 40);
  const hasActiveSearch = debouncedQuery.length > 0;
  const cardRadius = clamp(Math.round(18 * contentScale), 14, 20);
  const cardMinHeight = clamp(Math.round(112 * contentScale), 100, 124);
  const cardPaddingX = clamp(Math.round(16 * contentScale), 14, 18);
  const cardPaddingY = clamp(Math.round(13 * contentScale), 12, 16);
  const titleFontSize = clamp(Math.round(16 * contentScale), 15, 17);
  const benefitFontSize = clamp(Math.round(13 * contentScale), 12, 14);
  const doseFontSize = clamp(Math.round(12.5 * contentScale), 12, 13);
  const chipFontSize = clamp(Math.round(13 * contentScale), 12, 14);
  const categoryFontSize = clamp(Math.round(10.5 * contentScale), 10, 11);
  const actionSize = clamp(Math.round(34 * contentScale), 30, 38);
  const imageSize = clamp(Math.round(54 * contentScale), 48, 60);
  const isNarrow = tokens.width < 380;
  const headerTitleGap = clamp(Math.round(sectionGap * 0.7), 12, 18);
  const headerOverlayHeight =
    topPadding +
    36 +
    headerTitleGap +
    titleLineHeight * (hasActiveSearch ? 1 : 2) +
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
  const requestKey = useMemo(
    () => buildSearchRequestKey(activeFilter, debouncedQuery),
    [activeFilter, debouncedQuery],
  );

  const seedBootstrapCategories = React.useCallback(
    (
      categories: Partial<Record<Category, SearchSupplement[]>>,
      paginationByCategory?: Partial<Record<Category, SearchResponse['pagination']>>,
      nextCatalogStats?: ProductSearchCatalogStats | null,
    ) => {
      let seededAny = false;

      for (const [category, supplements] of Object.entries(categories)) {
        if (!isCategory(category) || !Array.isArray(supplements)) continue;
        const navigableSupplements = getNavigableSupplements(supplements);
        if (navigableSupplements.length === 0) continue;
        const sourcePagination = paginationByCategory?.[category];
        const cachedPageCount = Math.max(1, Math.ceil(navigableSupplements.length / SEARCH_PAGE_LIMIT));
        const total = Math.max(sourcePagination?.total ?? 0, navigableSupplements.length);

        for (let page = 1; page <= cachedPageCount; page += 1) {
          const startIndex = (page - 1) * SEARCH_PAGE_LIMIT;
          const endIndex = startIndex + SEARCH_PAGE_LIMIT;
          const pageSupplements = navigableSupplements.slice(startIndex, endIndex);
          if (pageSupplements.length === 0) continue;

          resultsCacheRef.current.set(
            buildSearchRequestKey(category, '', page),
            buildCachedSearchResponse(pageSupplements, {
              ...(sourcePagination ?? buildSearchPagination(pageSupplements)),
              page,
              limit: SEARCH_PAGE_LIMIT,
              total,
              totalPages: Math.max(1, Math.ceil(total / SEARCH_PAGE_LIMIT)),
              shown: Math.min(endIndex, total),
              hasMore: endIndex < total,
              nextPage: endIndex < total ? page + 1 : null,
            }, nextCatalogStats),
          );
        }
        seededAny = true;
      }

      if (seededAny) {
        if (nextCatalogStats) {
          setCatalogStats(nextCatalogStats);
        }
        bootstrapSeededRef.current = true;
        setBootstrapStatus('ready');
      }
    },
    [],
  );

  const applyResolvedResults = React.useCallback(
    (payload: SearchResponse, options?: { animate?: boolean }) => {
      const nextResults = getNavigableSupplements(payload.supplements ?? []);
      setResults(nextResults);
      setPagination(buildSearchPagination(nextResults, payload.pagination));
      if (payload.catalogStats) {
        setCatalogStats(payload.catalogStats);
      }
      setErrorMessage(null);
      setLoadMoreError(null);
      if (options?.animate) {
        setResultsTransitionKey((value) => value + 1);
      }
    },
    [],
  );

  const fetchSearchResults = React.useCallback(
    async ({
      key,
      query,
      category,
      page = 1,
      signal,
    }: {
      key: string;
      query: string;
      category: Category;
      page?: number;
      signal?: AbortSignal;
    }) => {
      const cached = resultsCacheRef.current.get(key);
      if (cached) return cached;

      const inflight = inflightResultsRef.current.get(key);
      if (inflight) return inflight;

      const requestPromise = (async () => {
        const response = await apiClient.search({
          query,
          category: category !== 'All' ? category : undefined,
          page,
          limit: SEARCH_PAGE_LIMIT,
        }, signal ? { signal } : undefined);
        const payload = resolveSearchPayload(response);
        resultsCacheRef.current.set(key, payload);
        return payload;
      })();

      inflightResultsRef.current.set(key, requestPromise);

      try {
        return await requestPromise;
      } finally {
        if (inflightResultsRef.current.get(key) === requestPromise) {
          inflightResultsRef.current.delete(key);
        }
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const hydrateStoredBootstrap = async () => {
      try {
        const raw = await AsyncStorage.getItem(SEARCH_BOOTSTRAP_STORAGE_KEY);
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw) as StoredSearchBootstrap;
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          typeof parsed.savedAt !== 'number' ||
          !parsed.categories ||
          Date.now() - parsed.savedAt > SEARCH_BOOTSTRAP_MAX_AGE_MS ||
          !storedBootstrapHasContinuationContract(parsed)
        ) {
          return;
        }

        seedBootstrapCategories(parsed.categories, parsed.paginationByCategory, parsed.catalogStats);
      } catch {
        // Ignore corrupt local cache and rebuild it from the server bootstrap.
      } finally {
        if (!cancelled) {
          setStorageHydrated(true);
        }
      }
    };

    void hydrateStoredBootstrap();

    return () => {
      cancelled = true;
    };
  }, [seedBootstrapCategories]);

  useEffect(() => {
    if (!storageHydrated && debouncedQuery.length === 0) return;

    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    const cachedResults = resultsCacheRef.current.get(requestKey);
    if (cachedResults) {
      applyResolvedResults(cachedResults);
      setLoading(false);
      setErrorMessage(null);
      return;
    }

    if (debouncedQuery.length === 0 && bootstrapStatus === 'loading') {
      setLoading(true);
      setErrorMessage(null);
      return;
    }

    if (
      debouncedQuery.length === 0 &&
      !bootstrapSeededRef.current &&
      bootstrapStatus !== 'failed'
    ) {
      setLoading(true);
      setErrorMessage(null);
      return;
    }

    const controller = new AbortController();
    let didTimeout = false;
    setLoading(true);
    loadMoreSeqRef.current += 1;
    setLoadingMore(false);
    setErrorMessage(null);
    setLoadMoreError(null);
    setResults([]);
    setPagination(buildSearchPagination([]));

    const debounceTimeout = setTimeout(async () => {
      const requestTimeout = setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, SEARCH_REQUEST_TIMEOUT_MS);

      try {
        const nextResults = await fetchSearchResults({
          key: requestKey,
          query: debouncedQuery,
          category: activeFilter,
          page: 1,
          signal: controller.signal,
        });
        if (controller.signal.aborted && !didTimeout) return;
        if (requestSeq !== requestSeqRef.current) return;
        applyResolvedResults(nextResults, { animate: true });
      } catch (error) {
        if (controller.signal.aborted && !didTimeout) return;
        if (requestSeq !== requestSeqRef.current) return;
        setErrorMessage(
          didTimeout
            ? 'Search is still warming up. Please try again in a moment.'
            : error instanceof Error
              ? error.message
              : 'Search failed',
        );
        setResults([]);
        setPagination(buildSearchPagination([]));
      } finally {
        clearTimeout(requestTimeout);
        if (
          requestSeq === requestSeqRef.current &&
          (!controller.signal.aborted || didTimeout)
        ) {
          setLoading(false);
        }
      }
    }, debouncedQuery.length >= 2 ? 220 : 30);

    return () => {
      controller.abort();
      clearTimeout(debounceTimeout);
    };
  }, [
    activeFilter,
    applyResolvedResults,
    bootstrapStatus,
    debouncedQuery,
    fetchSearchResults,
    requestKey,
    storageHydrated,
  ]);

  useEffect(() => {
    if (!storageHydrated || debouncedQuery.length > 0 || bootstrapSeededRef.current) return;
    if (bootstrapInflightRef.current) return;

    let cancelled = false;

    const runBootstrap = async () => {
      setBootstrapStatus('loading');
      const bootstrapPromise = (async () => {
        try {
          const activeKey = buildSearchRequestKey(activeFilter, '');
          const activePayload = await fetchSearchResults({
            key: activeKey,
            query: '',
            category: activeFilter,
            page: 1,
          });
          if (!cancelled) {
            seedBootstrapCategories(
              { [activeFilter]: activePayload.supplements },
              { [activeFilter]: activePayload.pagination },
              activePayload.catalogStats,
            );
            applyResolvedResults(activePayload, { animate: true });
            setLoading(false);
          }
        } catch {
          // Full bootstrap below can still recover the first screen and cache.
        }

        const response = await apiClient.searchBootstrap();
        if (cancelled) return;
        const payload = resolveSearchBootstrapPayload(response);
        const nextCategories = Object.fromEntries(
          Object.entries(payload.categories ?? {}).filter(
            ([category, supplements]) => isCategory(category) && Array.isArray(supplements),
          ),
        ) as Partial<Record<Category, SearchSupplement[]>>;

        const nextPaginationByCategory = Object.fromEntries(
          Object.entries(payload.paginationByCategory ?? {}).filter(([category]) => isCategory(category)),
        ) as Partial<Record<Category, SearchResponse['pagination']>>;

        if (
          !bootstrapPayloadHasContinuationContract({
            categories: nextCategories,
            paginationByCategory: nextPaginationByCategory,
          })
        ) {
          setBootstrapStatus('failed');
          return;
        }

        seedBootstrapCategories(nextCategories, nextPaginationByCategory, payload.catalogStats);
        setBootstrapStatus('ready');
        await AsyncStorage.setItem(
          SEARCH_BOOTSTRAP_STORAGE_KEY,
          JSON.stringify({
            savedAt: Date.now(),
            categories: nextCategories,
            paginationByCategory: nextPaginationByCategory,
            catalogStats: payload.catalogStats ?? null,
          } satisfies StoredSearchBootstrap),
        );

        const currentResults = resultsCacheRef.current.get(buildSearchRequestKey(activeFilter, ''));
        if (currentResults) {
          applyResolvedResults(currentResults);
          setLoading(false);
        }
      })();

      bootstrapInflightRef.current = bootstrapPromise;

      try {
        await bootstrapPromise;
      } catch {
        if (!cancelled) {
          setBootstrapStatus('failed');
        }
        // Keep the page usable; per-filter fetches still work if bootstrap fails.
      } finally {
        if (bootstrapInflightRef.current === bootstrapPromise) {
          bootstrapInflightRef.current = null;
        }
      }
    };

    void runBootstrap();

    return () => {
      cancelled = true;
    };
  }, [
    activeFilter,
    applyResolvedResults,
    debouncedQuery,
    fetchSearchResults,
    seedBootstrapCategories,
    storageHydrated,
  ]);

  const handleOpenResult = React.useCallback((item: SearchSupplement) => {
    const productId = item.productId?.trim();
    if (!productId) return;
    router.push({ pathname: '/search/analysis', params: { productId } });
  }, []);

  const handleSelectCategory = React.useCallback((category: Category) => {
    if (category === activeFilter) return;
    setActiveFilter(category);
  }, [activeFilter]);

  const handleLoadMore = React.useCallback(async () => {
    const hasMore = pagination.hasMore ?? pagination.page < pagination.totalPages;
    if (loading || loadingMore || !hasMore) return;
    const requestSeq = requestSeqRef.current;
    const loadMoreSeq = loadMoreSeqRef.current + 1;
    loadMoreSeqRef.current = loadMoreSeq;
    const nextPage = pagination.nextPage ?? pagination.page + 1;
    const nextKey = buildSearchRequestKey(activeFilter, debouncedQuery, nextPage);
    const controller = new AbortController();
    let didTimeout = false;
    setLoadingMore(true);
    setLoadMoreError(null);

    const requestTimeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, SEARCH_LOAD_MORE_TIMEOUT_MS);

    try {
      const payload = await fetchSearchResults({
        key: nextKey,
        query: debouncedQuery,
        category: activeFilter,
        page: nextPage,
        signal: controller.signal,
      });
      if (requestSeq !== requestSeqRef.current) return;
      setResults((current) => {
        const seen = new Set(current.map(getSearchResultIdentity));
        const additions = getNavigableSupplements(payload.supplements ?? []).filter((item) => {
          const key = getSearchResultIdentity(item);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return [...current, ...additions];
      });
      setPagination(buildSearchPagination(payload.supplements ?? [], payload.pagination));
    } catch (error) {
      if (requestSeq !== requestSeqRef.current) return;
      setLoadMoreError(
        didTimeout
          ? 'More results took too long to load.'
          : error instanceof Error && error.message
            ? error.message
            : 'Could not load more results.',
      );
    } finally {
      clearTimeout(requestTimeout);
      if (loadMoreSeqRef.current === loadMoreSeq) {
        setLoadingMore(false);
      }
    }
  }, [
    activeFilter,
    debouncedQuery,
    fetchSearchResults,
    loading,
    loadingMore,
    pagination.hasMore,
    pagination.nextPage,
    pagination.page,
    pagination.totalPages,
  ]);

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

  const canLoadMore =
    !loading && results.length > 0 && (pagination.hasMore ?? pagination.page < pagination.totalPages);
  const shownCount = results.length > 0 ? results.length : pagination.shown ?? 0;
  const displayTotal = Math.max(shownCount, pagination.total);
  const catalogTotalLabel = catalogStats?.displayTotalRecordsLabel ?? '30,000+';
  const analysisReadyLabel =
    catalogStats?.displayAnalysisReadyLabel ??
    (pagination.totalIsExact === false ? `${displayTotal}+` : String(pagination.total || 0));
  const resultSummary = loading && results.length === 0
    ? 'Searching...'
    : pagination.total > 0
      ? `Showing ${Math.min(shownCount, displayTotal)} of ${analysisReadyLabel} analysis-ready results`
      : hasActiveSearch
        ? 'No results yet'
        : 'Browse popular supplements';

  const keyExtractor = React.useCallback((item: SearchSupplement, index: number) => (
    getSearchResultIdentity(item) || String(index)
  ), []);
  const resultItemLayoutHeight = cardMinHeight + RESULT_SEPARATOR_HEIGHT;
  const getItemLayout = React.useCallback(
    (_data: ArrayLike<SearchSupplement> | null | undefined, index: number) => ({
      length: resultItemLayoutHeight,
      offset: resultItemLayoutHeight * index,
      index,
    }),
    [resultItemLayoutHeight],
  );

  const renderResultItem = React.useCallback(
    ({ item, index }: ListRenderItemInfo<SearchSupplement>) => (
      <SearchResultRow
        item={item}
        index={index}
        onOpen={handleOpenResult}
        cardMinHeight={cardMinHeight}
        cardRadius={cardRadius}
        cardPaddingX={cardPaddingX}
        cardPaddingY={cardPaddingY}
        imageSize={imageSize}
        actionSize={actionSize}
        titleFontSize={titleFontSize}
        benefitFontSize={benefitFontSize}
        doseFontSize={doseFontSize}
        categoryFontSize={categoryFontSize}
      />
    ),
    [
      actionSize,
      benefitFontSize,
      cardMinHeight,
      cardPaddingX,
      cardPaddingY,
      cardRadius,
      categoryFontSize,
      doseFontSize,
      handleOpenResult,
      imageSize,
      titleFontSize,
    ],
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.safeArea} testID="product-search-screen">
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
                  testID="product-search-back-button"
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
                  {hasActiveSearch ? 'Search results' : 'Find your\nsupplement.'}
                </Text>
              </Animated.View>
            </MotiView>
          </Animated.View>

          <AnimatedSearchFlatList
            bounces
            testID="product-search-results-list"
            data={loading && results.length === 0 ? [] : results}
            keyExtractor={keyExtractor}
            renderItem={renderResultItem}
            ItemSeparatorComponent={ResultSeparator}
            getItemLayout={getItemLayout}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            updateCellsBatchingPeriod={40}
            windowSize={7}
            removeClippedSubviews
            showsVerticalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onEndReached={canLoadMore ? handleLoadMore : undefined}
            onEndReachedThreshold={0.55}
            contentContainerStyle={{
              paddingTop: headerOverlayHeight,
              paddingBottom: bottomPadding,
              paddingHorizontal: horizontalPadding,
            }}
            ListHeaderComponent={(
              <Animated.View
              style={[
                styles.frame,
                {
                  gap: sectionGap,
                  marginBottom: 10,
                },
              ]}
            >
              <MotiView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'timing', duration: 360, delay: 90 }}
                style={styles.catalogStatsPanel}
                testID="product-search-catalog-stats"
              >
                <Text style={styles.catalogStatsTitle}>
                  Search {catalogTotalLabel} supplement records
                </Text>
                <Text style={styles.catalogStatsSubline}>
                  {catalogStats ? (
                    <>
                      {analysisReadyLabel} ready for full analysis
                    </>
                  ) : (
                    'Loading analysis-ready catalog'
                  )}
                </Text>
              </MotiView>

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
                      testID="product-search-input"
                    />
                    {searchQuery ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setSearchQuery('')}
                        style={styles.clearButton}
                        testID="product-search-clear-query"
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
                            onPress={() => handleSelectCategory(category)}
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
                              {category === 'Probiotics' && isNarrow
                                ? 'Probiotic'
                                : category === 'Amino Acids' && isNarrow
                                  ? 'Amino'
                                  : category}
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

              <View style={styles.resultsHeaderRow}>
                <Text style={styles.resultsHeaderText} testID="product-search-result-summary">{resultSummary}</Text>
                {canLoadMore ? (
                  <Text style={styles.resultsHeaderMeta}>
                    Scroll for more
                  </Text>
                ) : null}
              </View>
            </Animated.View>
            )}
            ListEmptyComponent={loading && results.length === 0 ? (
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
                        <View style={styles.resultCardBody}>
                          <View style={styles.resultTopRow}>
                            <View
                              style={[
                                styles.skeletonImage,
                                {
                                  width: imageSize,
                                  height: imageSize,
                                  borderRadius: Math.round(imageSize * 0.24),
                                  marginRight: 14,
                                },
                              ]}
                            />
                            <View style={styles.resultCopy}>
                              <View style={[styles.skeletonLine, styles.skeletonTitle]} />
                              <View style={[styles.skeletonLine, styles.skeletonBenefit]} />
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
                          <View style={styles.resultMetaRow}>
                            <View style={styles.skeletonTag} />
                            <View style={[styles.skeletonLine, styles.skeletonDose]} />
                          </View>
                        </View>
                      </View>
                    </View>
                  ))}
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
            ListFooterComponent={loadingMore ? (
              <View style={styles.resultsFooter} testID="product-search-loading-more">
                <ActivityIndicator size="small" color="#3553F4" />
                <Text style={styles.resultsFooterText}>Loading more results</Text>
              </View>
            ) : loadMoreError ? (
              <Pressable
                accessibilityRole="button"
                onPress={handleLoadMore}
                style={styles.resultsFooterRetry}
                testID="product-search-load-more-retry"
              >
                <Text style={styles.resultsFooterText}>{loadMoreError}</Text>
                <Text style={styles.resultsFooterRetryText}>Try loading more again</Text>
              </Pressable>
            ) : results.length > 0 && !canLoadMore ? (
              <View style={styles.resultsFooter} testID="product-search-end-of-results">
                <Text style={styles.resultsFooterText}>End of results</Text>
              </View>
            ) : null}
          />
        </View>
      </SafeAreaView>
    </>
  );
};

const SearchPage = () => {
  const premiumAccess = usePremiumAccess();
  const gate = getProductSearchGateDecision({ isPremium: premiumAccess.isPremium });

  useEffect(() => {
    if (premiumAccess.loading || gate.allowed) return;

    router.replace({
      pathname: '/paywall/official',
      params: buildOfficialPaywallParams({
        source: 'product_search',
        returnTo: '/main/Home-Page',
      }),
    });
  }, [gate.allowed, premiumAccess.loading]);

  if (premiumAccess.loading) {
    return (
      <SafeAreaView style={styles.lockedScreen}>
        <ActivityIndicator size="large" color="#0F172A" />
      </SafeAreaView>
    );
  }

  if (!gate.allowed) {
    return null;
  }

  return <SearchExperience />;
};

const styles = StyleSheet.create({
  lockedScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
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
  catalogStatsPanel: {
    gap: 3,
  },
  catalogStatsTitle: {
    color: '#14213D',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: 0,
  },
  catalogStatsSubline: {
    color: '#73819B',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 0,
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
  resultsHeaderRow: {
    marginTop: -2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  resultsHeaderText: {
    color: '#14213D',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
  resultsHeaderMeta: {
    color: '#73819B',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0,
  },
  resultsList: {
    gap: 10,
  },
  resultSeparator: {
    height: RESULT_SEPARATOR_HEIGHT,
  },
  resultRow: {
    borderRadius: 18,
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
  resultCardBody: {
    flex: 1,
    minWidth: 0,
  },
  resultTopRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
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
    paddingRight: 4,
  },
  resultTitle: {
    color: '#14213D',
    fontWeight: '700',
    letterSpacing: -0.45,
  },
  resultBenefit: {
    marginTop: 6,
    fontWeight: '500',
    color: '#73819B',
    letterSpacing: -0.18,
  },
  resultMetaRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 6,
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
    fontWeight: '600',
    color: '#95A3B8',
    letterSpacing: 0,
    flexShrink: 1,
  },
  signalTag: {
    minHeight: 23,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.16)',
    backgroundColor: '#F8FAFF',
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  signalTagReady: {
    borderColor: 'rgba(16,185,129,0.2)',
    backgroundColor: '#ECFDF5',
  },
  signalTagBasic: {
    borderColor: 'rgba(245,158,11,0.22)',
    backgroundColor: '#FFFBEB',
  },
  signalTagVerification: {
    borderColor: 'rgba(100,116,139,0.22)',
    backgroundColor: '#F8FAFC',
  },
  signalTagText: {
    color: '#4F46E5',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
  },
  signalTagTextReady: {
    color: '#047857',
  },
  signalTagTextBasic: {
    color: '#B45309',
  },
  signalTagTextVerification: {
    color: '#475569',
  },
  resultTierDescription: {
    marginTop: 7,
    color: '#73819B',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  resultAction: {
    marginLeft: 12,
    alignSelf: 'flex-start',
    marginTop: 2,
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
  loadMoreButton: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(74,103,255,0.18)',
  },
  loadMoreText: {
    color: '#3553F4',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
  resultsFooter: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  resultsFooterText: {
    color: '#73819B',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    textAlign: 'center',
  },
  resultsFooterRetry: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(74,103,255,0.18)',
  },
  resultsFooterRetryText: {
    color: '#3553F4',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0,
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
