import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 1500;

export function useAutosave<T>(
  value: T,
  saveFn: (v: T) => Promise<void>,
  enabled: boolean,
): SaveState {
  const [state, setState] = useState<SaveState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValue = useRef(value);
  const latestSaveFn = useRef(saveFn);

  useEffect(() => {
    latestValue.current = value;
  }, [value]);

  useEffect(() => {
    latestSaveFn.current = saveFn;
  }, [saveFn]);

  const save = useCallback(async (v: T) => {
    setState('saving');
    try {
      await latestSaveFn.current(v);
      setState('saved');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void save(latestValue.current);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, enabled, save]);

  return state;
}
