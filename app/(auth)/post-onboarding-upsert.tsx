import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';

import { BrandGradient } from '@/components/BrandGradient';
import { useAuth } from '@/contexts/AuthContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { supabase } from '@/lib/supabase';
import { upsertUserProfile } from '@/lib/supabase/profile';
import { colors } from '@/lib/theme';

const PostOnboardingUpsertScreen = () => {
  const router = useRouter();
  const { session } = useAuth();
  const { draft, trial, markCompletedLocal, setProgress, clearDraft, setServerSyncedAt } = useOnboarding();
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const runUpsert = async () => {
      if (!session?.user?.id) {
        setStatus('error');
        setErrorMessage('No active session.');
        console.warn('☁️ Upsert ERROR', 'Missing session user ID');
        return;
      }

      try {
        setStatus('loading');
        setErrorMessage(null);

        const result = await upsertUserProfile(supabase, session.user.id, draft, trial);

        if (!result.ok) {
          throw result.error ?? new Error('Unknown Supabase error');
        }

        console.log('☁️ Upsert OK');
        await markCompletedLocal();
        await clearDraft();
        const syncedAt = new Date().toISOString();
        await setServerSyncedAt(syncedAt);
        await setProgress(7);
        console.log('✅ Onboarding completed; entering tabs');
        router.replace('/(tabs)');
      } catch (error) {
        console.warn('☁️ Upsert ERROR', error);
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Unable to sync profile.');
      }
    };

    runUpsert();
  }, [draft, markCompletedLocal, router, saveDraft, session?.user?.id, setProgress, trial]);

  const handleRetry = () => {
    setStatus('loading');
    setErrorMessage(null);
    void (async () => {
      if (!session?.user?.id) {
        setStatus('error');
        setErrorMessage('No active session.');
        return;
      }
      try {
        const result = await upsertUserProfile(supabase, session.user.id, draft, trial);
        if (!result.ok) {
          throw result.error ?? new Error('Unknown Supabase error');
        }
        console.log('☁️ Upsert OK (retry)');
        await markCompletedLocal();
        await clearDraft();
        const syncedAt = new Date().toISOString();
        await setServerSyncedAt(syncedAt);
        await setProgress(7);
        router.replace('/(tabs)');
      } catch (error) {
        console.warn('☁️ Upsert ERROR', error);
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Unable to sync profile.');
      }
    })();
  };

  return (
    <BrandGradient>
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.title}>Saving your plan</Text>
          {status === 'loading' ? (
            <>
              <ActivityIndicator size="large" color={colors.brand} />
              <Text style={styles.subtitle}>We’re syncing your profile with NuTri’s cloud.</Text>
            </>
          ) : (
            <>
              <Text style={styles.errorTitle}>Sync failed</Text>
              <Text style={styles.errorMessage}>{errorMessage ?? 'Something went wrong while saving your plan.'}</Text>
            </>
          )}
        </View>

        {status === 'error' ? (
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        ) : null}
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#EF4444',
  },
  errorMessage: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 12,
  },
  retryButton: {
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
  retryText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
});

export default PostOnboardingUpsertScreen;
