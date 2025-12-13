import { CameraView, useCameraPermissions, type BarcodeScanningResult, type BarcodeType } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Stack, router } from 'expo-router';
import { CameraOff, Check, Flashlight, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import type { DesignTokens } from '@/constants/designTokens';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';
import { ensureSessionId, setScanSession } from '@/lib/scan/session';

const SUPPORTED_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] as const;
const BARCODE_TYPES = SUPPORTED_TYPES as unknown as BarcodeType[];

type ScanStatus = 'idle' | 'processing' | 'success' | 'error';

const { width, height } = Dimensions.get('window');
// Apple Wallet style dimensions
const SCAN_FRAME_WIDTH = width * 0.85;
const SCAN_FRAME_HEIGHT = 200; // Fixed height for barcode shape
const SCAN_FRAME_RADIUS = 16;

const normalizeBarcodeCandidate = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const sequences = trimmed.match(/\d{8,14}/g);
  if (sequences && sequences.length > 0) {
    return [...sequences].sort((a, b) => b.length - a.length)[0] ?? null;
  }

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length >= 8 && digitsOnly.length <= 14) {
    return digitsOnly;
  }

  return null;
};

export default function BarcodeScanScreen() {
  const { tokens } = useResponsiveTokens();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(tokens, insets.top, insets.bottom), [tokens, insets.bottom, insets.top]);
  const [permission, requestPermission] = useCameraPermissions();
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [status, setStatus] = useState<ScanStatus>('idle');
  const processingRef = useRef(false);

  // Animation values
  const checkmarkScale = useSharedValue(0);
  const checkmarkOpacity = useSharedValue(0);

  useEffect(() => {
    if (!permission) {
      requestPermission().catch(() => undefined);
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    // Reset state on mount
    processingRef.current = false;
    setStatus('idle');
    checkmarkScale.value = 0;
    checkmarkOpacity.value = 0;
  }, []);

  const navigateToResult = useCallback(() => {
    router.replace('/scan/result');
  }, []);

  const handleBarcode = useCallback(
    async (result: BarcodeScanningResult) => {
      if (processingRef.current || status !== 'idle') {
        return;
      }

      const normalized = normalizeBarcodeCandidate(result.data);
      if (!normalized) {
        setStatus('error');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTimeout(() => {
          setStatus('idle');
        }, 1200);
        return;
      }

      processingRef.current = true;
      setStatus('processing'); // Temporarily processing before success

      // Immediate feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      try {
        // Start backend request in background, but show success immediately for UI responsiveness
        // In a real app, you might want to wait for at least a "valid barcode" check
        // For this UX, we assume valid scan = success

        setStatus('success');

        // Animate checkmark
        checkmarkScale.value = withSpring(1, { damping: 12 });
        checkmarkOpacity.value = withTiming(1, { duration: 200 });

        // Set session to loading and navigate
        setScanSession({
          id: ensureSessionId(),
          mode: 'barcode',
          input: { barcode: normalized },
          isLoading: true,
        });

        // Delay navigation to let user see the checkmark
        setTimeout(() => {
          runOnJS(navigateToResult)();
        }, 800);

      } catch (error) {
        console.warn('[scan] barcode processing failed', error);
        // Reset on error
        setStatus('error');
        processingRef.current = false;
        // Optional: Error haptic
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

        // Auto-reset after error
        setTimeout(() => {
          setStatus('idle');
        }, 2000);
      }
    },
    [status, navigateToResult, checkmarkScale, checkmarkOpacity],
  );

  const checkmarkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkmarkScale.value }],
    opacity: checkmarkOpacity.value,
  }));

  if (!permission || !permission.granted) {
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


      {/* Simple Rounded Rectangle Frame */}
      <View style={styles.frameContainer}>
        <View style={styles.roundedFrame}>
          {/* Success Checkmark */}
          {status === 'success' && (
            <Animated.View style={[styles.successContainer, checkmarkStyle]}>
              <View style={styles.successCircle}>
                <Check size={48} color="#fff" strokeWidth={3} />
              </View>
            </Animated.View>
          )}
        </View>
      </View>


      {/* UI Controls */}
      <SafeAreaView edges={['top']} style={styles.topControls}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <X size={24} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.iconButton, torchEnabled && styles.iconButtonActive]}
          onPress={() => setTorchEnabled(p => !p)}
          activeOpacity={0.8}
        >
          <Flashlight size={20} color={torchEnabled ? '#000' : '#fff'} fill={torchEnabled ? '#000' : 'none'} />
        </TouchableOpacity>
      </SafeAreaView>

      <SafeAreaView edges={['bottom']} style={styles.bottomControls}>
        <Text style={styles.instructionText}>
          {status === 'success' ? 'Scanned!' : 'Align barcode within frame'}
        </Text>

        <TouchableOpacity
          style={styles.manualButton}
          activeOpacity={0.8}
          onPress={() => router.push({ pathname: '/scan/label', params: { from: 'barcode' } })}
        >
          <Text style={styles.manualButtonText}>Enter code manually</Text>
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


    // Frame
    frameContainer: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
      pointerEvents: 'none',
    },
    roundedFrame: {
      width: SCAN_FRAME_WIDTH,
      height: SCAN_FRAME_HEIGHT,
      borderRadius: SCAN_FRAME_RADIUS,
      borderWidth: 3,
      borderColor: '#fff',
      justifyContent: 'center',
      alignItems: 'center',
    },


    // Success Animation
    successContainer: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    successCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: '#22c55e', // Green-500
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#22c55e',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.5,
      shadowRadius: 12,
      elevation: 8,
    },

    // Controls
    topControls: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 24,
      paddingTop: 12,
    },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    iconButtonActive: {
      backgroundColor: '#fff',
    },

    bottomControls: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      alignItems: 'center',
      paddingBottom: 40,
      gap: 24,
    },
    instructionText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '500',
      opacity: 0.9,
    },
    manualButton: {
      paddingVertical: 12,
      paddingHorizontal: 24,
    },
    manualButtonText: {
      color: '#fff',
      fontSize: 14,
      opacity: 0.7,
      textDecorationLine: 'underline',
    },
  });
