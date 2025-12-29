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
import { getBarcodeQuality, getLabelDraftQuality } from '@/lib/scan/quality';
import type { LabelDraft } from '@/backend/src/labelAnalysis';
import { AnalysisDashboard } from './AnalysisDashboard';

type LabelAnalysisStatus = 'complete' | 'partial' | 'skipped' | 'pending' | 'unavailable' | 'failed' | null;

const NAME_NOISE_PATTERNS: RegExp[] = [
  /supplement facts/i,
  /nutrition facts/i,
  /serving size/i,
  /\bamount\b/i,
  /per serving/i,
  /daily value/i,
  /% ?dv/i,
  /\bvalue\b/i,
  /(medicinal|non-medicinal) ingredients/i,
  /other ingredients/i,
  /also contains/i,
  /directions?/i,
  /warnings?/i,
  /caution/i,
  /store/i,
  /^(each|in each|chaque|dans chaque)\b.*\bcontains?\b/i,
];

const isNoiseIngredientName = (name?: string | null) => {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 2) return true;
  return NAME_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
};

const normalizeIngredientName = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9\s.-]/g, ' ').replace(/\s+/g, ' ').trim();

const formatCompactNumber = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.00$/, '').replace(/\.0$/, '');
};

const shortenIngredientName = (name: string) => {
  const normalized = normalizeIngredientName(name);
  if (/(epa|eicosapentaenoic)/i.test(normalized)) return 'EPA';
  if (/(dha|docosahexaenoic)/i.test(normalized)) return 'DHA';
  if (/omega[-\s]?3/i.test(normalized)) return 'Omega-3';
  if (/fish oil/i.test(normalized)) return 'Fish Oil';
  if (/probiotic/i.test(normalized)) return 'Probiotic';
  if (/lactobacillus/i.test(normalized)) return 'Lactobacillus';
  if (/bifidobacter/i.test(normalized)) return 'Bifidobacterium';
  if (/(vitamin\s*d3|cholecalciferol|\bd3\b)/i.test(normalized)) return 'Vitamin D3';
  if (/vitamin\s*d\b/i.test(normalized)) return 'Vitamin D';
  if (/folate|folic\s*acid/i.test(normalized)) return 'Folate';
  if (/biotin/i.test(normalized)) return 'Biotin';
  if (/niacinamide|niacin/i.test(normalized)) return 'B3';
  if (/thiamin/i.test(normalized)) return 'B1';
  if (/riboflavin/i.test(normalized)) return 'B2';
  if (/pantethine|pantothenic/i.test(normalized)) return 'B5';
  if (/pyridox/i.test(normalized)) return 'B6';
  if (/cobalamin/i.test(normalized)) return 'B12';
  const vitaminMatch = normalized.match(/\bvitamin\s*([a-z]|\d{1,2})\b/);
  if (vitaminMatch) {
    return `Vitamin ${vitaminMatch[1].toUpperCase()}`;
  }
  const bMatch = normalized.match(/\bb\s*(\d{1,2})\b/);
  if (bMatch) return `B${bMatch[1]}`;
  const cleaned = name.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter(Boolean);
  return words.slice(0, 2).join(' ');
};

const isPlaceholderLabelName = (name?: string | null) => {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/^label scan result$/i.test(trimmed)) return true;
  if (/^supplement$/i.test(trimmed)) return true;
  return isNoiseIngredientName(trimmed);
};

const isLikelyIngredient = (ingredient: LabelDraft['ingredients'][number]) =>
  (ingredient.amount != null && ingredient.unit) || ingredient.dvPercent != null;

const getLabelIngredientCandidates = (draft?: LabelDraft | null) => {
  if (!draft?.ingredients?.length) return [];
  return draft.ingredients
    .filter((ingredient) => isLikelyIngredient(ingredient) && !isNoiseIngredientName(ingredient.name))
    .map((ingredient) => ({
      name: ingredient.name?.trim() ?? '',
      normalized: normalizeIngredientName(ingredient.name ?? ''),
      amount: ingredient.amount ?? null,
      unit: ingredient.unit ?? null,
    }))
    .filter((ingredient) => ingredient.name);
};

