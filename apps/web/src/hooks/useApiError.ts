import { useCallback, useState } from 'react';

import { getFriendlyErrorMessage } from '@/lib/errorMessage';
import { isQuotaError } from '@/lib/apiError';

export interface ApiErrorState {
  /** Empty string means no error — matches the plain-string state this replaces. */
  message: string;
  /** True only for a genuine plan/quota restriction (see isQuotaError). */
  quota: boolean;
}

const EMPTY: ApiErrorState = { message: '', quota: false };

/**
 * Small, reusable replacement for `useState('')` + `getFriendlyErrorMessage`
 * call sites scattered across every quota-gated workspace. Bundles the
 * derived display message with whether it's a plan/quota restriction, so
 * an "Upgrade plan" CTA (via <ActionableError>) can be shown consistently
 * without duplicating the detection logic in each component.
 */
export function useApiError() {
  const [error, setErrorState] = useState<ApiErrorState>(EMPTY);

  // For a caught exception from an API call.
  const setFromError = useCallback((err: unknown, fallback?: string) => {
    setErrorState({ message: getFriendlyErrorMessage(err, fallback), quota: isQuotaError(err) });
  }, []);

  // For a plain client-side message (validation, polling-failure text, etc.)
  // — never a quota restriction, since it didn't come from the API.
  const setMessage = useCallback((message: string) => {
    setErrorState({ message, quota: false });
  }, []);

  const clear = useCallback(() => setErrorState(EMPTY), []);

  return { ...error, setFromError, setMessage, clear };
}
