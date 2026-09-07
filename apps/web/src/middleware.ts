import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  // Public legal pages — required to be reachable without signing in, both
  // for real visitors and for Google OAuth production-branding review.
  '/privacy',
  '/terms',
  // Public contact form — linked from Privacy/Terms and must work for
  // signed-out visitors, including anyone submitting a privacy/data request.
  '/contact',
  // Clerk's own Vercel proxy requests (health checks, proxied clerk-js
  // assets) — not an application route, so it must never hit auth.protect().
  '/__clerk(.*)',
]);

export default clerkMiddleware(
  async (auth, request) => {
    if (!isPublicRoute(request)) {
      await auth.protect();
    }
  },
  // Clerk's official Frontend API proxy — required for our production Vercel
  // domain. Enabling this makes clerkMiddleware itself forward matched
  // /__clerk requests to Clerk's Frontend API before our handler above runs.
  // Must stay OFF in local development: pk_test_/sk_test_ keys are not
  // configured for our proxy domain, so a local /__clerk/v1/client/handshake
  // request gets rejected by Clerk with host_invalid ("Invalid host").
  // NODE_ENV is 'development' under `next dev` and 'production' for any
  // built/deployed instance (including Vercel), so this needs no new env
  // var and no hostname check.
  { frontendApiProxy: { enabled: process.env.NODE_ENV === 'production' } },
);

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    // Required by Clerk's Vercel domain proxy: the proxied clerk-js bundle is
    // served from this path and ends in .js, which the static-asset
    // exclusion above would otherwise skip — this entry matches it
    // independently so clerkMiddleware can forward it to Clerk's Frontend API.
    '/__clerk/:path*',
  ],
};