const detectLabelProductType = (names: string[], count: number) => {
  const bSignals = [
    'b1',
    'b2',
    'b3',
    'b5',
    'b6',
    'b7',
    'b9',
    'b12',
    'thiamine',
    'riboflavin',
    'niacin',
    'pantothen',
    'pantethine',
    'pyridox',
    'biotin',
    'folate',
    'folic acid',
    'cobalamin',
  ];
  const bHits = new Set<string>();
  names.forEach((name) => {
    bSignals.forEach((signal) => {
      if (name.includes(signal)) bHits.add(signal);
    });
  });
  if (bHits.size >= 5) return 'b_complex';
  if (names.some((name) => name.includes('epa') || name.includes('dha') || name.includes('omega-3') || name.includes('fish oil'))) {
    return 'omega3_fish_oil';
  }
  if (names.some((name) => name.includes('vitamin d') || name.includes('d3') || name.includes('cholecalciferol'))) {
    return 'vitamin_d';
  }
  if (names.some((name) => name.includes('probiotic') || name.includes('lactobacillus') || name.includes('bifidobacter'))) {
    return 'probiotic';
  }
  if (count <= 2) return 'single_active';
  if (count >= 6) return 'multi_active_general';
  return 'unknown';
};

const buildLabelProductName = (draft?: LabelDraft | null, analysisName?: string | null) => {
  if (analysisName && !isPlaceholderLabelName(analysisName)) return analysisName;
  const candidates = getLabelIngredientCandidates(draft);
  const names = candidates.map((item) => item.normalized);
  const type = detectLabelProductType(names, candidates.length);
  if (type === 'b_complex') return `B-Complex (${candidates.length} actives)`;
  if (type === 'omega3_fish_oil') return 'Omega-3 Fish Oil';
  if (type === 'vitamin_d') return 'Vitamin D3';
  if (type === 'probiotic') {
    const cfu = candidates.find((candidate) => candidate.unit?.toLowerCase() === 'cfu');
    if (cfu?.amount != null) return `Probiotic (${formatCompactNumber(cfu.amount)} CFU)`;
    return 'Probiotic';
  }
  if (type === 'multi_active_general') return `Multi-Active (${candidates.length} actives)`;
  if (type === 'single_active') {
    const fallback = getMeaningfulIngredientName(draft);
    return fallback ? shortenIngredientName(fallback) : 'Single Active';
  }
  const fallback = getMeaningfulIngredientName(draft);
  return fallback ?? 'Label Scan Result';
};

