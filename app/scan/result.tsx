import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, FileText } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AnalysisDashboard } from './AnalysisDashboard';
import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import { GradientIndicator } from '@/components/ui/GradientIndicator';
import type { DesignTokens } from '@/constants/designTokens';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';
import type { SupplementMatch } from '@/lib/scan/service';
import { submitBarcodeScan } from '@/lib/scan/service';
import { consumeScanSession, setScanSession, type ScanSession } from '@/lib/scan/session';

export default function ScanResultScreen() {
  const { tokens } = useResponsiveTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [ready, setReady] = useState(false);
  const [session, setLocalSession] = useState<ScanSession | null>(() => consumeScanSession());

  useEffect(() => {
    if (!session) {
      router.replace('/(tabs)/scan');
      return;
    }
    setReady(true);

    if (session.mode === 'barcode' && session.isLoading && session.input.barcode) {
      const performScan = async () => {
        try {
          const result = await submitBarcodeScan(session.input.barcode);
          setScanSession({ ...session, isLoading: false, result });
          setLocalSession((prev: any) => ({ ...prev, isLoading: false, result }));
        } catch (error) {
          console.error('Scan failed', error);
        }
      };
      performScan();
    }
  }, [session]);

  const handleBack = () => router.replace('/(tabs)/scan');

  if (!ready || !session) return null;

  if (session.mode === 'barcode' && session.isLoading) {
    return <AiLoadingView />;
  }

  const barcodeResult = session && session.mode === 'barcode' ? session.result : null;
  const analysis = barcodeResult?.analysis ?? null;
  const analysisSuccess = analysis && analysis.status === 'success' ? analysis : null;
  const supplements: SupplementMatch[] = session && session.mode === 'label' ? session.result.supplements ?? [] : [];
  const primarySupplement = supplements[0] ?? null;

  if (!analysisSuccess) {
    return (
      <ResponsiveScreen contentStyle={styles.screen}>
        <Header onBack={handleBack} title="Scan Result" />
        <View style={styles.fallbackContainer}>
          <FileText size={48} color="#52525b" />
          <Text style={styles.fallbackTitle}>
            {primarySupplement?.name || barcodeResult?.items?.[0]?.title || 'No Match Found'}
          </Text>
          <Text style={styles.fallbackText}>
            {primarySupplement?.description || barcodeResult?.items?.[0]?.snippet || 'Try scanning the label directly.'}
          </Text>
        </View>
      </ResponsiveScreen>
    );
  }

  return (
    <ResponsiveScreen contentStyle={styles.screen}>
      <StatusBar style="dark" />
      <Header onBack={handleBack} title="Analysis Result" />

      <AnalysisDashboard analysis={analysisSuccess} />
    </ResponsiveScreen>
  );
}

function Header({ onBack, title }: { onBack: () => void, title: string }) {
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

function AiLoadingView() {
  const { tokens } = useResponsiveTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [currentStep, setCurrentStep] = useState(0);
  const steps = ["Identifying product...", "Analyzing ingredients...", "Checking safety data...", "Finalizing report..."];

  useEffect(() => {
    if (currentStep < steps.length - 1) {
      const timeout = setTimeout(() => setCurrentStep(prev => prev + 1), 2000);
      return () => clearTimeout(timeout);
    }
  }, [currentStep]);

  return (
    <ResponsiveScreen contentStyle={styles.loadingContainer}>
      <View style={styles.loadingContent}>
        <Text style={styles.loadingTitle}>NuTri AI</Text>
        <Text style={styles.loadingSubtitle}>Analyzing your supplement</Text>
        <View style={styles.stepList}>
          {steps.map((step, index) => (
            <View key={step} style={styles.stepRow}>
              <GradientIndicator status={index < currentStep ? 'completed' : index === currentStep ? 'loading' : 'pending'} size={24} />
              <Text style={[styles.stepText, (index <= currentStep) && styles.stepTextActive]}>{step}</Text>
            </View>
          ))}
        </View>
      </View>
    </ResponsiveScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
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
  loadingContent: { width: '100%', maxWidth: 320 },
  loadingTitle: { fontSize: 32, fontWeight: 'bold', color: '#000', textAlign: 'center', marginBottom: 8 },
  loadingSubtitle: { fontSize: 16, color: '#52525b', textAlign: 'center', marginBottom: 40 },
  stepList: { gap: 20 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepText: { fontSize: 16, color: '#a1a1aa' },
  stepTextActive: { color: '#000', fontWeight: '600' },
  fallbackContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  fallbackTitle: { fontSize: 24, fontWeight: 'bold', color: '#000', marginTop: 20, textAlign: 'center' },
  fallbackText: { fontSize: 16, color: '#52525b', marginTop: 10, textAlign: 'center' },
});

const createStyles = (tokens: DesignTokens) => styles;
