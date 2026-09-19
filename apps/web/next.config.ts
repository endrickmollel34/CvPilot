import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';

const nextConfig: NextConfig = {
  transpilePackages: ['@cvpilot/shared'],
};

// RABBIT_NOTEBOOK.md — minimal, errors-only production monitoring. No
// Sentry org/project/auth token exists yet (no account has been created —
// see RABBIT_NOTEBOOK.md's remaining-setup section), so source map upload
// and Sentry's own build telemetry are both explicitly disabled here
// rather than left to silently no-op on missing credentials; the app must
// build the same way with or without them.
export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  sourcemaps: { disable: true },
});
