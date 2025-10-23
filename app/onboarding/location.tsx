import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import AppHeader from '@/components/common/AppHeader';
import { FormInput } from '@/components/onboarding/FormInput';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { PermissionCard } from '@/components/onboarding/PermissionCard';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { colors } from '@/lib/theme';
import { locationSchema, type LocationFormValues } from '@/lib/validation/onboarding';

const LocationScreen = () => {
  const router = useRouter();
  const { draft, loading, saveDraft } = useOnboarding();
  const [requestingLocation, setRequestingLocation] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);

  const { control, handleSubmit, formState, reset, setValue, watch } = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    mode: 'onChange',
    defaultValues: {
      country: draft?.location?.country ?? '',
      city: draft?.location?.city ?? '',
    },
  });

  const { isSubmitting } = formState;
  const country = watch('country');
  const city = watch('city');

  useEffect(() => {
    if (!loading) {
      reset({
        country: draft?.location?.country ?? '',
        city: draft?.location?.city ?? '',
      });
    }
  }, [draft?.location?.city, draft?.location?.country, loading, reset]);

  useEffect(() => {
    if (draft?.location?.country || draft?.location?.city) {
      setPermissionGranted(true);
    }
  }, [draft?.location?.city, draft?.location?.country]);

  const requestLocation = useCallback(async () => {
    try {
      setRequestingLocation(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== Location.PermissionStatus.GRANTED) {
        setPermissionGranted(false);
        Alert.alert('Permission needed', 'We could not access your location. You can enter it manually instead.');
        return;
      }
      setPermissionGranted(true);
      const position = await Location.getCurrentPositionAsync({});
      const [place] = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      if (place) {
        setValue('country', place.country ?? '');
        setValue('city', place.city ?? place.subregion ?? place.region ?? '');
      }
    } catch (error) {
      console.warn('Failed to retrieve location', error);
      Alert.alert('Oops', 'We were unable to detect your location. Please enter it manually.');
    } finally {
      setRequestingLocation(false);
    }
  }, [setValue]);

  const combinedLocation = useMemo(() => {
    const countryValue = country?.trim() ?? '';
    const cityValue = city?.trim() ?? '';
    if (!countryValue && !cityValue) {
      return undefined;
    }
    return {
      country: countryValue || undefined,
      city: cityValue || undefined,
    };
  }, [city, country]);

  const proceedToGoals = useCallback(() => {
    router.push('/onboarding/goals');
  }, [router]);

  const onSubmit = useCallback(
    async (values: LocationFormValues) => {
      const trimmedCountry = values.country?.trim() ?? '';
      const trimmedCity = values.city?.trim() ?? '';
      const payload = trimmedCountry || trimmedCity ? { country: trimmedCountry || undefined, city: trimmedCity || undefined } : undefined;

      try {
        await saveDraft({ location: payload }, 6);
        console.log('📍 Location set or skipped', payload ?? { skipped: true });
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        proceedToGoals();
      } catch (error) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        console.error('Failed to save location', error);
      }
    },
    [proceedToGoals, saveDraft],
  );

  const handleSkip = useCallback(async () => {
    try {
      await saveDraft({ location: undefined }, 6);
      console.log('📍 Location set or skipped', { skipped: true });
      proceedToGoals();
    } catch (error) {
      console.error('Failed to skip location step', error);
    }
  }, [proceedToGoals, saveDraft]);

  return (
    <>
      <AppHeader title="Step 5 of 7" showBack />
      <OnboardingContainer
        step={5}
        totalSteps={7}
        title="Where are you based?"
        subtitle="We use your location to tailor recommendations and account for seasonal changes."
        fallbackHref="/onboarding/welcome"
        onNext={handleSubmit(onSubmit)}
        disableNext={isSubmitting}
        showSkip
        onSkip={handleSkip}
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick setup</Text>
          <PermissionCard
            title="Use current location"
            description="Allow NuTri to detect your location automatically."
            value={Boolean(permissionGranted && (country || city))}
            loading={requestingLocation}
            onPress={requestLocation}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Or enter manually</Text>
          <View style={styles.inputs}>
            <FormInput control={control} name="country" label="Country" placeholder="Country" autoCapitalize="words" />
            <FormInput control={control} name="city" label="City" placeholder="City" autoCapitalize="words" />
          </View>
          {!combinedLocation ? <Text style={styles.helper}>You can skip this step if you prefer not to share your location now.</Text> : null}
        </View>
      </OnboardingContainer>
    </>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: 28,
    gap: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  inputs: {
    gap: 16,
  },
  helper: {
    fontSize: 14,
    color: colors.textMuted,
  },
});

export default LocationScreen;
