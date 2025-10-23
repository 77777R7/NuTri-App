import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandGradient } from '@/components/BrandGradient';
import AppHeader from '@/components/common/AppHeader';
import { PrimaryButton } from '@/components/ui/Buttons';
import { useQA } from '@/contexts/QAContext';
import { colors, radii, spacing } from '@/lib/theme';

export default function QAWelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setStep } = useQA();

  const handleGetStarted = async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    setStep(2);
    router.push('/qa/demographics');
  };

  const features = [
    {
      emoji: '🔍',
      title: 'Smart Scanning',
      description: 'Instantly analyze supplements with AI-powered label recognition',
    },
    {
      emoji: '🧠',
      title: 'Evidence-Based AI',
      description: 'Get recommendations backed by scientific research and studies',
    },
    {
      emoji: '🛡️',
      title: 'Safety Tracking',
      description: 'Monitor interactions and get alerts for potential issues',
    },
    {
      emoji: '✨',
      title: 'Personalized',
      description: 'Tailored insights based on your health goals and profile',
    },
  ];

  return (
    <BrandGradient>
      <View style={styles.container}>
        <AppHeader title="Q&A Assessment" showBack fallbackHref="/(tabs)/qa" />
        
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 16) + 120 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero Section */}
          <View style={styles.hero}>
            <Text style={styles.emoji}>👋</Text>
            <Text style={styles.title}>Welcome to NuTri Q&A</Text>
            <Text style={styles.subtitle}>
              Let's get to know you better so we can provide personalized supplement recommendations
            </Text>
          </View>

          {/* Feature Cards */}
          <View style={styles.featuresGrid}>
            {features.map((feature, index) => (
              <View key={index} style={styles.featureCard}>
                <Text style={styles.featureEmoji}>{feature.emoji}</Text>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureDescription}>{feature.description}</Text>
              </View>
            ))}
          </View>

          {/* Fun Fact Card */}
          <View style={styles.funFactCard}>
            <Text style={styles.funFactTitle}>💡 Did you know?</Text>
            <Text style={styles.funFactText}>
              The global supplement market is worth over $150 billion, but studies show that 
              personalized recommendations are 3x more effective than generic advice.
            </Text>
          </View>

          {/* Info Box */}
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              This assessment takes about <Text style={styles.infoBold}>2-3 minutes</Text> and consists of <Text style={styles.infoBold}>7 simple steps</Text>.
            </Text>
          </View>
        </ScrollView>

        {/* Fixed Bottom Button */}
        <View style={[styles.bottomContainer, { bottom: Math.max(insets.bottom, 16) + 16 }]}>
          <PrimaryButton
            title="Get Started →"
            onPress={handleGetStarted}
            style={styles.button}
            testID="qa-get-started"
          />
        </View>
      </View>
    </BrandGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
  },
  hero: {
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },
  emoji: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 17,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: spacing.md,
  },
  featuresGrid: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  featureCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  featureEmoji: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  featureTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  featureDescription: {
    fontSize: 15,
    color: colors.textMuted,
    lineHeight: 21,
  },
  funFactCard: {
    backgroundColor: 'rgba(16,185,129,0.08)',
    borderRadius: radii.xl,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.2)',
  },
  funFactTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.brandDark,
    marginBottom: spacing.sm,
  },
  funFactText: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
  },
  infoBox: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  infoBold: {
    fontWeight: '700',
    color: colors.text,
  },
  bottomContainer: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
  },
  button: {
    height: 56,
  },
});

