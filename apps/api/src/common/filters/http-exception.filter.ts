import type { ExceptionFilter, ArgumentsHost } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

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
      }
      response.status(status).json(exception.getResponse());
      return;
    }

    this.logger.error(exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  }
}
