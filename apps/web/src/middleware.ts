import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
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
  { frontendApiProxy: { enabled: true } },
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
