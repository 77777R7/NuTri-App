import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

type VerticalGlowScrollbarProps = {
  progress: number;
  visible: boolean;
  top?: number;
  bottom?: number;
  thumbHeight?: number;
};

export const VerticalGlowScrollbar = ({
  progress,
  visible,
  top = 8,
  bottom = 8,
  thumbHeight = 40,
}: VerticalGlowScrollbarProps) => {
  const [trackHeight, setTrackHeight] = useState(0);

  const clamped = Math.max(0, Math.min(progress, 1));
  const thumbTop = useMemo(() => {
    const travel = Math.max(trackHeight - thumbHeight, 0);
    return clamped * travel;
  }, [clamped, thumbHeight, trackHeight]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    setTrackHeight((currentHeight) =>
      currentHeight === nextHeight ? currentHeight : nextHeight,
    );
  };

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={handleLayout}
      style={[styles.root, { top, bottom, opacity: visible ? 1 : 0 }]}
    >
      <View style={[styles.thumb, { height: thumbHeight, top: thumbTop }]} />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    right: 6,
    width: 6,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: 999,
    backgroundColor: 'rgba(36,69,184,0.72)',
    shadowColor: '#2445B8',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
});

export default VerticalGlowScrollbar;
