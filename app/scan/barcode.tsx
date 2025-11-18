import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowLeft, CameraOff, Flashlight, RefreshCcw, Scan } from 'lucide-react-native';
import { Stack, router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, type BarcodeScanningResult, type BarcodeType, useCameraPermissions } from 'expo-camera';

import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import type { DesignTokens } from '@/constants/designTokens';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';
import { ensureSessionId, setScanSession } from '@/lib/scan/session';
import { submitBarcodeScan } from '@/lib/scan/service';

const SUPPORTED_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] as const;
const BARCODE_TYPES = SUPPORTED_TYPES as unknown as BarcodeType[];

type ScanStatus = 'idle' | 'processing' | 'error';

export default function BarcodeScanScreen() {
  const { tokens } = useResponsiveTokens();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(tokens, insets.top, insets.bottom), [tokens, insets.bottom, insets.top]);
  const [permission, requestPermission] = useCameraPermissions();
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const processingRef = useRef(false);
  const [lastDetectedCode, setLastDetectedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!permission) {
      requestPermission().catch(() => undefined);
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    processingRef.current = false;
    setStatus('idle');
    setErrorMessage(null);
    setLastDetectedCode(null);
  }, []);

  const handleBarcode = useCallback(
    async (result: BarcodeScanningResult) => {
      if (processingRef.current || status === 'processing') {
        return;
      }

      processingRef.current = true;
      setStatus('processing');
      setErrorMessage(null);
      setLastDetectedCode(result.data);

      try {
        const scanResult = await submitBarcodeScan(result.data);
        setScanSession({
          id: ensureSessionId(),
          mode: 'barcode',
          input: { barcode: result.data },
          result: scanResult,
        });
        router.replace('/scan/result');
      } catch (error) {
        console.warn('[scan] barcode processing failed', error);
        setErrorMessage('We could not reach the search service. Please try again.');
        setStatus('error');
        processingRef.current = false;
      }
    },
    [status],
  );

  const handleRetry = useCallback(() => {
    setStatus('idle');
    setErrorMessage(null);
    setLastDetectedCode(null);
    processingRef.current = false;
  }, []);

  if (!permission) {
    return (
      <ResponsiveScreen contentStyle={styles.permissionScreen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.permissionCard}>
          <CameraOff size={32} color={tokens.colors.textPrimary} />
          <Text style={styles.permissionTitle}>Camera access needed</Text>
          <Text style={styles.permissionCopy}>
            Allow camera access so we can scan the barcode on your supplement.
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={() => requestPermission()}> 
            <Text style={styles.permissionButtonText}>Enable camera</Text>
          </TouchableOpacity>
        </View>
      </ResponsiveScreen>
    );
  }

  if (!permission.granted) {
    return (
      <ResponsiveScreen contentStyle={styles.permissionScreen}>
        <View style={styles.permissionCard}>
          <CameraOff size={32} color={tokens.colors.textPrimary} />
          <Text style={styles.permissionTitle}>Camera access denied</Text>
          <Text style={styles.permissionCopy}>
            You can enable access from system settings to use barcode scanning.
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={() => requestPermission()}>
            <Text style={styles.permissionButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </ResponsiveScreen>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView
        style={styles.camera}
        facing="back"
        enableTorch={torchEnabled}
        barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
        onBarcodeScanned={handleBarcode}
      />

      <SafeAreaView edges={[Platform.OS === 'android' ? 'top' : 'left', 'right']} style={styles.topOverlay}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.85}>
          <ArrowLeft size={20} color={tokens.colors.surface} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.backButton, torchEnabled ? styles.torchEnabled : null]}
          onPress={() => setTorchEnabled(prev => !prev)}
          activeOpacity={0.85}
        >
          <Flashlight size={18} color={torchEnabled ? tokens.colors.background : tokens.colors.surface} />
        </TouchableOpacity>
      </SafeAreaView>

      <View style={styles.focusFrame}>
        <View style={styles.focusCorner} />
        <View style={[styles.focusCorner, styles.focusCornerRight]} />
        <View style={[styles.focusCorner, styles.focusCornerBottom]} />
        <View style={[styles.focusCorner, styles.focusCornerBottomRight]} />
      </View>

      <SafeAreaView edges={['bottom']} style={styles.bottomOverlay}>
        <View style={styles.statusBadge}>
          <Scan size={16} color={tokens.colors.accent} />
          <Text style={styles.statusText}>
            {status === 'processing'
              ? 'Processing barcode...'
              : status === 'error'
              ? 'No match yet'
              : 'Align the barcode inside the frame'}
          </Text>
        </View>

        {lastDetectedCode ? <Text style={styles.codeText}>{lastDetectedCode}</Text> : null}

        {status === 'processing' ? (
          <View style={styles.processingRow}>
            <ActivityIndicator color={tokens.colors.surface} />
            <Text style={styles.processingCopy}>Looking up product details…</Text>
          </View>
        ) : null}

        {status === 'error' && errorMessage ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleRetry} activeOpacity={0.85}>
              <RefreshCcw size={16} color={tokens.colors.textPrimary} />
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.altModeButton}
          activeOpacity={0.85}
          onPress={() => router.push({ pathname: '/scan/label', params: { from: 'barcode' } })}
        >
          <Text style={styles.altModeText}>Barcode not working? Switch to label scan</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const createStyles = (tokens: DesignTokens, topInset: number, bottomInset: number) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#000',
    },
    camera: {
      flex: 1,
    },
    topOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingTop: topInset + tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    bottomOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingBottom: bottomInset + tokens.spacing.lg,
      paddingHorizontal: tokens.spacing.lg,
      gap: tokens.spacing.md,
    },
    backButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.35)',
    },
    torchEnabled: {
      backgroundColor: tokens.colors.surface,
      borderColor: 'transparent',
    },
    focusFrame: {
      position: 'absolute',
      top: '32%',
      left: '12%',
      right: '12%',
      bottom: '32%',
      borderRadius: tokens.radius.xl,
      borderColor: 'rgba(255,255,255,0.18)',
      borderWidth: 1,
    },
    focusCorner: {
      position: 'absolute',
      width: 28,
      height: 28,
      borderColor: '#fff',
      borderLeftWidth: 3,
      borderTopWidth: 3,
      borderRadius: tokens.radius.md,
    },
    focusCornerRight: {
      right: -1,
      transform: [{ rotate: '90deg' }],
    },
    focusCornerBottom: {
      bottom: -1,
      transform: [{ rotate: '-90deg' }],
    },
    focusCornerBottomRight: {
      right: -1,
      bottom: -1,
      transform: [{ rotate: '180deg' }],
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens.spacing.xs,
      alignSelf: 'center',
      paddingVertical: 8,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.full,
      backgroundColor: 'rgba(17, 24, 39, 0.64)',
    },
    statusText: {
      color: tokens.colors.surface,
      ...tokens.typography.bodySmall,
    },
    codeText: {
      textAlign: 'center',
      color: tokens.colors.surface,
      ...tokens.typography.body,
    },
    processingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens.spacing.sm,
    },
    processingCopy: {
      color: tokens.colors.surface,
      ...tokens.typography.body,
    },
    errorCard: {
      backgroundColor: 'rgba(17,24,39,0.82)',
      borderRadius: tokens.components.card.radius,
      padding: tokens.spacing.md,
      gap: tokens.spacing.sm,
    },
    errorText: {
      color: tokens.colors.surface,
      ...tokens.typography.body,
    },
    retryButton: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens.spacing.xs,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.xs,
      borderRadius: tokens.radius.full,
      backgroundColor: tokens.colors.surface,
    },
    retryText: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.bodySmall,
    },
    altModeButton: {
      borderRadius: tokens.radius.full,
      backgroundColor: 'rgba(17,24,39,0.72)',
      paddingVertical: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.lg,
      alignItems: 'center',
    },
    altModeText: {
      color: tokens.colors.surface,
      ...tokens.typography.body,
    },
    permissionScreen: {
      justifyContent: 'center',
      alignItems: 'center',
      gap: tokens.spacing.lg,
    },
    permissionCard: {
      width: '100%',
      maxWidth: 320,
      alignItems: 'center',
      gap: tokens.spacing.md,
      padding: tokens.spacing.lg,
      borderRadius: tokens.components.card.radius,
      backgroundColor: tokens.colors.surface,
      ...tokens.shadow.card,
    },
    permissionTitle: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.subtitle,
    },
    permissionCopy: {
      textAlign: 'center',
      color: tokens.colors.textMuted,
      ...tokens.typography.body,
    },
    permissionButton: {
      marginTop: tokens.spacing.xs,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
      borderRadius: tokens.radius.full,
      backgroundColor: tokens.colors.accent,
    },
    permissionButtonText: {
      color: tokens.colors.surface,
      ...tokens.typography.body,
    },
  });
