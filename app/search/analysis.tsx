import { AnalysisDashboard } from '@/components/scan/AnalysisDashboard';
import {
  apiClient,
  type SearchProductDetailAPIResponse,
  type SearchProductDetailResponse,
} from '@/lib/api-client';
import { buildDatabaseAnalysisPayload } from '@/lib/search/databaseAnalysis';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, RefreshCw } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const resolveDetailPayload = (
  response: SearchProductDetailAPIResponse,
): SearchProductDetailResponse => ('data' in response ? response.data : response);

const DatabaseAnalysisScreen = () => {
  const params = useLocalSearchParams<{ productId?: string }>();
  const productId = typeof params.productId === 'string' ? params.productId.trim() : '';
  const [detail, setDetail] = useState<SearchProductDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      if (!productId) {
        setError('Product not found.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await apiClient.searchProductDetail(productId, {
          signal: controller.signal,
        });
        if (cancelled) return;
        setDetail(resolveDetailPayload(response));
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(err instanceof Error && err.message ? err.message : 'Could not load this product.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [productId, reloadKey]);

  const databaseAnalysis = useMemo(
    () => (detail ? buildDatabaseAnalysisPayload(detail) : null),
    [detail],
  );

  const handleBack = useCallback(() => {
    router.back();
  }, []);

  const handleRetry = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea} testID="database-analysis-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={handleBack}
          style={styles.iconButton}
          testID="database-analysis-back-button"
        >
          <ArrowLeft size={24} color="#14213D" strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headerTitle}>Analysis</Text>
        <View style={styles.iconButtonPlaceholder} />
      </View>

      {loading && !databaseAnalysis ? (
        <View style={styles.centerState} testID="database-analysis-loading">
          <ActivityIndicator size="small" color="#3553F4" />
          <Text style={styles.centerTitle}>Loading product analysis</Text>
          <Text style={styles.centerBody}>Preparing label facts, score, and science summary.</Text>
        </View>
      ) : error || !databaseAnalysis ? (
        <View style={styles.centerState} testID="database-analysis-error">
          <Text style={styles.centerTitle}>Product analysis unavailable</Text>
          <Text style={styles.centerBody}>
            {error ?? 'This database record could not be loaded right now.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={handleRetry}
            style={styles.retryButton}
            testID="database-analysis-retry-button"
          >
            <RefreshCw size={16} color="#FFFFFF" strokeWidth={2.4} />
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.dashboardWrap} testID="database-analysis-dashboard">
          <AnalysisDashboard
            analysis={databaseAnalysis.analysis}
            analysisBundle={databaseAnalysis.analysisBundle}
            accessLevel="full"
            isStreaming={false}
            sourceType="database"
            scanSessionId={`database:${detail?.product.productId ?? productId}`}
            prefetchedDeepDive={{
              ingredientOverview: detail?.ingredientOverview ?? null,
              scientificBackground: detail?.scientificBackground ?? null,
            }}
            personalizedGuideMode="hidden"
          />
        </View>
      )}
    </SafeAreaView>
  );
};

export default DatabaseAnalysisScreen;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F2F4F8',
  },
  header: {
    height: 58,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F2F4F8',
  },
  dashboardWrap: {
    flex: 1,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  iconButtonPlaceholder: {
    width: 44,
    height: 44,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#14213D',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  centerTitle: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '800',
    color: '#14213D',
    textAlign: 'center',
  },
  centerBody: {
    fontSize: 15,
    lineHeight: 21,
    color: '#68748A',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#3553F4',
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
});
