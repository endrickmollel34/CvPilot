// Nest's ValidationPipe returns `message` as a string[] of per-property validation
// failures (e.g. "property title should not exist"). Those are diagnostic details for
// developers, not something an end user should see — so array-shaped messages are
// logged and swallowed behind a generic message, while single business-logic strings
// (e.g. "Monthly analysis limit reached") are passed through as-is.
export function throwApiError(body: unknown, fallback: string): never {
  const message = (body as { message?: unknown } | undefined)?.message;

  if (Array.isArray(message)) {
    console.error('API validation error:', message);
    throw new Error('We couldn’t process that request. Please check your input and try again.');
  }
  if (typeof message === 'string' && message.trim()) {
    throw new Error(message);
  }
  throw new Error(fallback);
}