const getMeaningfulIngredientName = (draft?: LabelDraft | null) => {
  if (!draft?.ingredients?.length) return null;
  const withAmount = draft.ingredients.find(
    (ingredient) => isLikelyIngredient(ingredient) && !isNoiseIngredientName(ingredient.name),
  );
  if (withAmount?.name) return withAmount.name;
  const match = draft.ingredients.find((ingredient) => !isNoiseIngredientName(ingredient.name));
  return match?.name ?? null;
};

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
  const [labelAnalysisStatus, setLabelAnalysisStatus] = useState<LabelAnalysisStatus>(
    labelResult?.analysisStatus ?? (labelResult?.analysis ? 'complete' : null)
  );
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const resolvedLabelAnalysis = labelAnalysis ?? labelResult?.analysis ?? null;
  const labelDraft = labelResult?.draft ?? null;
  const labelIssues = labelResult?.issues ?? labelDraft?.issues ?? [];
  const labelQuality = isLabel ? getLabelDraftQuality(labelDraft, labelIssues) : null;
  const needsReview = labelQuality?.reviewRecommended ?? false;
  const ingredientsToShow = isLabel ? (labelDraft?.ingredients ?? []).filter(isLikelyIngredient) : [];
  const labelNameCandidate = isLabel ? getMeaningfulIngredientName(labelDraft) : null;
  const analysisName = resolvedLabelAnalysis?.productInfo?.name ?? labelResult?.analysis?.productInfo?.name ?? null;
  const labelProductName = isLabel ? buildLabelProductName(labelDraft, analysisName) : 'Supplement';

  // 🚀 Use the Streaming Hook
  const {
    productInfo, efficacy, safety, usage, value, social, status, error
  } = useStreamAnalysis(barcode);
  const barcodeQuality = useMemo(() => getBarcodeQuality({ status, error }), [error, status]);

  const formatDose = useCallback((value?: number | string | null, unit?: string | null) => {
    if (value == null) return null;
    const cleanValue = typeof value === 'string' ? value.trim() : value;
    if (cleanValue === '') return null;
    const cleanUnit = unit?.trim() ?? '';
    return cleanUnit ? `${cleanValue} ${cleanUnit}` : String(cleanValue);
  }, []);

  const extractDoseFromText = useCallback(
    (text?: string | null) => {
      if (!text) return null;
      const match = text.match(/(\d+(?:\.\d+)?)\s?(mcg|μg|ug|mg|g|iu|ml|oz)/i);
      if (!match) return null;
      const value = match[1];
      const unitRaw = match[2].toLowerCase();
      const unit = unitRaw === 'μg' || unitRaw === 'ug' ? 'mcg' : unitRaw;
      return formatDose(value, unit);
    },
    [formatDose]
  );

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

  const labelImageBase64 = session?.mode === 'label' ? session.input.imageBase64 : undefined;

  const handleGenerateAnalysis = useCallback(async () => {
    if (!labelResult || labelAnalysisLoading) return;
    setLabelAnalysisError(null);
    setLabelAnalysisLoading(true);
    setLabelAnalysisStatus('pending');
    try {
      const response = await requestLabelAnalysis({
        imageHash: labelResult.imageHash,
        imageBase64: labelImageBase64,
      });
      if (response.analysis) {
        setLabelAnalysis(response.analysis);
        setLabelAnalysisStatus(response.analysisStatus ?? 'complete');
      } else {
        const nextStatus = response.analysisStatus ?? 'skipped';
        setLabelAnalysisStatus(nextStatus);
        if (nextStatus === 'unavailable') {
          setLabelAnalysisError(response.message ?? 'Analysis service unavailable.');
        }
      }
    } catch {
      setLabelAnalysisError('Unable to generate analysis. Please try again.');
      setLabelAnalysisStatus('failed');
    } finally {
      setLabelAnalysisLoading(false);
    }
  }, [labelAnalysisLoading, labelResult, labelImageBase64]);

  useEffect(() => {
    if (!isLabel || !labelResult) return;
    if (labelResult.status === 'failed') return;
    if (resolvedLabelAnalysis || labelAnalysisLoading) return;
    if (analysisRequestedRef.current) return;
    const shouldAutoAnalyze = labelQuality?.labelOnlyScoreEligible ?? false;
    if (!shouldAutoAnalyze) return;
    analysisRequestedRef.current = true;
    handleGenerateAnalysis();
  }, [handleGenerateAnalysis, isLabel, labelAnalysisLoading, labelResult, labelQuality, resolvedLabelAnalysis]);

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
    setEvidenceExpanded(false);
    const nextLabelResult = nextSession?.mode === 'label' ? nextSession.result : null;
    setLabelAnalysisStatus(nextLabelResult?.analysisStatus ?? (nextLabelResult?.analysis ? 'complete' : null));
  }, [params.sessionId]);

  useEffect(() => {
    if (needsReview) {
      setEvidenceExpanded(true);
    }
  }, [needsReview]);

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
      const labelName = labelProductName;
      const labelDose =
        getDraftDose(session.result.draft) ??
        extractDoseFromText(productInfo.name ?? null) ??
        extractDoseFromText(productInfo.category ?? null) ??
        null;

      addScan({
        barcode: analysis.barcode ?? null,
        productName: labelName,
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
      extractDoseFromText(efficacy?.overallAssessment ?? null);
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
  }, [
    addScan,
    barcode,
    efficacy,
    extractDoseFromText,
    formatDose,
    labelProductName,
    productInfo,
    resolvedLabelAnalysis,
    session,
    status,
    usage,
  ]);

  const handleBack = () => {
    if (session?.mode === 'barcode') {
      router.replace('/scan/barcode');
    } else {
      router.replace('/scan/label');
    }
  };

  if (!session) return null;

  if (isLabel && labelResult) {
    const draft = labelDraft;
    const issues = labelIssues;
    const quality = labelQuality ?? getLabelDraftQuality(draft, issues);
    const evidenceSummary = `Label evidence: ${ingredientsToShow.length} ingredients • ${quality.extractionQuality} (${Math.round((draft?.confidenceScore ?? 0) * 100)}%)`;
    const isFailed = labelResult.status === 'failed';
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
    const analysisWithLabelName = {
      ...analysisForDisplay,
      productInfo: {
        ...analysisForDisplay.productInfo,
        name: labelProductName,
        category: analysisForDisplay.productInfo?.category ?? 'supplement',
      },
    };
    const isLabelStreaming = labelAnalysisStatus === 'pending' || labelAnalysisLoading;
    const analysisComplete =
      resolvedLabelAnalysis?.status === 'success' && labelAnalysisStatus !== 'partial';
    const scoreState: 'active' | 'muted' = analysisComplete && !quality.mutedScore ? 'active' : 'muted';
    const showGenerateActions = !analysisComplete && !isLabelStreaming;

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

        <AnalysisDashboard
          analysis={analysisWithLabelName as any}
          isStreaming={isLabelStreaming}
          scoreBadge="Label-only estimate"
          scoreState={scoreState}
          sourceType="label_scan"
          labelDraft={labelDraft ?? undefined}
        />

        {!analysisComplete ? (
          <View style={styles.labelCard}>
            <Text style={styles.labelCardTitle}>AI Analysis</Text>
            <Text style={styles.labelMeta}>
              {labelAnalysisStatus === 'pending'
                ? 'Analyzing label...'
                : labelAnalysisStatus === 'partial'
                  ? 'Analysis partially available. Some sections could not be generated.'
                : labelAnalysisStatus === 'unavailable'
                  ? 'Analysis service is unavailable right now.'
                  : 'Analysis is not generated yet.'}
            </Text>
            {labelAnalysisError ? (
              <Text style={styles.analysisErrorText}>{labelAnalysisError}</Text>
            ) : null}
            {showGenerateActions ? (
              <View style={styles.analysisActionRow}>
                <TouchableOpacity
                  style={[styles.analysisButton, labelAnalysisLoading ? styles.analysisButtonDisabled : null]}
                  onPress={handleGenerateAnalysis}
                  disabled={labelAnalysisLoading}
                >
                  <Text style={styles.analysisButtonText}>
                    {labelAnalysisStatus === 'partial'
                      ? 'Retry analysis'
                      : needsReview
                        ? 'Confirm & Generate'
                        : 'Generate analysis'}
                  </Text>
                </TouchableOpacity>
                {needsReview ? (
                  <TouchableOpacity
                    style={[styles.secondaryActionButton, labelAnalysisLoading ? styles.analysisButtonDisabled : null]}
                    onPress={handleGenerateAnalysis}
                    disabled={labelAnalysisLoading}
                  >
                    <Text style={styles.secondaryActionText}>Generate anyway</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.labelCard}>
          <View style={styles.evidenceHeader}>
            <Text style={styles.labelCardTitle}>Label Evidence</Text>
            <TouchableOpacity
              onPress={() => setEvidenceExpanded((prev) => !prev)}
              activeOpacity={0.7}
            >
              <Text style={styles.evidenceToggle}>
                {evidenceExpanded ? 'Hide' : 'View'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.evidenceSummary}>{evidenceSummary}</Text>
          {needsReview ? (
            <Text style={styles.evidenceWarning}>
              Review recommended. Extraction quality is low; confirm evidence before relying on AI analysis.
            </Text>
          ) : null}
          {evidenceExpanded ? (
            <View style={styles.labelMetaGroup}>
              <Text style={styles.labelMetaTight}>Product: {labelProductName}</Text>
              {labelNameCandidate ? (
                <Text style={styles.labelMetaTight}>Top ingredient: {labelNameCandidate}</Text>
              ) : null}
              {draft?.servingSize ? (
                <Text style={styles.labelMetaTight}>Serving Size: {draft.servingSize}</Text>
              ) : (
                <Text style={styles.labelMetaTight}>Serving Size: Not detected</Text>
              )}
              <Text style={styles.labelMetaTight}>
              Extraction Quality: {quality.extractionQuality} ({Math.round((draft?.confidenceScore ?? 0) * 100)}%)
            </Text>
            <Text style={styles.labelMetaTight}>
              Coverage: {Math.round((draft?.parseCoverage ?? 0) * 100)}% | {quality.validCount} valid ingredients
            </Text>
              {ingredientsToShow.length > 0 ? (
                <View style={styles.labelList}>
                  {ingredientsToShow.map((ingredient, index) => (
                    <Text key={`${ingredient.name}-${index}`} style={styles.labelItem}>
                      {formatDraftIngredient(ingredient)}
                    </Text>
                  ))}
                </View>
              ) : (
                <Text style={styles.labelEmpty}>No ingredients detected.</Text>
              )}
              {issues.length > 0 ? (
                <View style={styles.labelIssues}>
                  <Text style={styles.labelCardTitle}>Issues Detected</Text>
                  {issues.map((issue, index) => (
                    <Text key={`${issue.type}-${index}`} style={styles.labelItem}>
                      {issue.message}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

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
  if (barcodeQuality.errorState) {
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
      <AnalysisDashboard
        analysis={compositeAnalysis}
        isStreaming={isStreaming}
        sourceType="barcode"
      />

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
  labelMetaTight: { fontSize: 13, color: '#6b7280' },
  labelMetaGroup: { gap: 4, marginBottom: 12 },
  labelList: { marginTop: 4 },
  labelItem: { fontSize: 14, color: '#111827', marginBottom: 6, lineHeight: 20 },
  labelEmpty: { fontSize: 14, color: '#6b7280' },
  labelIssues: { marginTop: 16 },
  evidenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  evidenceToggle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563eb',
  },
  evidenceSummary: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 12,
  },
  evidenceWarning: {
    fontSize: 12,
    color: '#b91c1c',
    marginBottom: 12,
  },
  analysisButton: {
    marginTop: 8,
    backgroundColor: '#111827',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  analysisActionRow: {
    marginTop: 8,
    gap: 8,
  },
  secondaryActionButton: {
    marginTop: 4,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d4d4d8',
    alignItems: 'center',
  },
  secondaryActionText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '600',
  },
  analysisButtonDisabled: {
    backgroundColor: '#6b7280',
    borderColor: '#6b7280',
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
