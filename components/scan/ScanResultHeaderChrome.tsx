import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft } from 'lucide-react-native';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';

export type HeaderMiniScoreState = {
  overallScore: number | null;
  overallBand: string | null;
  muted: boolean;
};

type SaveState = 'save' | 'saved' | 'disabled';

type ScanResultHeaderChromeProps = {
  onBack: () => void;
  title: string;
  miniScore?: (HeaderMiniScoreState & { scrollY: SharedValue<number> }) | null;
  savePillState: SaveState;
  onSavePress?: () => void;
  onOpenSaved?: () => void;
  miniScoreThresholdStart?: number;
  miniScoreThresholdRange?: number;
};

const getHeaderOverallBandLabel = (score: number, explicitBand?: string | null): string => {
  const normalized = typeof explicitBand === 'string' ? explicitBand.trim() : '';
  if (normalized) return normalized;
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Strong';
  if (score >= 70) return 'Good';
  if (score >= 60) return 'Fair';
  if (score >= 45) return 'Limited';
  return 'Weak';
};

const getHeaderOverallBandTone = (score: number, explicitBand?: string | null) => {
  const band = getHeaderOverallBandLabel(score, explicitBand).toLowerCase();
  if (band === 'excellent') {
    return {
      bubbleBorder: 'rgba(21,128,61,0.24)',
      bubbleFill: 'rgba(21,128,61,0.16)',
      bubbleText: '#166534',
    };
  }
  if (band === 'strong') {
    return {
      bubbleBorder: 'rgba(22,163,74,0.24)',
      bubbleFill: 'rgba(22,163,74,0.16)',
      bubbleText: '#166534',
    };
  }
  if (band === 'good') {
    return {
      bubbleBorder: 'rgba(101,163,13,0.24)',
      bubbleFill: 'rgba(101,163,13,0.16)',
      bubbleText: '#4D7C0F',
    };
  }
  if (band === 'fair') {
    return {
      bubbleBorder: 'rgba(217,119,6,0.24)',
      bubbleFill: 'rgba(217,119,6,0.16)',
      bubbleText: '#B45309',
    };
  }
  if (band === 'limited') {
    return {
      bubbleBorder: 'rgba(234,88,12,0.24)',
      bubbleFill: 'rgba(234,88,12,0.16)',
      bubbleText: '#C2410C',
    };
  }
  return {
    bubbleBorder: 'rgba(220,38,38,0.24)',
    bubbleFill: 'rgba(220,38,38,0.16)',
    bubbleText: '#B91C1C',
  };
};

