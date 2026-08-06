import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

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
  const isMountedRef = useRef(false);

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

    // Skip the initial render — the value hasn't changed yet, just mounted.
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      return;
    }

    setState('unsaved');
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
