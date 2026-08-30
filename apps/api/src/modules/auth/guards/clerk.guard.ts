import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import type { Request } from 'express';

@Injectable()
export class ClerkGuard implements CanActivate {
  private readonly logger = new Logger(ClerkGuard.name);
  private readonly secretKey: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.getOrThrow<string>('CLERK_SECRET_KEY');
    if (this.secretKey.includes('placeholder')) {
      this.logger.warn(
        'CLERK_SECRET_KEY is set to a placeholder value — every request will fail with ' +
          '"Invalid authentication token" until this is replaced with a real secret key from ' +
          'https://dashboard.clerk.com that matches the publishable key used by apps/web.',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const token = this.extractToken(request);

    if (!token) throw new UnauthorizedException('Missing authentication token');

    try {
      const payload = await verifyToken(token, { secretKey: this.secretKey });
      request.user = { clerkId: payload.sub };
      return true;
    } catch (err) {
      this.logger.warn(
        `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid authentication token');
    }
  }

  private extractToken(request: Request): string | undefined {
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    return undefined;
  }
}
