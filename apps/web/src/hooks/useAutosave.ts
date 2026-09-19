import { useCallback, useEffect, useRef, useState } from 'react';
import { createAutosaveQueue } from './autosaveQueue';

export type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 1500;

export function useAutosave<T>(
  value: T,
  saveFn: (v: T) => Promise<void>,
  enabled: boolean,
): SaveState {
  return useAutosaveControls(value, saveFn, enabled).state;
}

export function useAutosaveControls<T>(
  value: T,
  saveFn: (v: T) => Promise<void>,
  enabled: boolean,
): { state: SaveState; flush: () => Promise<void> } {
  const [state, setState] = useState<SaveState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValue = useRef(value);
  const latestSaveFn = useRef(saveFn);
  const isMountedRef = useRef(false);
  const revisionRef = useRef(0);
  const queueRef = useRef<ReturnType<typeof createAutosaveQueue> | null>(null);
  if (!queueRef.current) queueRef.current = createAutosaveQueue();

  useEffect(() => {
    latestValue.current = value;
    revisionRef.current += 1;
  }, [value]);

  useEffect(() => {
    latestSaveFn.current = saveFn;
  }, [saveFn]);

  const save = useCallback(async (v: T, revision: number) => {
    const saveSnapshot = latestSaveFn.current;
    setState('saving');
    try {
      await queueRef.current!(() => saveSnapshot(v));
      if (revision === revisionRef.current) setState('saved');
    } catch (error) {
      if (revision === revisionRef.current) setState('error');
      throw error;
    }
  }, []);

  const flush = useCallback(async () => {
    if (!enabled) throw new Error('Saving is currently unavailable.');
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Use this render's value so Download includes even the last edit.
    // The queue also waits for older writes before saving this snapshot.
    await save(value, revisionRef.current);
  }, [enabled, save, value]);

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
      void save(latestValue.current, revisionRef.current).catch(() => undefined);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, enabled, save]);

  return { state, flush };
}
