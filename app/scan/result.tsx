import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, FileText, Loader2 } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import { OrganicSpinner } from '@/components/ui/OrganicSpinner';
import { ShinyText } from '@/components/ui/ShinyText';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';
import { useStreamAnalysis } from '@/hooks/useStreamAnalysis';
import { consumeScanSession, type ScanSession } from '@/lib/scan/session';
import { AnalysisDashboard } from './AnalysisDashboard';

export default function ScanResultScreen() {
  const { tokens } = useResponsiveTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  // Get session to retrieve barcode
  const [session] = useState<ScanSession | null>(() => consumeScanSession());
  const barcode = session?.mode === 'barcode' ? session.input.barcode : '';

  // 🚀 Use the Streaming Hook
  const {
    productInfo, efficacy, safety, usage, value, social, status, error
  } = useStreamAnalysis(barcode);

  useEffect(() => {
    if (!session) {
      router.replace('/(tabs)/scan');
    }
  }, [session]);

  const handleBack = () => router.replace('/(tabs)/scan');

  if (!session) return null;

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

  // 2. Initial Loading (Before we even know the product name)
  // This should be very fast (<1s)
  if (!productInfo && status === 'loading') {
    return (
      <ResponsiveScreen contentStyle={styles.loadingContainer}>
        <Loader2 size={48} color="#000" style={{ marginBottom: 16 }} />
        <Text style={styles.loadingTitle}>Searching...</Text>
      </ResponsiveScreen>
    );
  }

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
    <ResponsiveScreen contentStyle={styles.screen}>
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
  loadingTitle: { fontSize: 18, fontWeight: '600', color: '#52525b' },
  fallbackContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  fallbackTitle: { fontSize: 24, fontWeight: 'bold', color: '#000', marginTop: 20 },
  fallbackText: { fontSize: 16, color: '#52525b', marginTop: 10, textAlign: 'center' },

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
