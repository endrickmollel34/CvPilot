// Nest's ValidationPipe returns `message` as a string[] of per-property validation
// failures (e.g. "property title should not exist"). Those are diagnostic details for
// developers, not something an end user should see — so array-shaped messages are
// logged and swallowed behind a generic message, while single business-logic strings
// (e.g. "Monthly analysis limit reached") are passed through as-is.
//
// ApiError additionally preserves the HTTP status code so callers can react to
// specific server semantics (e.g. a 403 plan/quota restriction) without parsing
// the message text as the primary signal — see isQuotaError() below.
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function throwApiError(body: unknown, fallback: string, status: number): never {
  const message = (body as { message?: unknown } | undefined)?.message;

  if (Array.isArray(message)) {
    console.error('API validation error:', message);
    throw new ApiError(
      'We couldn’t process that request. Please check your input and try again.',
      status,
    );
  }
  if (typeof message === 'string' && message.trim()) {
    throw new ApiError(message, status);
  }
  throw new ApiError(fallback, status);
}

// The backend returns HTTP 403 both for genuine plan/quota restrictions
// (e.g. "Monthly analysis limit reached. Upgrade your plan to continue.")
// and for unrelated ownership checks (e.g. "CV not found" when a CV
// belongs to another user) — status alone isn't specific enough to decide
// whether to show an "Upgrade plan" call to action. Every quota/plan
// restriction message the backend sends deliberately includes the phrase
// "Upgrade your plan", so requiring both the status code and that marker
// is far more robust than guessing from the message text alone, without
// needing any backend change.
export function isQuotaError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && err.message.includes('Upgrade your plan');
}
