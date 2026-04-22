import { useFullBleed } from '@/hooks/useFullBleed';
import { useScreenTokens } from '@/hooks/useScreenTokens';
import {
  apiClient,
  type SearchProductDetailAPIResponse,
  type SearchProductDetailResponse,
} from '@/lib/api-client';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, ChevronRight, ExternalLink } from 'lucide-react-native';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const NAV_HEIGHT = 0;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const normalizeText = (value: string | null | undefined) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const resolveResponsePayload = (
  response: SearchProductDetailAPIResponse,
): SearchProductDetailResponse => ('data' in response ? response.data : response);

const firstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const splitTextToItems = (value: string | null | undefined) =>
  normalizeText(value)
    .split(/\s*[•·]\s*|\.\s+(?=[A-Z])/)
    .map((item) => normalizeText(item))
    .filter(Boolean);

const pushUnique = (target: string[], value: string | null | undefined) => {
  const normalized = normalizeText(value);
  if (!normalized || target.includes(normalized)) return;
  target.push(normalized);
};

const collectUsageLines = (payload: SearchProductDetailResponse | null): string[] => {
  const lines: string[] = [];
  const directions = (payload as { usageBlock?: { directions?: { lines?: unknown; text?: unknown } | null } | null } | null)?.usageBlock?.directions;
  if (Array.isArray(directions?.lines)) {
    directions.lines.forEach((line) => pushUnique(lines, typeof line === 'string' ? line : null));
  }
  pushUnique(lines, typeof directions?.text === 'string' ? directions.text : null);
  if (lines.length === 0) {
    splitTextToItems(payload?.suggestedUse).forEach((line) => pushUnique(lines, line));
  }
  return lines;
};

const collectWarningLines = (payload: SearchProductDetailResponse | null): string[] => {
  const lines: string[] = [];
  const safetyBlock = (payload as {
    safetyBlock?: {
      labelWarnings?: unknown;
      generalWatchouts?: unknown;
      ulGuidance?: unknown;
    } | null;
  } | null)?.safetyBlock;

  for (const collection of [safetyBlock?.labelWarnings, safetyBlock?.generalWatchouts, safetyBlock?.ulGuidance]) {
    if (!Array.isArray(collection)) continue;
    collection.forEach((item) => {
      if (typeof item === 'string') {
        pushUnique(lines, item);
        return;
      }
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        pushUnique(
          lines,
          typeof record.text === 'string'
            ? record.text
            : typeof record.label === 'string'
              ? record.label
              : null,
        );
      }
    });
  }

  if (lines.length === 0) {
    splitTextToItems(payload?.warnings).forEach((line) => pushUnique(lines, line));
  }
  return lines;
};

const SEARCH_DETAIL_RETRY_MAX_ATTEMPTS = 8;
const SEARCH_DETAIL_RETRY_MAX_WINDOW_MS = 20_000;
const SEARCH_DETAIL_RETRY_DEFAULT_MS = 1_500;

const clampRetryDelay = (value: number | null | undefined) => {
  if (!Number.isFinite(Number(value))) return SEARCH_DETAIL_RETRY_DEFAULT_MS;
  return clamp(Number(value), 400, 4_000);
};

const resolveDeepDiveAsyncState = (payload: SearchProductDetailResponse | null) => {
  const ingredientPending = payload?.deepDiveAsync?.ingredientOverview?.backgroundRefreshPending === true;
  const scientificPending = payload?.deepDiveAsync?.scientificBackground?.backgroundRefreshPending === true;
  const ingredientSource = normalizeText(payload?.ingredientOverviewSource).toLowerCase();
  const scientificSource = normalizeText(payload?.scientificBackgroundSource).toLowerCase();
  const scientificMode = normalizeText(payload?.scientificBackground?.mode).toLowerCase();
  const retryAfterMs = Math.min(
    clampRetryDelay(payload?.deepDiveAsync?.ingredientOverview?.recommendedRetryAfterMs),
    clampRetryDelay(payload?.deepDiveAsync?.scientificBackground?.recommendedRetryAfterMs),
  );
  const shouldForceRevalidate =
    (!ingredientPending && ingredientSource === 'fallback')
    || (!scientificPending && scientificSource === 'fallback' && scientificMode === 'research_mode');
  return {
    hasPending: ingredientPending || scientificPending,
    retryAfterMs,
    shouldForceRevalidate,
  };
};

