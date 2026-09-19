/**
 * Confirms the specific claim RABBIT_NOTEBOOK.md makes: this app starts
 * and runs normally with NO SENTRY_DSN configured (local dev today, and
 * production until a real Sentry project exists) — instrument.ts must
 * never throw either way, and Sentry.* calls must stay safe no-ops when
 * no DSN was provided.
 */
describe('instrument.ts', () => {
  const originalDsn = process.env['SENTRY_DSN'];
  const originalEnv = process.env['NODE_ENV'];

  afterEach(() => {
    if (originalDsn === undefined) delete process.env['SENTRY_DSN'];
    else process.env['SENTRY_DSN'] = originalDsn;
    process.env['NODE_ENV'] = originalEnv;
    jest.resetModules();
  });

  it('does not throw, and leaves Sentry uninitialized, when SENTRY_DSN is unset', async () => {
    // Empty string, not `delete` — instrument.ts now loads `.env` itself
    // (dotenv.config(), before app.module.ts's ConfigModule ever runs; see
    // its own comment / RABBIT_NOTEBOOK.md §32) since it must read
    // SENTRY_DSN before Nest's own dotenv-backed ConfigModule has had a
    // chance to populate process.env. dotenv's default behavior never
    // overwrites a key process.env already has — even an empty one — so
    // `delete` would let the real .env file's own real DSN silently repopulate
    // this on every re-import, which is exactly the bug this fix closes.
    process.env['SENTRY_DSN'] = '';
    jest.resetModules();

    await expect(import('./instrument')).resolves.toBeDefined();

    const Sentry = await import('@sentry/nestjs');
    expect(Sentry.getClient()).toBeUndefined();
  });

  it('Sentry.captureException is a safe no-op with no DSN configured — never throws', async () => {
    // Empty string, not `delete` — instrument.ts now loads `.env` itself
    // (dotenv.config(), before app.module.ts's ConfigModule ever runs; see
    // its own comment / RABBIT_NOTEBOOK.md §32) since it must read
    // SENTRY_DSN before Nest's own dotenv-backed ConfigModule has had a
    // chance to populate process.env. dotenv's default behavior never
    // overwrites a key process.env already has — even an empty one — so
    // `delete` would let the real .env file's own real DSN silently repopulate
    // this on every re-import, which is exactly the bug this fix closes.
    process.env['SENTRY_DSN'] = '';
    jest.resetModules();
    await import('./instrument');

    const Sentry = await import('@sentry/nestjs');
    expect(() =>
      Sentry.captureException(new Error('should be safely dropped, not throw')),
    ).not.toThrow();
  });

  it('initializes a real Sentry client when SENTRY_DSN IS configured', async () => {
    process.env['SENTRY_DSN'] =
      'https://abc123def456abc123def456abc123@o000000.ingest.sentry.io/0000000';
    jest.resetModules();

    await import('./instrument');

    const Sentry = await import('@sentry/nestjs');
    expect(Sentry.getClient()).toBeDefined();
    // Clean up the client this test itself created, same as
    // instrument.integration.spec.ts's own afterEach — a real client left
    // attached to the global scope after this test could otherwise affect
    // unrelated tests running later in the same worker.
    Sentry.getCurrentScope().setClient(undefined);
  });
});
