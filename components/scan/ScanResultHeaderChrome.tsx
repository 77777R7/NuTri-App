import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft } from 'lucide-react-native';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

type HeaderMiniScoreState = {
  overallScore: number;
  overallBand: string | null;
  muted: boolean;
};

type ScanResultHeaderChromeProps = {
  onBack: () => void;
  title: string;
  miniScore?: (HeaderMiniScoreState & { scrollY: SharedValue<number> }) | null;
  savePillState?: 'save' | 'saved' | 'disabled';
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

export const ScanResultHeaderChrome: React.FC<ScanResultHeaderChromeProps> = ({
  onBack,
  title,
  miniScore = null,
  savePillState = 'disabled',
  onSavePress,
  onOpenSaved,
  miniScoreThresholdStart = 210,
  miniScoreThresholdRange = 70,
}) => {
  const miniScoreTone = useMemo(
    () => (miniScore ? getHeaderOverallBandTone(miniScore.overallScore, miniScore.overallBand) : null),
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

  const handleSavePress = () => {
    if (savePillState === 'saved') {
      onOpenSaved?.();
      return;
    }
    if (savePillState === 'save') {
      onSavePress?.();
    }
  };

  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={({ pressed }) => [styles.chromeButton, pressed && styles.chromeButtonPressed]}>
        <BlurView intensity={18} tint="light" style={StyleSheet.absoluteFill} />
        <ChevronLeft size={22} color="#0B1E36" strokeWidth={2.5} />
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
                  {miniScore.muted ? '--' : Math.round(miniScore.overallScore)}
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
        style={({ pressed }) => [
          styles.savePill,
          savePillState === 'saved' && styles.savePillSaved,
          savePillState === 'disabled' && styles.savePillDisabled,
          pressed && savePillState !== 'disabled' ? styles.chromeButtonPressed : null,
        ]}
      >
        <BlurView intensity={18} tint="light" style={StyleSheet.absoluteFill} />
        <Text
          style={[
            styles.savePillText,
            savePillState === 'saved' && styles.savePillTextSaved,
            savePillState === 'disabled' && styles.savePillTextDisabled,
          ]}
        >
          {savePillState === 'saved' ? 'Saved' : 'Save'}
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: '#F2F2F7',
    zIndex: 10,
  },
  headerCenterSlot: {
    position: 'absolute',
    left: 86,
    right: 86,
    top: 4,
    bottom: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMiniScoreLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    lineHeight: 25.5,
    fontWeight: '600',
    color: '#0B1E36',
    letterSpacing: -0.86,
  },
  chromeButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 0.678,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  chromeButtonPressed: {
    opacity: 0.85,
  },
  savePill: {
    minWidth: 64,
    height: 40,
    borderRadius: 999,
    borderWidth: 0.678,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.4)',
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  savePillSaved: {
    borderColor: 'rgba(30,123,85,0.18)',
    backgroundColor: 'rgba(234,245,240,0.72)',
  },
  savePillDisabled: {
    borderColor: 'rgba(255,255,255,0.5)',
    backgroundColor: 'rgba(255,255,255,0.26)',
  },
  savePillText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    color: '#64748B',
    letterSpacing: -0.5,
  },
  savePillTextSaved: {
    color: '#1E7B55',
  },
  savePillTextDisabled: {
    color: '#94A3B8',
  },
  headerMiniScoreShell: {
    width: 56,
    height: 56,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#111827',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  headerMiniScoreShellMuted: {
    borderColor: 'rgba(203,213,225,0.8)',
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
    borderColor: 'rgba(203,213,225,0.9)',
    backgroundColor: 'rgba(248,250,252,0.84)',
  },
  headerMiniScoreText: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  headerMiniScoreTextMuted: {
    color: '#94A3B8',
  },
});

export default ScanResultHeaderChrome;