const SearchDetailPage = () => {
  const params = useLocalSearchParams<{
    productId?: string;
    name?: string;
    brand?: string;
    category?: string;
    benefit?: string;
    dose?: string;
    imageUrl?: string;
  }>();
  const productId = firstParam(params.productId).trim();
  const seedName = firstParam(params.name);
  const seedBrand = firstParam(params.brand);
  const seedCategory = firstParam(params.category);
  const seedBenefit = firstParam(params.benefit);
  const seedDose = firstParam(params.dose);
  const seedImageUrl = firstParam(params.imageUrl);
  const [payload, setPayload] = React.useState<SearchProductDetailResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [pollRetryTick, setPollRetryTick] = React.useState(0);
  const pollAttemptRef = React.useRef(0);
  const pollStartedAtRef = React.useRef<number | null>(null);
  const pollInFlightRef = React.useRef(false);
  const pollTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollForcedRevalidateRef = React.useRef(false);
  const tokens = useScreenTokens(NAV_HEIGHT);
  const { bleedStyle, contentStyle } = useFullBleed(tokens.pageX);

  const resetPollState = React.useCallback(() => {
    pollAttemptRef.current = 0;
    pollStartedAtRef.current = null;
    pollInFlightRef.current = false;
    pollForcedRevalidateRef.current = false;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (!productId) {
      resetPollState();
      setLoading(false);
      setErrorMessage('Missing product id');
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        resetPollState();
        setLoading(true);
        setErrorMessage(null);
        const response = await apiClient.searchProductDetail(productId);
        if (cancelled) return;
        setPayload(resolveResponsePayload(response));
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load product detail');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      resetPollState();
    };
  }, [productId, resetPollState]);

  const deepDiveAsyncState = React.useMemo(
    () => resolveDeepDiveAsyncState(payload),
    [payload],
  );

  React.useEffect(() => {
    let cancelled = false;
    if (!productId || !payload) return;
    const shouldForceRevalidate = deepDiveAsyncState.shouldForceRevalidate && !pollForcedRevalidateRef.current;
    if (!deepDiveAsyncState.hasPending && !shouldForceRevalidate) {
      resetPollState();
      return;
    }
    if (pollInFlightRef.current) return;

    const startedAt = pollStartedAtRef.current ?? Date.now();
    pollStartedAtRef.current = startedAt;
    const elapsedMs = Date.now() - startedAt;
    if (pollAttemptRef.current >= SEARCH_DETAIL_RETRY_MAX_ATTEMPTS) return;
    if (elapsedMs >= SEARCH_DETAIL_RETRY_MAX_WINDOW_MS) return;

    const delayMs = deepDiveAsyncState.retryAfterMs;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollTimerRef.current = setTimeout(() => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      pollAttemptRef.current += 1;
      const revalidateFallback = !deepDiveAsyncState.hasPending && shouldForceRevalidate;
      if (revalidateFallback) {
        pollForcedRevalidateRef.current = true;
      }
      void (async () => {
        try {
          const response = revalidateFallback
            ? await apiClient.searchProductDetail(productId, { revalidateFallback: true })
            : await apiClient.searchProductDetail(productId);
          if (cancelled) return;
          setPayload(resolveResponsePayload(response));
        } catch {
          // Keep the current payload and wait for the next retry window.
        } finally {
          pollInFlightRef.current = false;
          if (cancelled) return;
          setPollRetryTick((value) => value + 1);
        }
      })();
    }, delayMs);

    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [
    productId,
    payload,
    deepDiveAsyncState.hasPending,
    deepDiveAsyncState.retryAfterMs,
    deepDiveAsyncState.shouldForceRevalidate,
    pollRetryTick,
    resetPollState,
  ]);

  const product = payload?.product;
  const title = product?.name ?? seedName;
  const brand = product?.brand ?? seedBrand;
  const category = product?.category ?? seedCategory;
  const benefit = product?.benefit ?? seedBenefit;
  const dose = product?.dose ?? seedDose;
  const imageUrl = product?.imageUrl ?? seedImageUrl;
  const usageLines = collectUsageLines(payload);
  const warningLines = collectWarningLines(payload);
  const horizontalPadding = tokens.pageX;
  const contentGap = clamp(tokens.sectionGap, 18, 28);
  const titleSize = clamp(tokens.h1Size - 4, 28, 36);
  const bodySize = clamp(Math.round(tokens.h1Size * 0.44), 15, 17);
  const sectionTitleSize = clamp(Math.round(tokens.h1Size * 0.6), 18, 22);

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

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: horizontalPadding,
              paddingTop: 10,
              paddingBottom: Math.max(tokens.insets.bottom + 28, 36),
              gap: contentGap,
            }}
          >
            <View style={[styles.headerRow, bleedStyle]}>
              <View style={[styles.headerContent, contentStyle]}>
                <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
                  <ArrowLeft size={22} color="#14213D" strokeWidth={2.3} />
                </Pressable>
                <View style={styles.headerPill}>
                  <Text style={styles.headerPillText}>Database</Text>
                </View>
                <View style={styles.headerSpacer} />
              </View>
            </View>

            <View style={styles.hero}>
              {imageUrl ? (
                <View style={styles.heroImageWrap}>
                  <Image source={{ uri: imageUrl }} resizeMode="contain" style={styles.heroImage} />
                </View>
              ) : null}
              <View style={styles.heroCopy}>
                <Text style={[styles.brandLine, { fontSize: bodySize }]}>{brand || 'Supplement'}</Text>
                <Text style={[styles.title, { fontSize: titleSize, lineHeight: titleSize * 1.14 }]}>
                  {title || 'Product detail'}
                </Text>
                {(category || benefit || dose) ? (
                  <View style={styles.metaWrap}>
                    {category ? (
                      <View style={styles.categoryPill}>
                        <Text style={styles.categoryPillText}>{category}</Text>
                      </View>
                    ) : null}
                    {benefit ? <Text style={[styles.metaText, { fontSize: bodySize }]}>{benefit}</Text> : null}
                    {dose ? <Text style={[styles.metaText, { fontSize: bodySize }]}>{dose}</Text> : null}
                  </View>
                ) : null}
                {payload?.defaultAnchor?.name ? (
                  <Text style={[styles.anchorLine, { fontSize: bodySize }]}>
                    Primary ingredient: {payload.defaultAnchor.name}
                    {payload.defaultAnchor.dose ? ` · ${payload.defaultAnchor.dose}` : ''}
                  </Text>
                ) : null}
              </View>
            </View>

            {loading && !payload ? (
              <View style={styles.statusBlock}>
                <ActivityIndicator size="small" color="#4A67FF" />
                <Text style={[styles.statusText, { fontSize: bodySize }]}>Loading product detail...</Text>
              </View>
            ) : null}

            {errorMessage ? (
              <View style={styles.statusBlock}>
                <Text style={[styles.errorText, { fontSize: bodySize }]}>{errorMessage}</Text>
              </View>
            ) : null}

            {payload?.ingredientOverview ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { fontSize: sectionTitleSize }]}>Ingredient Overview</Text>
                {payload.ingredientOverview.titleLine ? (
                  <Text style={[styles.sectionLead, { fontSize: bodySize }]}>{payload.ingredientOverview.titleLine}</Text>
                ) : null}
                <Text style={[styles.bodyText, { fontSize: bodySize }]}>{payload.ingredientOverview.paragraph1}</Text>
                {payload.ingredientOverview.paragraph2 ? (
                  <Text style={[styles.bodyText, { fontSize: bodySize }]}>{payload.ingredientOverview.paragraph2}</Text>
                ) : null}
                {payload.ingredientOverview.compareHint ? (
                  <Text style={[styles.noteText, { fontSize: bodySize }]}>
                    {payload.ingredientOverview.compareHint}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {payload?.scientificBackground ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { fontSize: sectionTitleSize }]}>Scientific Background</Text>
                {payload.scientificBackground.introLine ? (
                  <Text style={[styles.sectionLead, { fontSize: bodySize }]}>
                    {payload.scientificBackground.introLine}
                  </Text>
                ) : null}
                {payload.scientificBackground.sections.map((section) => (
                  <View key={section.heading} style={styles.subsection}>
                    <Text style={[styles.subsectionTitle, { fontSize: bodySize + 1 }]}>{section.heading}</Text>
                    <Text style={[styles.bodyText, { fontSize: bodySize }]}>{section.summary}</Text>
                    {section.bullets.map((bullet) => (
                      <View key={bullet} style={styles.bulletRow}>
                        <ChevronRight size={15} color="#4A67FF" strokeWidth={2.6} />
                        <Text style={[styles.bulletText, { fontSize: bodySize }]}>{bullet}</Text>
                      </View>
                    ))}
                    <Text style={[styles.noteText, { fontSize: bodySize }]}>{section.evidenceRead}</Text>
                    {section.shopperMeaning ? (
                      <Text style={[styles.noteText, { fontSize: bodySize }]}>{section.shopperMeaning}</Text>
                    ) : null}
                  </View>
                ))}
                {payload.scientificBackground.closingNote ? (
                  <Text style={[styles.noteText, { fontSize: bodySize }]}>
                    {payload.scientificBackground.closingNote}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {usageLines.length > 0 ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { fontSize: sectionTitleSize }]}>Suggested Use</Text>
                {usageLines.map((line) => (
                  <View key={line} style={styles.bulletRow}>
                    <ChevronRight size={15} color="#4A67FF" strokeWidth={2.6} />
                    <Text style={[styles.bulletText, { fontSize: bodySize }]}>{line}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {warningLines.length > 0 ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { fontSize: sectionTitleSize }]}>Warnings</Text>
                {warningLines.map((line) => (
                  <View key={line} style={styles.bulletRow}>
                    <ChevronRight size={15} color="#C84E00" strokeWidth={2.6} />
                    <Text style={[styles.bulletText, { fontSize: bodySize }]}>{line}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {product?.link ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => Linking.openURL(product.link as string).catch(() => null)}
                style={styles.sourceButton}
              >
                <Text style={[styles.sourceButtonText, { fontSize: bodySize }]}>Open source page</Text>
                <ExternalLink size={16} color="#4A67FF" strokeWidth={2.3} />
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </SafeAreaView>
    </>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F9FAFC',
  },
  screen: {
    flex: 1,
    backgroundColor: '#F9FAFC',
  },
  headerRow: {
    marginBottom: 8,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(20,33,61,0.08)',
  },
  headerPill: {
    marginLeft: 12,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(74,103,255,0.1)',
  },
  headerPillText: {
    color: '#3553F4',
    fontSize: 13,
    fontWeight: '600',
  },
  headerSpacer: {
    flex: 1,
  },
  hero: {
    gap: 18,
  },
  heroImageWrap: {
    width: 112,
    height: 112,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(20,33,61,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImage: {
    width: '84%',
    height: '84%',
  },
  heroCopy: {
    gap: 10,
  },
  brandLine: {
    color: '#4A67FF',
    fontWeight: '600',
  },
  title: {
    color: '#14213D',
    fontWeight: '700',
  },
  metaWrap: {
    gap: 8,
  },
  categoryPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#EEF2FF',
    borderColor: '#D9E2FF',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  categoryPillText: {
    color: '#3553F4',
    fontSize: 12,
    fontWeight: '600',
  },
  metaText: {
    color: '#5B667A',
    lineHeight: 22,
  },
  anchorLine: {
    color: '#22314D',
    lineHeight: 22,
    fontWeight: '500',
  },
  statusBlock: {
    gap: 10,
    paddingVertical: 8,
  },
  statusText: {
    color: '#5B667A',
  },
  errorText: {
    color: '#A33B00',
    lineHeight: 22,
  },
  section: {
    paddingTop: 4,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(20,33,61,0.08)',
  },
  sectionTitle: {
    color: '#14213D',
    fontWeight: '700',
  },
  sectionLead: {
    color: '#22314D',
    lineHeight: 23,
    fontWeight: '600',
  },
  bodyText: {
    color: '#314158',
    lineHeight: 23,
  },
  noteText: {
    color: '#5B667A',
    lineHeight: 22,
  },
  subsection: {
    gap: 10,
  },
  subsectionTitle: {
    color: '#14213D',
    fontWeight: '600',
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bulletText: {
    flex: 1,
    color: '#314158',
    lineHeight: 22,
  },
  sourceButton: {
    minHeight: 46,
    borderRadius: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(74,103,255,0.16)',
  },
  sourceButtonText: {
    color: '#3553F4',
    fontWeight: '600',
  },
});

export default SearchDetailPage;
