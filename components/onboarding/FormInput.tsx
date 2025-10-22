import React, { type ReactNode } from 'react';
import { Controller } from 'react-hook-form';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors } from '@/lib/theme';

type FormInputProps<TFieldValues = any> = {
  control: any;
  name: any;
  label: string;
  placeholder?: string;
  helperText?: string;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoCorrect?: boolean;
  secureTextEntry?: boolean;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  suffix?: ReactNode;
  parseValue?: (text: string) => unknown;
  formatValue?: (value: unknown) => string;
  inputMode?: TextInputProps['inputMode'];
};

export const FormInput = <TFieldValues = any>({
  control,
  name,
  label,
  placeholder,
  helperText,
  keyboardType,
  autoCapitalize,
  autoCorrect,
  secureTextEntry,
  returnKeyType,
  onSubmitEditing,
  suffix,
  parseValue,
  formatValue,
  inputMode,
}: FormInputProps<TFieldValues>) => {
  return (
    <Controller
      control={control}
      name={name}
      render={(controllerProps: any) => {
        const { field, fieldState } = controllerProps;
        const { onChange, onBlur, value } = field as {
          onChange: (val: unknown) => void;
          onBlur: () => void;
          value: unknown;
        };
        const { error } = fieldState;
        const displayValue =
          formatValue && value !== undefined
            ? formatValue(value)
            : typeof value === 'string'
              ? value
              : value !== undefined && value !== null
                ? String(value)
                : '';

        const handleChangeText = (text: string) => {
          const nextValue = parseValue ? parseValue(text) : text;
          onChange(nextValue);
        };

        return (
          <View style={styles.wrapper}>
            <Text style={styles.label}>{label}</Text>
            <View style={[styles.inputWrapper, error ? styles.inputWrapperError : null]}>
              <TextInput
                style={styles.input}
                placeholder={placeholder}
                placeholderTextColor="#94A3B8"
                value={displayValue}
                onChangeText={handleChangeText}
                onBlur={onBlur}
                keyboardType={keyboardType}
                autoCapitalize={autoCapitalize}
                autoCorrect={autoCorrect}
                secureTextEntry={secureTextEntry}
                returnKeyType={returnKeyType}
                onSubmitEditing={onSubmitEditing}
                inputMode={inputMode}
              />
              {suffix ? <View style={styles.suffix}>{suffix}</View> : null}
            </View>
            {error ? <Text style={styles.error}>{error.message}</Text> : helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
          </View>
        );
      }}
    />
  );
};

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    height: 56,
  },
  inputWrapperError: {
    borderColor: '#F97373',
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
  suffix: {
    marginLeft: 12,
  },
  error: {
    fontSize: 13,
    color: '#EF4444',
  },
  helper: {
    fontSize: 13,
    color: colors.textMuted,
  },
});

export default FormInput;
