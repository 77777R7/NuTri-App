import { CameraView, useCameraPermissions, type CameraPictureOptions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Camera, ImageIcon, RefreshCcw } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import type { DesignTokens } from '@/constants/designTokens';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';
import { submitLabelScan } from '@/lib/scan/service';
import { ensureSessionId, setScanSession } from '@/lib/scan/session';

type ScanStatus = 'idle' | 'preview' | 'processing' | 'error';

export default function LabelScanScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode = params.mode === 'upload' ? 'upload' : 'capture';

  const { tokens } = useResponsiveTokens();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(tokens, insets.top, insets.bottom), [tokens, insets.bottom, insets.top]);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [galleryPermission, requestGalleryPermission] = ImagePicker.useMediaLibraryPermissions();

  const cameraRef = useRef<CameraView | null>(null);
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewBase64, setPreviewBase64] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!cameraPermission || cameraPermission.status === 'undetermined') {
      requestCameraPermission().catch(() => undefined);
    }
  }, [cameraPermission, requestCameraPermission]);

  useEffect(() => {
    if (mode === 'upload') {
      pickFromLibrary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const pickFromLibrary = useCallback(async () => {
    if (!galleryPermission?.granted) {
      const response = await requestGalleryPermission();
      if (!response?.granted) {
        setErrorMessage('Gallery permission is required to upload an image.');
        setStatus('error');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets.length > 0) {
      setPreviewUri(result.assets[0].uri ?? null);
      setPreviewBase64(result.assets[0].base64 ?? null);
      setStatus('preview');
      setErrorMessage(null);
    }
  }, [galleryPermission, requestGalleryPermission]);

  const handleTakePicture = useCallback(async () => {
    if (!cameraRef.current || status === 'processing') {
      return;
    }

    try {
      setStatus('processing');
      setErrorMessage(null);
      const options: CameraPictureOptions = {
        quality: 0.8,
        skipProcessing: Platform.OS === 'android',
        base64: true,
      };
      const photo = await cameraRef.current.takePictureAsync(options);
      if (photo?.uri) {
        setPreviewUri(photo.uri);
        setPreviewBase64(photo.base64 ?? null);
        setStatus('preview');
      } else {
        throw new Error('No photo captured');
      }
    } catch (error) {
      console.warn('[scan] capture failed', error);
      setErrorMessage('Unable to capture photo. Please try again.');
      setStatus('error');
    }
  }, [status]);

  const handleSubmit = useCallback(async () => {
    if (!previewUri || status === 'processing') {
      return;
    }

    try {
      if (!previewBase64) {
        setErrorMessage('Image data was not available. Please try again.');
        setStatus('error');
        return;
      }
      setStatus('processing');
      const scanResult = await submitLabelScan({ imageUri: previewUri, imageBase64: previewBase64 });
      setScanSession({
        id: ensureSessionId(),
        mode: 'label',
        input: { imageUri: previewUri },
        result: scanResult,
      });
      router.replace('/scan/result');
    } catch (error) {
      console.warn('[scan] label processing failed', error);
      setErrorMessage('We could not read the label. Try retaking the photo.');
      setStatus('error');
    }
  }, [previewBase64, previewUri, status]);

  const handleRetry = useCallback(() => {
    setPreviewUri(null);
    setPreviewBase64(null);
    setStatus('idle');
    setErrorMessage(null);
  }, []);

  const isCameraPermissionLoading = !cameraPermission || cameraPermission.status === 'undetermined';

  if (isCameraPermissionLoading) {
    return (
      <View style={styles.loadingScreen}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  if (!cameraPermission.granted && mode === 'capture') {
    return (
      <ResponsiveScreen contentStyle={styles.permissionScreen}>
        <View style={styles.permissionCard}>
          <Camera size={32} color={tokens.colors.textPrimary} />
          <Text style={styles.permissionTitle}>Camera access denied</Text>
          <Text style={styles.permissionCopy}>Enable access from settings or choose Upload Photo instead.</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={() => requestCameraPermission()}>
            <Text style={styles.permissionButtonText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.altButton} onPress={pickFromLibrary}>
            <Text style={styles.altButtonText}>Upload from gallery</Text>
          </TouchableOpacity>
        </View>
      </ResponsiveScreen>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      {previewUri ? (
        <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="contain" />
      ) : (
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      )}

      <SafeAreaView edges={['top']} style={styles.topOverlay}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.85}>
          <ArrowLeft size={20} color={tokens.colors.surface} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.galleryButton} onPress={pickFromLibrary} activeOpacity={0.85}>
          <ImageIcon size={18} color={tokens.colors.surface} />
        </TouchableOpacity>
      </SafeAreaView>

      <SafeAreaView edges={['bottom']} style={styles.bottomOverlay}>
        {previewUri ? (
          <View style={styles.previewActions}>
            <TouchableOpacity style={[styles.secondaryButton, styles.previewButton]} onPress={handleRetry} activeOpacity={0.85}>
              <RefreshCcw size={16} color={tokens.colors.textPrimary} />
              <Text style={styles.secondaryText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, styles.previewButton]}
              onPress={handleSubmit}
              activeOpacity={0.85}
              disabled={status === 'processing'}
            >
              {status === 'processing' ? (
                <ActivityIndicator color={tokens.colors.surface} />
              ) : (
                <Text style={styles.primaryText}>Use this photo</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.primaryButton} onPress={handleTakePicture} activeOpacity={0.85}>
            <Text style={styles.primaryText}>Tap to capture label</Text>
          </TouchableOpacity>
        )}

        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

        <Text style={styles.tipText}>
          Make sure the entire supplement facts panel is visible and in focus.
        </Text>
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
    loadingScreen: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#000',
    },
    camera: {
      flex: 1,
    },
    preview: {
      flex: 1,
      width: '100%',
      backgroundColor: '#000',
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
    galleryButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.35)',
    },
    primaryButton: {
      height: 56,
      borderRadius: tokens.components.card.radius,
      backgroundColor: tokens.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: {
      color: tokens.colors.surface,
      ...tokens.typography.subtitle,
    },
    secondaryButton: {
      borderRadius: tokens.components.card.radius,
      borderWidth: 1,
      borderColor: tokens.colors.surface,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens.spacing.xs,
    },
    secondaryText: {
      color: tokens.colors.surface,
      ...tokens.typography.body,
    },
    previewActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: tokens.spacing.md,
    },
    previewButton: {
      flex: 1,
    },
    errorText: {
      textAlign: 'center',
      color: tokens.colors.surface,
      ...tokens.typography.body,
    },
    tipText: {
      textAlign: 'center',
      color: tokens.colors.surface,
      ...tokens.typography.bodySmall,
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
    altButton: {
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
      borderRadius: tokens.radius.full,
      backgroundColor: tokens.colors.surfaceMuted,
    },
    altButtonText: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.body,
    },
  });