export function ScanResultHeaderChrome({
  onBack,
  title,
  miniScore,
  savePillState,
  onSavePress,
  onOpenSaved,
  miniScoreThresholdStart = 210,
  miniScoreThresholdRange = 70,
}: ScanResultHeaderChromeProps) {
  const miniScoreTone = useMemo(
    () => (miniScore ? getHeaderOverallBandTone(miniScore.overallScore ?? 0, miniScore.overallBand) : null),
    [miniScore],
  );

  const titleAnimatedStyle = useAnimatedStyle(() => {
    const progress = miniScore
      ? Math.max(0, Math.min(1, (miniScore.scrollY.value - miniScoreThresholdStart) / miniScoreThresholdRange))
      : 0;
    return {
      opacity: 1 - progress,
      transform: [{ translateY: progress * 8 }, { scale: 1 - progress * 0.06 }],
    };
  }, [miniScore, miniScoreThresholdRange, miniScoreThresholdStart]);

  const miniScoreAnimatedStyle = useAnimatedStyle(() => {
    const progress = miniScore
      ? Math.max(0, Math.min(1, (miniScore.scrollY.value - miniScoreThresholdStart) / miniScoreThresholdRange))
      : 0;
    return {
      opacity: progress,
      transform: [{ translateY: (1 - progress) * 10 }, { scale: 0.82 + progress * 0.18 }],
    };
  }, [miniScore, miniScoreThresholdRange, miniScoreThresholdStart]);

  const saveLabel = savePillState === 'saved' ? 'Saved' : 'Save';
  const handleSavePress = useCallback(() => {
    if (savePillState === 'disabled') return;
    if (savePillState === 'saved') {
      onOpenSaved?.();
      return;
    }
    onSavePress?.();
  }, [onOpenSaved, onSavePress, savePillState]);

  return (
    <View style={styles.header}>
      <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]} onPress={onBack}>
        <ArrowLeft size={20} color="#000" strokeWidth={2.5} />
      </Pressable>

      <View style={styles.headerCenterSlot} pointerEvents="none">
        <Animated.View style={[styles.headerTitleLayer, titleAnimatedStyle]}>
          <Text style={styles.headerTitle}>{title}</Text>
        </Animated.View>

        {miniScore && miniScoreTone ? (
          <Animated.View style={[styles.headerMiniScoreLayer, miniScoreAnimatedStyle]}>
            <LinearGradient
              colors={
                miniScore.muted
                  ? ['rgba(255,255,255,0.94)', 'rgba(241,245,249,0.78)']
                  : ['rgba(255,255,255,0.96)', miniScoreTone.bubbleFill]
              }
              locations={[0, 1]}
              start={{ x: 0.15, y: 0.05 }}
              end={{ x: 0.85, y: 1 }}
              style={[
                styles.headerMiniScoreShell,
                miniScore.muted ? styles.headerMiniScoreShellMuted : { borderColor: miniScoreTone.bubbleBorder },
              ]}
            >
              <View
                style={[
                  styles.headerMiniScoreCore,
                  miniScore.muted
                    ? styles.headerMiniScoreCoreMuted
                    : { borderColor: miniScoreTone.bubbleBorder, backgroundColor: 'rgba(255,255,255,0.34)' },
                ]}
              >
                <Text
                  style={[
                    styles.headerMiniScoreText,
                    miniScore.muted ? styles.headerMiniScoreTextMuted : { color: miniScoreTone.bubbleText },
                  ]}
                >
                  {miniScore.muted ? '--' : Math.round(miniScore.overallScore ?? 0)}
                </Text>
              </View>
            </LinearGradient>
          </Animated.View>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: savePillState === 'disabled' }}
        disabled={savePillState === 'disabled'}
        onPress={handleSavePress}
        style={({ pressed }) => [styles.savePillWrap, pressed && savePillState !== 'disabled' && styles.savePillPressed]}
      >
        <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFillObject} />
        <LinearGradient
          colors={savePillState === 'saved' ? ['rgba(235,248,240,0.9)', 'rgba(224,244,233,0.72)'] : ['rgba(255,255,255,0.88)', 'rgba(248,250,252,0.74)']}
          start={{ x: 0.12, y: 0.02 }}
          end={{ x: 0.88, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View
          style={[
            styles.savePillBorder,
            savePillState === 'saved' && styles.savePillBorderSaved,
            savePillState === 'disabled' && styles.savePillBorderDisabled,
          ]}
        />
        <Text
          style={[
            styles.savePillText,
            savePillState === 'saved' && styles.savePillTextSaved,
            savePillState === 'disabled' && styles.savePillTextDisabled,
          ]}
        >
          {saveLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
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
  backButtonPressed: {
    opacity: 0.82,
  },
  headerCenterSlot: {
    position: 'absolute',
    left: 76,
    right: 94,
    top: 16,
    bottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleLayer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  headerMiniScoreLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMiniScoreShell: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  headerMiniScoreShellMuted: {
    borderColor: 'rgba(203,213,225,0.56)',
  },
  headerMiniScoreCore: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerMiniScoreCoreMuted: {
    borderColor: 'rgba(203,213,225,0.4)',
    backgroundColor: 'rgba(255,255,255,0.44)',
  },
  headerMiniScoreText: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.55,
  },
  headerMiniScoreTextMuted: {
    color: '#94A3B8',
  },
  savePillWrap: {
    width: 72,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  savePillBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
  },
  savePillBorderSaved: {
    borderColor: 'rgba(30,123,85,0.18)',
  },
  savePillBorderDisabled: {
    borderColor: 'rgba(148,163,184,0.14)',
  },
  savePillPressed: {
    opacity: 0.86,
  },
  savePillText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2563EB',
    letterSpacing: -0.2,
  },
  savePillTextSaved: {
    color: '#1E7B55',
  },
  savePillTextDisabled: {
    color: '#94A3B8',
  },
});
