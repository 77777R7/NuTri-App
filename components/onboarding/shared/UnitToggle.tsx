import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '@/lib/theme';

type UnitToggleProps = {
  label: string;
  type: 'height' | 'weight';
  value?: number;
  onChange: (metricValue?: number) => void;
  onBlur?: () => void;
  error?: string;
};

type UnitMode = 'metric' | 'imperial';

const sanitizeDecimal = (value: string) => value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
const sanitizeInteger = (value: string) => value.replace(/[^0-9]/g, '');

const roundTo = (value: number, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const cmToImperial = (cm: number) => {
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const remainingInches = Math.round(totalInches - feet * 12);

  if (remainingInches === 12) {
    return { feet: feet + 1, inches: 0 };
  }

  return { feet, inches: remainingInches };
};

const imperialToCm = (feetText: string, inchesText: string) => {
  const feet = Number(feetText);
  const inches = Number(inchesText);
  if (!Number.isFinite(feet) && !Number.isFinite(inches)) {
    return undefined;
  }

  const safeFeet = Number.isFinite(feet) ? feet : 0;
  const safeInches = Number.isFinite(inches) ? inches : 0;
  const totalInches = safeFeet * 12 + safeInches;
  if (totalInches <= 0) {
    return undefined;
  }
  return roundTo(totalInches * 2.54, 1);
};

const kgToLbs = (kg: number) => roundTo(kg * 2.2046226218, 1);
const lbsToKg = (lbsText: string) => {
  const lbs = Number(lbsText);
  if (!Number.isFinite(lbs) || lbs <= 0) {
    return undefined;
  }
  return roundTo(lbs / 2.2046226218, 1);
};

export const UnitToggle = ({ label, type, value, onChange, onBlur, error }: UnitToggleProps) => {
  const [unit, setUnit] = useState<UnitMode>('metric');
  const [metricValue, setMetricValue] = useState('');
  const [feetValue, setFeetValue] = useState('');
  const [inchesValue, setInchesValue] = useState('');
  const [lbsValue, setLbsValue] = useState('');

  useEffect(() => {
    if (value === undefined) {
      setMetricValue('');
      setFeetValue('');
      setInchesValue('');
      setLbsValue('');
      return;
    }

    if (type === 'height') {
      setMetricValue(String(roundTo(value, 1)));
      const imperial = cmToImperial(value);
      setFeetValue(imperial.feet ? String(imperial.feet) : '');
      setInchesValue(imperial.inches ? String(imperial.inches) : imperial.inches === 0 ? '0' : '');
    } else {
      setMetricValue(String(roundTo(value, 1)));
      const lbs = kgToLbs(value);
      setLbsValue(lbs ? String(lbs) : '');
    }
  }, [type, value]);

  const handleUnitChange = useCallback(
    async (nextUnit: UnitMode) => {
      if (unit === nextUnit) return;
      try {
        await Haptics.selectionAsync();
      } catch {
        // noop
      }
      setUnit(nextUnit);
    },
    [unit],
  );

  const handleMetricChange = useCallback(
    (text: string) => {
      const sanitized = sanitizeDecimal(text);
      setMetricValue(sanitized);
      const numeric = Number(sanitized);
      if (!sanitized || !Number.isFinite(numeric) || numeric <= 0) {
        onChange(undefined);
        if (type === 'height') {
          setFeetValue('');
          setInchesValue('');
        } else {
          setLbsValue('');
        }
        return;
      }

      const rounded = type === 'height' ? roundTo(numeric, 1) : roundTo(numeric, 1);
      onChange(rounded);

      if (type === 'height') {
        const imperial = cmToImperial(rounded);
        setFeetValue(imperial.feet ? String(imperial.feet) : '');
        setInchesValue(imperial.inches ? String(imperial.inches) : imperial.inches === 0 ? '0' : '');
      } else {
        const lbs = kgToLbs(rounded);
        setLbsValue(String(lbs));
      }
    },
    [onChange, type],
  );

  const handleFeetChange = useCallback(
    (text: string) => {
      const sanitized = sanitizeInteger(text);
      setFeetValue(sanitized);
      const cm = imperialToCm(sanitized, inchesValue);
      if (!cm) {
        onChange(undefined);
        setMetricValue('');
        return;
      }
      onChange(cm);
      setMetricValue(String(roundTo(cm, 1)));
    },
    [inchesValue, onChange],
  );

  const handleInchesChange = useCallback(
    (text: string) => {
      const sanitized = sanitizeInteger(text);
      setInchesValue(sanitized);
      const cm = imperialToCm(feetValue, sanitized);
      if (!cm) {
        onChange(undefined);
        setMetricValue('');
        return;
      }
      onChange(cm);
      setMetricValue(String(roundTo(cm, 1)));
    },
    [feetValue, onChange],
  );

  const handleLbsChange = useCallback(
    (text: string) => {
      const sanitized = sanitizeDecimal(text);
      setLbsValue(sanitized);
      const kg = lbsToKg(sanitized);
      if (!kg) {
        onChange(undefined);
        setMetricValue('');
        return;
      }
      onChange(kg);
      setMetricValue(String(roundTo(kg, 1)));
    },
    [onChange],
  );

  const unitLabels = useMemo(() => {
    if (type === 'height') {
      return { metric: 'cm', imperial: 'ft / in' };
    }
    return { metric: 'kg', imperial: 'lbs' };
  }, [type]);

  return (
    <View style={styles.wrapper}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.toggleGroup}>
          <TouchableOpacity
            style={[styles.toggle, unit === 'metric' && styles.toggleActive]}
            onPress={() => handleUnitChange('metric')}
          >
            <Text style={[styles.toggleText, unit === 'metric' && styles.toggleTextActive]}>Metric</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggle, unit === 'imperial' && styles.toggleActive]}
            onPress={() => handleUnitChange('imperial')}
          >
            <Text style={[styles.toggleText, unit === 'imperial' && styles.toggleTextActive]}>Imperial</Text>
          </TouchableOpacity>
        </View>
      </View>

      {unit === 'metric' ? (
        <View style={[styles.inputWrapper, error ? styles.inputWrapperError : null]}>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={metricValue}
            onChangeText={handleMetricChange}
            onBlur={onBlur}
            placeholder={`Enter ${unitLabels.metric}`}
            placeholderTextColor="#94A3B8"
            inputMode="decimal"
          />
          <Text style={styles.unit}>{unitLabels.metric}</Text>
        </View>
      ) : type === 'height' ? (
        <View style={styles.imperialRow}>
          <View style={[styles.halfInputWrapper, error ? styles.inputWrapperError : null]}>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={feetValue}
              onChangeText={handleFeetChange}
              onBlur={onBlur}
              placeholder="ft"
              placeholderTextColor="#94A3B8"
              inputMode="numeric"
            />
            <Text style={styles.unit}>ft</Text>
          </View>
          <View style={[styles.halfInputWrapper, error ? styles.inputWrapperError : null]}>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={inchesValue}
              onChangeText={handleInchesChange}
              onBlur={onBlur}
              placeholder="in"
              placeholderTextColor="#94A3B8"
              inputMode="numeric"
            />
            <Text style={styles.unit}>in</Text>
          </View>
        </View>
      ) : (
        <View style={[styles.inputWrapper, error ? styles.inputWrapperError : null]}>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={lbsValue}
            onChangeText={handleLbsChange}
            onBlur={onBlur}
            placeholder={`Enter ${unitLabels.imperial}`}
            placeholderTextColor="#94A3B8"
            inputMode="decimal"
          />
          <Text style={styles.unit}>{unitLabels.imperial}</Text>
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    gap: 12,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  toggleGroup: {
    flexDirection: 'row',
    borderRadius: 999,
    backgroundColor: '#E6F4F0',
    padding: 2,
  },
  toggle: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  toggleActive: {
    backgroundColor: '#ffffff',
    ...{
      shadowColor: '#000000',
      shadowOpacity: 0.08,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  toggleTextActive: {
    color: colors.text,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    height: 56,
  },
  halfInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    height: 56,
    flex: 1,
  },
  inputWrapperError: {
    borderColor: '#F97373',
  },
  imperialRow: {
    flexDirection: 'row',
    gap: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
  unit: {
    marginLeft: 12,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textMuted,
  },
  error: {
    fontSize: 13,
    color: '#EF4444',
  },
});

export default UnitToggle;
