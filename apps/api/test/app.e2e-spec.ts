import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from '../src/app.module';

describe('AppModule (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/health', () => {
    it('returns 200 with an all-ok body when PostgreSQL and Redis are reachable', async () => {
      const res = await request(app.getHttpServer()).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'ok',
        db: 'ok',
        redis: 'ok',
        timestamp: expect.any(String),
      });
    });

    it('requires no authentication', async () => {
      // No Authorization header at all — would 401 on any ClerkGuard-protected route.
      await request(app.getHttpServer()).get('/api/health').expect(200);
    });
  });

  // ─── Rate limiting (Production Readiness Phase 1) ──────────────────────────
  // ThrottlerModule is configured for 100 requests/60s per IP. These tests
  // reuse the single app instance already bootstrapped above; different
  // routes are tracked under independent throttle-storage keys, so they
  // don't interfere with each other or with the health tests above.

  describe('rate limiting', () => {
    it('is genuinely active on an ordinary endpoint (guard is actually registered)', async () => {
      const server = app.getHttpServer();
      const statuses: number[] = [];

      // No Authorization header — each request fails fast with 401 from
      // ClerkGuard, which runs *after* the global ThrottlerGuard, so the
      // throttle counter still increments per request.
      for (let i = 0; i < 105; i++) {
        const res = await request(server).get('/api/cvs');
        statuses.push(res.status);
      }

      expect(statuses).toContain(429);
    }, 30000);

    it('exempts GET /api/health from throttling', async () => {
      const server = app.getHttpServer();
      const statuses: number[] = [];

      for (let i = 0; i < 105; i++) {
        const res = await request(server).get('/api/health');
        statuses.push(res.status);
      }

      expect(statuses).not.toContain(429);
    }, 30000);

    it('exempts the Stripe webhook endpoint from throttling', async () => {
      const server = app.getHttpServer();
      const statuses: number[] = [];

      for (let i = 0; i < 105; i++) {
        // No valid signature — the handler itself will reject these, but
        // that's irrelevant to what's under test: the request must never be
        // rejected by the *throttler* before reaching the handler.
        const res = await request(server)
          .post('/api/webhooks/stripe')
          .set('stripe-signature', 'invalid')
          .send({});
        statuses.push(res.status);
      }

      expect(statuses).not.toContain(429);
    }, 30000);
  });
});
