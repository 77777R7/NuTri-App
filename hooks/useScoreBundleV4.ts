import { useEffect, useRef, useState } from 'react';

import { fetchScoreBundleV4 } from '@/lib/score-v4';
import type { ScoreBundleResponse, ScoreSource } from '@/types/scoreBundle';

type ScoreBundleState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  response: ScoreBundleResponse | null;
  error: string | null;
};

export function useScoreBundleV4(params: {
  source?: ScoreSource | null;
  sourceId?: string | null;
  enabled?: boolean;
  pollMs?: number;
  maxAttempts?: number;
}): ScoreBundleState {
  const {
    source = null,
    sourceId = null,
    enabled = true,
    pollMs = 15000,
    maxAttempts = 4,
  } = params;

  const [state, setState] = useState<ScoreBundleState>({
    status: 'idle',
    response: null,
    error: null,
  });
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !source || !sourceId) {
      setState({ status: 'idle', response: null, error: null });
      return;
    }

    let isActive = true;
    attemptRef.current = 0;

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const load = async () => {
      clearTimer();
      attemptRef.current += 1;
      setState((prev) => ({
        status: prev.status === 'ready' ? 'ready' : 'loading',
        response: prev.response,
        error: null,
      }));
      try {
        const response = await fetchScoreBundleV4({ source, sourceId });
        if (!isActive) return;
        setState({
          status: 'ready',
          response,
          error: null,
        });
        if (response.status === 'pending' && attemptRef.current < maxAttempts) {
          timerRef.current = setTimeout(load, pollMs);
        }
      } catch (error) {
        if (!isActive) return;
        const message = error instanceof Error ? error.message : 'Score request failed';
        setState({
          status: 'error',
          response: null,
          error: message,
        });
      }
    };

    void load();

    return () => {
      isActive = false;
      clearTimer();
    };
  }, [enabled, maxAttempts, pollMs, source, sourceId]);

  return state;
}
