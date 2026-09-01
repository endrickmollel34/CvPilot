// Shared fetch wrapper for authenticated CVPilot API calls. Retries exactly
// once on a 401 with a forced-fresh Clerk token — see CvPilot's production
// incident where a client component reused a Clerk session token that had
// gone stale by the time the mutation actually fired, and ClerkGuard
// rejected it with "JWT is expired".
//
// Body safety: verified every CVPilot browser-side API call (cvApi,
// analysisApi, coverLetterApi, tailoringApi, billingApi) sends either no
// body or a JSON.stringify()'d string — never FormData or a raw
// ReadableStream. `body` below is therefore typed as `string | undefined`
// only, so it's always safe to send again on retry: an already-serialized
// string isn't a single-use stream the way a FormData/Blob/ReadableStream
// body would be, so no cloning is required. The one real file upload in
// this app (the direct-to-R2 PUT in NewCvUpload.tsx) intentionally never
// goes through this helper — it carries no Authorization header and isn't a
// CVPilot API call.

/** Matches (and is satisfiable by) Clerk's own `useAuth().getToken` shape. */
export type GetToken = (options?: { skipCache?: boolean }) => Promise<string | null>;

/**
 * Either an already-resolved token string (server components, via
 * `await auth()` — there is no live session object left to re-check once a
 * request has run, so a string never triggers a retry) or a live Clerk
 * `getToken` function (client components, via `useAuth()` — this is what
 * enables the retry-once-on-401 behavior below).
 */
export type TokenSource = string | GetToken;

export interface AuthFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  cache?: RequestCache;
}

async function resolveToken(
  source: TokenSource,
  options?: { skipCache?: boolean },
): Promise<string | null> {
  return typeof source === 'string' ? source : source(options);
}

function doFetch(url: string, token: string | null, init: AuthFetchInit): Promise<Response> {
  return fetch(url, {
    method: init.method,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
    body: init.body,
    cache: init.cache,
  });
}

/**
 * Fetches `url` with a Bearer token from `tokenSource`. On exactly a 401,
 * and only when `tokenSource` is a live `getToken` function (not a
 * pre-resolved string), forces a fresh token via `getToken({ skipCache:
 * true })` and retries the identical request exactly once. Any other status
 * — including 403/404/409/429/5xx — is returned as-is on the first attempt,
 * and the retried request's result (success or otherwise, including a
 * second 401) is always returned as-is with no further attempts.
 */
export async function authFetch(
  url: string,
  tokenSource: TokenSource,
  init: AuthFetchInit = {},
): Promise<Response> {
  const token = await resolveToken(tokenSource);
  const res = await doFetch(url, token, init);

  if (res.status !== 401) return res;
  // A pre-resolved string (server components) has no way to refresh itself
  // — retrying with the same value would be pointless, so return the 401.
  if (typeof tokenSource === 'string') return res;

  const freshToken = await tokenSource({ skipCache: true });
  // Clerk has no session to refresh (e.g. genuinely signed out) — fail
  // normally with the original 401 rather than retrying with nothing.
  if (!freshToken) return res;

  return doFetch(url, freshToken, init);
}
