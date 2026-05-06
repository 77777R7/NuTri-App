import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { getPostAuthDestination, useAuth } from '@/contexts/AuthContext';
import { claimGuestScanSessionOnServer } from '@/lib/api/guestScan';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { getLastGuestScanSession } from '@/lib/scan/guestSession';

const normalizeLocalPath = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) return '/main';
  const trimmed = value.trim();
  return trimmed.startsWith('/') && !trimmed.startsWith('//') ? trimmed : '/main';
};

export default function GuestScanClaimScreen() {
  const { session, loading } = useAuth();
  const params = useLocalSearchParams<{ guestScanSessionId?: string; returnTo?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [fallbackGuestScanSessionId, setFallbackGuestScanSessionId] = useState('');
  const [fallbackResolved, setFallbackResolved] = useState(false);

  const routeGuestScanSessionId = useMemo(
    () => (typeof params.guestScanSessionId === 'string' ? params.guestScanSessionId.trim() : ''),
    [params.guestScanSessionId],
  );
  const guestScanSessionId = routeGuestScanSessionId || fallbackGuestScanSessionId;
  const returnTo = useMemo(() => normalizeLocalPath(params.returnTo), [params.returnTo]);

  useEffect(() => {
    let cancelled = false;

    if (routeGuestScanSessionId) {
      setFallbackGuestScanSessionId('');
      setFallbackResolved(true);
      return () => {
        cancelled = true;
      };
    }

    setFallbackGuestScanSessionId('');
    setFallbackResolved(false);
    void getLastGuestScanSession()
      .then((lastSession) => {
        if (cancelled) return;
        setFallbackGuestScanSessionId(lastSession?.guestScanSessionId ?? '');
      })
      .finally(() => {
        if (cancelled) return;
        setFallbackResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, [routeGuestScanSessionId]);

  useEffect(() => {
    if (loading) return;
    if (!guestScanSessionId && !fallbackResolved) return;

    if (!session?.user) {
      const redirect = `/guest-scan/claim?guestScanSessionId=${encodeURIComponent(guestScanSessionId)}&returnTo=${encodeURIComponent(returnTo)}`;
      router.replace({
        pathname: '/auth/login',
        params: { redirect },
      });
      return;
    }

    if (!guestScanSessionId) {
      setError('Missing guest scan session.');
      return;
    }

    let cancelled = false;
    setError(null);
    void claimGuestScanSessionOnServer(guestScanSessionId)
      .then((claimResult) => {
        if (!claimResult) {
          throw new Error('Guest scan session not found on this device.');
        }
        if (cancelled) return;
        trackOnboardingEvent('guest_scan_claim_succeeded', {
          source: 'guest_scan_claim',
          guestScanSessionId,
          status: claimResult.status,
        });
        router.replace(getPostAuthDestination(returnTo));
      })
      .catch((claimError) => {
        if (cancelled) return;
        const message = claimError instanceof Error ? claimError.message : 'Guest scan claim failed.';
        trackOnboardingEvent('guest_scan_claim_failed', {
          source: 'guest_scan_claim',
          guestScanSessionId,
          reason: message,
        });
        setError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [guestScanSessionId, loading, returnTo, session?.user]);

  return (
    <View style={styles.screen}>
      <ActivityIndicator color="#2563EB" />
      <Text style={styles.title}>{error ?? 'Saving your scan...'}</Text>
      {error ? (
        <TouchableOpacity
          onPress={() => router.replace(getPostAuthDestination(returnTo))}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel="Return to scan result"
        >
          <Text style={styles.buttonText}>Return to result</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F8FAFC',
  },
  title: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
  },
  button: {
    marginTop: 18,
    borderRadius: 999,
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
