import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

import { GlassSurface } from '../shared/GlassSurface';
import { SummarySectionHeader } from './SummarySectionHeader';

type SummaryPanelProps = {
  eyebrow: string;
  title: string;
  body?: string;
  tone?: 'default' | 'primary';
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  bodyStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

export function SummaryPanel({
  eyebrow,
  title,
  body,
  tone = 'default',
  borderRadius = 32,
  style,
  contentStyle,
  bodyStyle,
  children,
}: SummaryPanelProps) {
  return (
    <GlassSurface variant="panel" borderRadius={borderRadius} style={style}>
      <View style={contentStyle}>
        <SummarySectionHeader eyebrow={eyebrow} title={title} body={body} tone={tone} bodyStyle={bodyStyle} />
        {children}
      </View>
    </GlassSurface>
  );
}

export default SummaryPanel;
