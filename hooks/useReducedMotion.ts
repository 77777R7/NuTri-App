import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let isMounted = true;

    AccessibilityInfo.isReduceMotionEnabled?.().then((value) => {
      if (isMounted) {
        setReduceMotion(Boolean(value));
      }
    });

    const listener = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      (value) => {
        setReduceMotion(Boolean(value));
      },
    );

    return () => {
      isMounted = false;
      listener?.remove?.();
    };
  }, []);

  return reduceMotion;
}
