// `fetch()` throws a bare "Failed to fetch" TypeError whenever the request never reached a
// server (API down, wrong URL, CORS/network failure). That message means nothing to a user,
// so we swap it for a friendly one here while still logging the real error for debugging.
export function getFriendlyErrorMessage(
  err: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (err instanceof Error) {
    console.error(err);
    if (err.message === 'Failed to fetch' || err instanceof TypeError) {
      return "We couldn't connect to CVPilot. Please check your connection and try again.";
    }
    return err.message || fallback;
  }
  console.error(err);
  return fallback;
}
