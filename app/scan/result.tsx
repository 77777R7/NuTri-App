import { BlurView } from 'expo-blur';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, FileText } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import { OrganicSpinner } from '@/components/ui/OrganicSpinner';
import { ShinyText } from '@/components/ui/ShinyText';
import { useScanHistory } from '@/contexts/ScanHistoryContext';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';
import { useStreamAnalysis } from '@/hooks/useStreamAnalysis';
import { consumeScanSession, type ScanSession } from '@/lib/scan/session';
import { requestLabelAnalysis } from '@/lib/scan/service';
import type { LabelDraft } from '@/backend/src/labelAnalysis';
import { AnalysisDashboard } from './AnalysisDashboard';

export default function ScanResultScreen() {
  const { tokens } = useResponsiveTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const { addScan } = useScanHistory();
  const addedRef = useRef(false);
  const lastDosageRef = useRef<string | null>(null);
  const analysisRequestedRef = useRef(false);

  // Get session to retrieve barcode
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const [session, setSession] = useState<ScanSession | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const isLabel = session?.mode === 'label';
  const labelResult = isLabel ? session.result : null;
  const barcode = session?.mode === 'barcode' ? session.input.barcode : '';
  const [labelAnalysis, setLabelAnalysis] = useState(labelResult?.analysis ?? null);
  const [labelAnalysisLoading, setLabelAnalysisLoading] = useState(false);
  const [labelAnalysisError, setLabelAnalysisError] = useState<string | null>(null);
  const resolvedLabelAnalysis = labelAnalysis ?? labelResult?.analysis ?? null;

  // 🚀 Use the Streaming Hook
  const {
    productInfo, efficacy, safety, usage, value, social, status, error
  } = useStreamAnalysis(barcode);

  const formatDose = (value?: number | string | null, unit?: string | null) => {
    if (value == null) return null;
    const cleanValue = typeof value === 'string' ? value.trim() : value;
    if (cleanValue === '') return null;
    const cleanUnit = unit?.trim() ?? '';
    return cleanUnit ? `${cleanValue} ${cleanUnit}` : String(cleanValue);
  };

  const extractDoseFromText = (text?: string | null) => {
    if (!text) return null;
    const match = text.match(/(\d+(?:\.\d+)?)\s?(mcg|μg|ug|mg|g|iu|ml|oz)/i);
    if (!match) return null;
    const value = match[1];
    const unitRaw = match[2].toLowerCase();
    const unit = unitRaw === 'μg' || unitRaw === 'ug' ? 'mcg' : unitRaw;
    return formatDose(value, unit);
  };

  const formatDraftIngredient = (ingredient: LabelDraft['ingredients'][number]) => {
    let line = ingredient.name;
    if (ingredient.amount != null && ingredient.unit) {
      line += `: ${ingredient.amount} ${ingredient.unit}`;
    }
    if (ingredient.dvPercent != null) {
      line += ` (${ingredient.dvPercent}% DV)`;
    }
    return line;
  };

  const getDraftDose = (draft?: LabelDraft | null) => {
    if (!draft?.ingredients?.length) return null;
    const withDose = draft.ingredients.find((ingredient) => ingredient.amount != null && ingredient.unit);
    if (!withDose) return null;
    return `${withDose.amount} ${withDose.unit}`;
  };

  const handleGenerateAnalysis = useCallback(async () => {
    if (!labelResult || labelAnalysisLoading) return;
    setLabelAnalysisError(null);
    setLabelAnalysisLoading(true);
    try {
      const response = await requestLabelAnalysis({
        imageHash: labelResult.imageHash,
        imageBase64: session?.mode === 'label' ? session.input.imageBase64 : undefined,
      });
      if (response.analysis) {
        setLabelAnalysis(response.analysis);
      } else {
        setLabelAnalysisError(response.message ?? 'Analysis is not available yet.');
      }
    } catch (error) {
      setLabelAnalysisError('Unable to generate analysis. Please try again.');
    } finally {
      setLabelAnalysisLoading(false);
    }
  }, [labelAnalysisLoading, labelResult]);

  useEffect(() => {
    if (!isLabel || !labelResult) return;
    if (labelResult.status === 'failed') return;
    if (resolvedLabelAnalysis || labelAnalysisLoading) return;
    if (analysisRequestedRef.current) return;
    analysisRequestedRef.current = true;
    handleGenerateAnalysis();
  }, [handleGenerateAnalysis, isLabel, labelAnalysisLoading, labelResult, resolvedLabelAnalysis]);

  useEffect(() => {
    const nextSession = consumeScanSession();
    setSession(nextSession);
    setSessionResolved(true);
    analysisRequestedRef.current = false;
    addedRef.current = false;
    lastDosageRef.current = null;
    setLabelAnalysis(null);
    setLabelAnalysisError(null);
    setLabelAnalysisLoading(false);
  }, [params.sessionId]);

  useEffect(() => {
    if (!sessionResolved) return;
    if (!session) {
      router.replace('/scan/label');
    }
  }, [session, sessionResolved]);

  useEffect(() => {
    if (!session) return;

    if (session.mode === 'label') {
      if (addedRef.current) return;
      const analysis = resolvedLabelAnalysis;
      if (!analysis || analysis.status !== 'success') return;

      const productInfo = analysis.productInfo ?? {};
      const labelDose =
        getDraftDose(session.result.draft) ??
        extractDoseFromText(productInfo.name ?? null) ??
        extractDoseFromText(productInfo.category ?? null) ??
        null;

      addScan({
        barcode: analysis.barcode ?? null,
        productName: productInfo.name ?? 'Label Scan Result',
        brandName: productInfo.brand ?? 'Unknown brand',
        dosageText: labelDose ?? '',
        category: productInfo.category ?? null,
        imageUrl: productInfo.image ?? null,
      });
      addedRef.current = true;
      return;
    }

    if (status === 'error' || !productInfo) return;

    const primaryDose = formatDose(
      efficacy?.primaryActive?.dosageValue ?? null,
      efficacy?.primaryActive?.dosageUnit ?? null,
    );
    const ingredientDose = (() => {
      const firstWithDose = efficacy?.ingredients?.find(
        (ingredient) => ingredient.dosageValue != null,
      );
      return formatDose(firstWithDose?.dosageValue ?? null, firstWithDose?.dosageUnit ?? null);
    })();
    const usageDose = (usage as { dosage?: string } | null)?.dosage ?? null;
    const activeIngredientAmount = efficacy?.activeIngredients?.[0]?.amount ?? null;
    const summaryDose =
      extractDoseFromText((usage as { summary?: string } | null)?.summary ?? null) ??
      extractDoseFromText(efficacy?.overviewSummary ?? null) ??
      extractDoseFromText(efficacy?.dosageAssessment?.text ?? null);
    const fallbackDose = productInfo.category ?? '';
    const dosageText =
      usageDose ??
      primaryDose ??
      ingredientDose ??
      activeIngredientAmount ??
      summaryDose ??
      fallbackDose;

    if (!addedRef.current) {
      addScan({
        barcode: barcode || null,
        productName: productInfo.name ?? 'Unknown supplement',
        brandName: productInfo.brand ?? 'Unknown brand',
        dosageText,
        category: productInfo.category ?? null,
        imageUrl: productInfo.image ?? null,
      });
      addedRef.current = true;
      lastDosageRef.current = dosageText || null;
      return;
    }

    if (dosageText && dosageText !== lastDosageRef.current) {
      addScan({
        barcode: barcode || null,
        productName: productInfo.name ?? 'Unknown supplement',
        brandName: productInfo.brand ?? 'Unknown brand',
        dosageText,
        category: productInfo.category ?? null,
        imageUrl: productInfo.image ?? null,
      });
      lastDosageRef.current = dosageText;
    }
  }, [addScan, barcode, efficacy, productInfo, resolvedLabelAnalysis, session, status, usage]);

  const handleBack = () => {
    if (session?.mode === 'barcode') {
      router.replace('/scan/barcode');
    } else {
      router.replace('/scan/label');
    }
  };

  if (!session) return null;

  if (isLabel && labelResult) {
    const draft = labelResult.draft ?? null;
    const issues = labelResult.issues ?? draft?.issues ?? [];
    const isFailed = labelResult.status === 'failed';
    const needsReview = Boolean(
      draft
      && (draft.confidenceScore < 0.7
        || draft.parseCoverage < 0.7
        || issues.some((issue) => (
          issue.type === 'unit_invalid'
          || issue.type === 'value_anomaly'
          || issue.type === 'incomplete_ingredients'
        )))
    );
    const fallbackTitle = labelResult.status === 'failed' ? 'Scan Failed' : 'Review Required';
    const fallbackMessage =
      labelResult.message ??
      (labelResult.status === 'failed'
        ? 'We could not read the label.'
        : 'Please review the extracted ingredients.');

    if (isFailed) {
      return (
        <ResponsiveScreen
          contentStyle={styles.screen}
          style={styles.safeArea}
        >
          <Stack.Screen
            options={{
              title: 'Analysis',
              headerShadowVisible: false,
              headerStyle: { backgroundColor: '#F2F2F7' },
              contentStyle: { backgroundColor: '#F2F2F7' },
              presentation: 'card',
            }}
          />
          <StatusBar style="dark" />
          <Header onBack={handleBack} title="Label Scan" />

          <ScrollView contentContainerStyle={styles.labelFallbackContent}>
            <View style={styles.labelFallbackHeader}>
              <FileText size={48} color="#52525b" />
              <Text style={styles.fallbackTitle}>{fallbackTitle}</Text>
              <Text style={styles.fallbackText}>{fallbackMessage}</Text>
              {labelResult.suggestion ? (
                <Text style={styles.fallbackNote}>{labelResult.suggestion}</Text>
              ) : null}
            </View>

            {draft ? (
              <View style={styles.labelCard}>
                <Text style={styles.labelCardTitle}>Extracted Ingredients</Text>
                {draft.servingSize ? (
                  <Text style={styles.labelMeta}>Serving Size: {draft.servingSize}</Text>
                ) : null}
                {draft.ingredients.length > 0 ? (
                  <View style={styles.labelList}>
                    {draft.ingredients.map((ingredient, index) => (
                      <Text key={`${ingredient.name}-${index}`} style={styles.labelItem}>
                        {formatDraftIngredient(ingredient)}
                      </Text>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.labelEmpty}>No ingredients detected.</Text>
                )}
              </View>
            ) : null}

            {issues.length > 0 ? (
              <View style={styles.labelCard}>
                <Text style={styles.labelCardTitle}>Issues Detected</Text>
                <View style={styles.labelList}>
                  {issues.map((issue, index) => (
                    <Text key={`${issue.type}-${index}`} style={styles.labelItem}>
                      {issue.message}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>
        </ResponsiveScreen>
      );
    }

    const analysisFallback = {
      productInfo: {
        brand: null,
        name: 'Label Scan Result',
        category: 'supplement',
        image: null,
      },
      efficacy: {},
      safety: {},
      usage: {},
      value: {},
      social: {},
      meta: { actualDoseMg: 0 },
      status: 'loading',
    };
    const analysisForDisplay = resolvedLabelAnalysis ?? analysisFallback;
    const isLabelStreaming = !resolvedLabelAnalysis || labelAnalysisLoading;

    return (
      <ResponsiveScreen
        contentStyle={styles.screen}
        style={styles.safeArea}
      >
        <Stack.Screen
          options={{
            title: 'Analysis',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: '#F2F2F7' },
            contentStyle: { backgroundColor: '#F2F2F7' },
            presentation: 'card',
          }}
        />
        <StatusBar style="dark" />
        <Header onBack={handleBack} title="Analysis" />

        {needsReview ? (
          <View style={styles.labelCard}>
            <Text style={styles.labelCardTitle}>Review recommended</Text>
            <Text style={styles.labelMeta}>
              OCR confidence is low. You can still view AI analysis, but verify the extracted ingredients.
            </Text>
          </View>
        ) : null}

        <AnalysisDashboard analysis={analysisForDisplay as any} isStreaming={isLabelStreaming} />

        {labelAnalysisError && !resolvedLabelAnalysis ? (
          <View style={styles.labelCard}>
            <Text style={styles.analysisErrorText}>{labelAnalysisError}</Text>
            <TouchableOpacity
              style={[styles.analysisButton, labelAnalysisLoading ? styles.analysisButtonDisabled : null]}
              onPress={handleGenerateAnalysis}
              disabled={labelAnalysisLoading}
            >
              <Text style={styles.analysisButtonText}>
                {labelAnalysisLoading ? 'Analyzing...' : 'Try again'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isLabelStreaming && !labelAnalysisError ? (
          <BlurView intensity={40} tint="dark" style={styles.streamingBadge}>
            <OrganicSpinner size={24} color="rgba(255,255,255,0.9)" />
            <View style={{ top: 3 }}>
              <ShinyText
                text="AI Analyzing"
                speed={2}
                style={{ ...styles.streamingText, color: '#FFFFFF' }}
              />
            </View>
          </BlurView>
        ) : null}
      </ResponsiveScreen>
    );
  }

  // 1. Error State
  if (status === 'error') {
    return (
      <ResponsiveScreen contentStyle={styles.screen}>
        <Header onBack={handleBack} title="Scan Result" />
        <View style={styles.fallbackContainer}>
          <FileText size={48} color="#52525b" />
          <Text style={styles.fallbackTitle}>Not Found</Text>
          <Text style={styles.fallbackText}>{error || 'We could not find this product.'}</Text>
        </View>
      </ResponsiveScreen>
    );
  }

  // 2. Removed intermediate "Searching..." screen - go directly to dashboard
  // The AnalysisDashboard will show skeleton loading states for each section

  // 3. Fallback if somehow no product info but done (rare)
  if (!productInfo && status === 'complete') {
    return <View><Text>Unexpected empty result</Text></View>;
  }

  // 4. Construct the composite analysis object for the Dashboard
  // The Dashboard will handle nulls/missing fields gracefully by showing defaults or skeletons
  const compositeAnalysis = {
    productInfo: productInfo,
    efficacy: efficacy || {}, // Empty obj means "loading" inside dashboard components if checked
    safety: safety || {},
    usage: usage || {},
    value: value || {},
    social: social || {},
    // Meta is tricky, we might compute it or mock it. 
    // For now, let's pass a basic meta if efficacy exists to allow score calculation
    meta: {
      actualDoseMg: efficacy?.activeIngredients?.[0]?.amount ? parseFloat(efficacy.activeIngredients[0].amount) : 0,
      // ... fill other meta requirements if needed or let computeScores handle defaults
    },
    status: 'success'
  };

  // Pass a loading flag so Dashboard knows stream is active
  const isStreaming = status === 'streaming' || status === 'loading';

  return (
    <ResponsiveScreen
      contentStyle={styles.screen}
      style={styles.safeArea}
    >
      <Stack.Screen
        options={{
          title: 'Analysis',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#F2F2F7' },
          contentStyle: { backgroundColor: '#F2F2F7' },
          presentation: 'card',
        }}
      />
      <StatusBar style="dark" />
      <Header onBack={handleBack} title="Analysis" />

      {/* We render dashboard immediately. 
        As 'efficacy', 'safety' etc. arrive, this component re-renders and fills in the blanks.
      */}
      <AnalysisDashboard analysis={compositeAnalysis} isStreaming={isStreaming} />

      {/* Optional: A small global spinner in the corner if streaming */}
      {isStreaming && (
        <BlurView intensity={40} tint="dark" style={styles.streamingBadge}>
          <OrganicSpinner size={24} color="rgba(255,255,255,0.9)" />
          <View style={{ top: 3 }}>
            <ShinyText
              text="AI Analyzing"
              speed={2}
              style={{ ...styles.streamingText, color: '#FFFFFF' }}
            />
          </View>
        </BlurView>
      )}
    </ResponsiveScreen>
  );
}

function Header({ onBack, title }: { onBack: () => void, title: string }) {
  // ... (Keep existing Header code) ...
  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
        <ArrowLeft size={20} color="#000" />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  // ... (Keep existing styles) ...
  screen: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    width: '100%',
    alignSelf: 'stretch',
    maxWidth: '100%',
    paddingHorizontal: 0,
  },
  safeArea: {
    backgroundColor: '#F2F2F7',
    width: '100%',
    alignSelf: 'stretch',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: '#F2F2F7',
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f4f4f5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  loadingContainer: { flex: 1, backgroundColor: '#F2F2F7', justifyContent: 'center', alignItems: 'center' },
  loadingTitle: { fontSize: 18, fontWeight: '600', color: '#52525b' },
  fallbackContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  fallbackTitle: { fontSize: 24, fontWeight: 'bold', color: '#000', marginTop: 20 },
  fallbackText: { fontSize: 16, color: '#52525b', marginTop: 10, textAlign: 'center' },
  fallbackNote: { fontSize: 14, color: '#71717a', marginTop: 12, textAlign: 'center' },
  labelFallbackContent: { padding: 24, paddingBottom: 40 },
  labelFallbackHeader: { alignItems: 'center', paddingVertical: 24 },
  labelCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  labelCardTitle: { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 8 },
  labelMeta: { fontSize: 13, color: '#6b7280', marginBottom: 12 },
  labelList: { marginTop: 4 },
  labelItem: { fontSize: 14, color: '#111827', marginBottom: 6, lineHeight: 20 },
  labelEmpty: { fontSize: 14, color: '#6b7280' },
  analysisButton: {
    marginTop: 8,
    backgroundColor: '#111827',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  analysisButtonDisabled: {
    backgroundColor: '#6b7280',
  },
  analysisButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  analysisErrorText: {
    marginTop: 8,
    color: '#b91c1c',
    fontSize: 13,
  },

  // New style for the floating badge
  streamingBadge: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    overflow: 'hidden',
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  streamingText: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 0.5,
    lineHeight: 16,
  }
});

const createStyles = (tokens: any) => styles;
