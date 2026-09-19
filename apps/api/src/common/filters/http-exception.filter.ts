import type { ExceptionFilter, ArgumentsHost } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import * as Sentry from '@sentry/nestjs';

// Catches every exception, but is deliberately conservative about what it
// changes:
//   - HttpException (validation errors, quota/plan messages, auth errors,
//     not-found, etc.) is passed through with its existing response body
//     UNCHANGED — this exactly matches Nest's own built-in default handler,
//     so the frontend's existing error parsing (apps/web/src/lib/apiError.ts,
//     which reads body.message as either a string or string[]) keeps working
//     with zero changes. This filter must never nest that body under a new
//     `message` key.
//   - Anything else (a genuinely unexpected error — a raw TypeORM/Stripe/
//     OpenAI/AWS SDK throw, a bug) is logged here with full detail
//     server-side, and only a generic, detail-free message reaches the
//     client. This is the one behavior Nest's default handler doesn't
//     guarantee consistently across every code path.
//
// Monitoring (RABBIT_NOTEBOOK.md): Sentry.captureException is added
// alongside the EXISTING `status >= 500` condition below — the same
// condition that already decided "this is worth a server-side error log,
// not just a routine rejection" — rather than via @sentry/nestjs's own
// `@SentryExceptionCaptured()` decorator, whose built-in "expected error"
// check (checked directly in node_modules) treats ANY HttpException as
// expected regardless of status code, which would silently skip a
// deliberate 5xx like ServiceUnavailableException. A bare
// `Sentry.captureException` call is a no-op when SENTRY_DSN isn't
// configured (see instrument.ts) and never touches `response` — the
// existing status code and JSON body below are completely unchanged.
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) {
        this.logger.error(exception);
        Sentry.captureException(exception);
      }
      response.status(status).json(exception.getResponse());
      return;
    }

    this.logger.error(exception);
    Sentry.captureException(exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  }
}
