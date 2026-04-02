import React from 'react';
import { StyleSheet, View } from 'react-native';

import { onboardingPalette } from '../shared/theme';

type SelectionControlProps = {
  selected?: boolean;
  mode?: 'single' | 'multiple';
};

export function SelectionControl({
  selected = false,
  mode = 'single',
}: SelectionControlProps) {
  return (
    <View
      style={[
        styles.control,
        mode === 'multiple' ? styles.controlMultiple : null,
        selected ? styles.controlSelected : null,
      ]}
    >
      <View
        style={[
          styles.indicator,
          mode === 'multiple' ? styles.indicatorMultiple : null,
          selected ? styles.indicatorSelected : null,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  control: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'rgba(11,22,56,0.10)',
    backgroundColor: 'rgba(255,255,255,0.56)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlMultiple: {
    borderRadius: 11,
  },
  controlSelected: {
    backgroundColor: onboardingPalette.primary,
    borderColor: onboardingPalette.primary,
    shadowColor: onboardingPalette.primary,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
    opacity: 0,
    transform: [{ scale: 0 }],
  },
  indicatorMultiple: {
    borderRadius: 4,
  },
  indicatorSelected: {
    opacity: 1,
    transform: [{ scale: 1 }],
  },
});

export default SelectionControl;
