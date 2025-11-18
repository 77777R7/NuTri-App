import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import type { DesignTokens } from '@/constants/designTokens';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';

type ResponsiveHeaderProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  accessory?: React.ReactNode;
};

export const ResponsiveHeader: React.FC<ResponsiveHeaderProps> = ({ title, subtitle, onBack, accessory }) => {
  const { tokens } = useResponsiveTokens();
  const styles = React.useMemo(() => createStyles(tokens), [tokens]);

  return (
    <View style={styles.container}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} activeOpacity={0.85} style={styles.backButton}>
          <ArrowLeft size={tokens.components.iconButton.iconSize} color={tokens.colors.textPrimary} />
        </TouchableOpacity>
      ) : null}

      <View style={styles.textContainer}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      {accessory ? <View style={styles.accessory}>{accessory}</View> : <View style={styles.accessoryPlaceholder} />}
    </View>
  );
};

const createStyles = (tokens: DesignTokens) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens.spacing.md,
      marginBottom: tokens.layout.stack,
    },
    backButton: {
      width: tokens.components.iconButton.size,
      height: tokens.components.iconButton.size,
      borderRadius: tokens.components.iconButton.radius,
      backgroundColor: tokens.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...tokens.shadow.lifted,
    },
    textContainer: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    title: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.title,
    },
    subtitle: {
      color: tokens.colors.textMuted,
      ...tokens.typography.bodySmall,
    },
    accessory: {
      marginLeft: tokens.spacing.sm,
    },
    accessoryPlaceholder: {
      width: tokens.components.iconButton.size,
      height: tokens.components.iconButton.size,
    },
  });

