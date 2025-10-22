import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { BrandGradient } from '@/components/BrandGradient';
import { ThemedText } from '@/components/themed-text';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { colors } from '@/lib/theme';

const TrialOfferScreen = () => {
  const router = useRouter();
  const { setTrial } = useOnboarding();

  const handleChoice = useCallback(
    async (status: 'active' | 'skipped') => {
      try {
        await Haptics.selectionAsync();
      } catch {
        // noop
      }

      const payload =
        status === 'active'
          ? {
              status: 'active' as const,
              startedAt: new Date().toISOString(),
            }
          : { status: 'skipped' as const };

      await setTrial(payload);
      console.log('🎁 Trial chosen', payload.status);
      router.push('/(auth)/gate');
    },
    [router, setTrial],
  );

  return (
    <BrandGradient>
      <View style={styles.container}>
        <ThemedText type="title" style={styles.headline}>
          Unlock the NuTri experience
        </ThemedText>
        <ThemedText style={styles.body}>
          Start a 3-day premium trial to explore full supplement insights, personalized routines, and AI-powered guidance.
        </ThemedText>

        <View style={styles.card}>
          <Text style={styles.cardHeadline}>Trial perks</Text>
          <View style={styles.bulletList}>
            <Text style={styles.bullet}>• Unlimited supplement scanning</Text>
            <Text style={styles.bullet}>• AI insights tailored to your goals</Text>
            <Text style={styles.bullet}>• Early access to experimental features</Text>
          </View>
          <Text style={styles.disclaimer}>You’ll roll onto the free plan automatically after 3 days unless you upgrade.</Text>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.primary} activeOpacity={0.92} onPress={() => handleChoice('active')}>
            <Text style={styles.primaryText}>Start 3-Day Free Trial</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} activeOpacity={0.9} onPress={() => handleChoice('skipped')}>
            <Text style={styles.secondaryText}>Continue with Free Plan</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BrandGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: 'space-between',
  },
  headline: {
    textAlign: 'center',
    fontSize: 30,
    lineHeight: 36,
    marginBottom: 12,
  },
  body: {
    textAlign: 'center',
    fontSize: 16,
    color: colors.textMuted,
    lineHeight: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    gap: 16,
    ...{
      shadowColor: '#000000',
      shadowOpacity: 0.08,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: 8,
    },
  },
  cardHeadline: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  bulletList: {
    gap: 8,
  },
  bullet: {
    fontSize: 15,
    color: colors.text,
  },
  disclaimer: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  footer: {
    gap: 12,
  },
  primary: {
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...{
      shadowColor: '#1B5C4E',
      shadowOpacity: 0.25,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  secondary: {
    height: 56,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
});

export default TrialOfferScreen;
